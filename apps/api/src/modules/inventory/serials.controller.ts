import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { SerialItemInput, certificationInput, serialItemInput } from '@minitta/shared';
import { DbService, SessionUser } from '../../db/db.service';
import { CurrentUser, paging, zod } from '../../common/http';

/** Piezas serializadas: cada joya física con su peso real, ubicación y certificados. */
@Controller('serials')
export class SerialsController {
  constructor(private readonly dbs: DbService) {}

  @Get()
  async list(@Query() q: Record<string, string>) {
    const { page, pageSize, offset } = paging(q, 50);
    const search = q.q?.trim() ? `%${q.q.trim()}%` : null;
    const where = sql`
      WHERE (${search}::text IS NULL OR t.serial_code ILIKE ${search} OR t.sku ILIKE ${search}
             OR t.product_name ILIKE ${search})
        AND (${q.status || null}::text IS NULL OR t.status::text = ${q.status || null})
        AND (${q.location_id || null}::bigint IS NULL OR si.location_id = ${q.location_id || null}::bigint)
        AND (${q.variant_id || null}::bigint IS NULL OR si.variant_id = ${q.variant_id || null}::bigint)`;
    const [rows, total] = await Promise.all([
      sql`
        SELECT t.*, si.variant_id, si.location_id, vf.product_id, vf.image_url,
               (SELECT count(*) FROM inventory.certification c WHERE c.serial_id = t.serial_id)::int AS certificates
        FROM inventory.v_serial_tracking t
        JOIN inventory.serial_item si ON si.id = t.serial_id
        JOIN catalog.v_variant_full vf ON vf.variant_id = si.variant_id
        ${where}
        ORDER BY si.created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}`.execute(this.dbs.db),
      sql<{ n: number }>`
        SELECT count(*)::int AS n FROM inventory.v_serial_tracking t
        JOIN inventory.serial_item si ON si.id = t.serial_id ${where}`.execute(this.dbs.db),
    ]);
    return { items: rows.rows, total: total.rows[0].n, page, pageSize };
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const db = this.dbs.db;
    const item = await sql`
      SELECT si.*, t.sku, t.product_name, t.location_code, t.nominal_weight_g, t.weight_diff_g,
             vf.product_id, vf.image_url, sup.name AS supplier_name
      FROM inventory.serial_item si
      JOIN inventory.v_serial_tracking t ON t.serial_id = si.id
      JOIN catalog.v_variant_full vf ON vf.variant_id = si.variant_id
      LEFT JOIN core.supplier sup ON sup.id = si.supplier_id
      WHERE si.id = ${id}`
      .execute(db)
      .then((r) => r.rows[0]);
    if (!item) throw new NotFoundException('Pieza no encontrada');
    const [movements, certificates] = await Promise.all([
      sql`
        SELECT m.id, m.occurred_at, m.type, m.quantity, m.notes, l.code AS location_code, u.full_name AS user_name
        FROM inventory.movement m
        JOIN core.location l ON l.id = m.location_id
        JOIN core.app_user u ON u.id = m.created_by
        WHERE m.serial_id = ${id} ORDER BY m.occurred_at DESC, m.id DESC`
        .execute(db)
        .then((r) => r.rows),
      db.selectFrom('inventory.certification').selectAll().where('serial_id', '=', id).orderBy('id').execute(),
    ]);
    return { ...item, movements, certificates };
  }

  /**
   * Alta de una pieza. Si se indica sede, entra al stock en el mismo paso con
   * un movimiento de compra o apertura (el saldo nunca se escribe directo).
   */
  @Post()
  create(@CurrentUser() u: SessionUser, @Body(zod(serialItemInput)) b: SerialItemInput) {
    return this.dbs.tx(u, async (trx) => {
      const { location_id, entry_type, ...data } = b;
      const v = await trx
        .selectFrom('catalog.variant')
        .select(['tracking_mode', 'sku'])
        .where('id', '=', b.variant_id)
        .executeTakeFirstOrThrow();
      if (v.tracking_mode !== 'serial') {
        // una pieza individual solo tiene sentido en variantes serializadas. Se pasa
        // a 'serial' solo si no tiene stock por cantidad: si no, el saldo quedaría
        // con unidades que no se pueden mover (no tienen pieza).
        const st = await trx
          .selectFrom('inventory.stock')
          .select(sql<number>`COALESCE(sum(on_hand), 0)`.as('q'))
          .where('variant_id', '=', b.variant_id)
          .executeTakeFirstOrThrow();
        if (Number(st.q) !== 0) {
          throw new UnprocessableEntityException(
            `${v.sku} se controla por cantidad y tiene ${st.q} en stock: no se le pueden crear piezas. ` +
              'Cree una variante serializada o deje su stock en 0 con un ajuste.',
          );
        }
        await trx.updateTable('catalog.variant').set({ tracking_mode: 'serial' }).where('id', '=', b.variant_id).execute();
      }
      const code: string =
        data.serial_code ??
        (await sql<{ c: string }>`
          SELECT 'P-' || lpad((COALESCE(max(NULLIF(regexp_replace(serial_code, '\\D', '', 'g'), '')::bigint), 0) + 1)::text, 6, '0') AS c
          FROM inventory.serial_item WHERE serial_code ~ '^P-[0-9]+$'`
          .execute(trx)
          .then((r) => r.rows[0].c));
      const si = await trx
        .insertInto('inventory.serial_item')
        .values({
          ...data,
          serial_code: code,
          acquisition_currency: data.acquisition_cost != null ? (data.acquisition_currency ?? 'PEN') : null,
        })
        .returning(['id', 'serial_code'])
        .executeTakeFirstOrThrow();
      if (location_id && entry_type) {
        await sql`
          SELECT inventory.post_movement(
            p_variant_id  => ${b.variant_id}::bigint,
            p_location_id => ${location_id}::bigint,
            p_type        => ${entry_type}::inventory.movement_type,
            p_quantity    => 1,
            p_user_id     => ${u.id}::bigint,
            p_serial_id   => ${si.id}::bigint,
            p_unit_cost   => ${data.acquisition_cost}::numeric,
            p_currency    => ${data.acquisition_cost != null ? (data.acquisition_currency ?? 'PEN') : null}::char(3),
            p_reason      => ${entry_type === 'opening' ? 'inv_apertura' : 'compra_prov'}::text,
            p_doc_type    => 'serial',
            p_doc_id      => ${si.id}::bigint)`.execute(trx);
      }
      return si;
    });
  }

  @Put(':id')
  update(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(serialItemInput.omit({ variant_id: true, location_id: true, entry_type: true }).extend({ variant_id: z.any().optional() })))
    b: Omit<SerialItemInput, 'variant_id' | 'location_id' | 'entry_type'>,
  ) {
    const { serial_code, ...rest } = b;
    return this.dbs.tx(u, (trx) =>
      trx
        .updateTable('inventory.serial_item')
        .set({
          ...rest,
          ...(serial_code ? { serial_code } : {}),
          acquisition_currency: rest.acquisition_cost != null ? (rest.acquisition_currency ?? 'PEN') : null,
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }

  @Post(':id/certifications')
  addCertificate(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(certificationInput)) b: z.infer<typeof certificationInput>,
  ) {
    return this.dbs.tx(u, (trx) =>
      trx.insertInto('inventory.certification').values({ ...b, serial_id: id }).returningAll().executeTakeFirstOrThrow(),
    );
  }
}

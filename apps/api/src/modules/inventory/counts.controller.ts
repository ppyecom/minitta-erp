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
import { countLineInput, countOpenInput } from '@minitta/shared';
import { DbService, SessionUser } from '../../db/db.service';
import { CurrentUser, paging, zod } from '../../common/http';

/**
 * Inventario físico (decisión 5: así arranca el stock). Se abre con
 * open_count_sheet(), se cuenta línea por línea y apply_count_sheet() convierte
 * cada diferencia en un movimiento firmado.
 */
@Controller('counts')
export class CountsController {
  constructor(private readonly dbs: DbService) {}

  @Get()
  list() {
    return sql`
      SELECT cs.*, l.code AS location_code, l.name AS location_name, u.full_name AS created_by_name,
             c.name AS category_name,
             (SELECT count(*) FROM inventory.count_line cl WHERE cl.count_sheet_id = cs.id)::int AS lines,
             (SELECT count(*) FROM inventory.count_line cl
               WHERE cl.count_sheet_id = cs.id AND cl.counted_qty IS NOT NULL)::int AS counted,
             (SELECT count(*) FROM inventory.count_line cl
               WHERE cl.count_sheet_id = cs.id AND cl.difference <> 0)::int AS differences
      FROM inventory.count_sheet cs
      JOIN core.location l ON l.id = cs.location_id
      JOIN core.app_user u ON u.id = cs.created_by
      LEFT JOIN catalog.category c ON c.id = cs.scope_category_id
      ORDER BY cs.started_at DESC LIMIT 200`
      .execute(this.dbs.db)
      .then((r) => r.rows);
  }

  @Post()
  open(@CurrentUser() u: SessionUser, @Body(zod(countOpenInput)) b: z.infer<typeof countOpenInput>) {
    return this.dbs.tx(u, async (trx) => {
      const r = await sql<{ id: number }>`
        SELECT inventory.open_count_sheet(${b.location_id}::bigint, ${u.id}::bigint,
                                          ${b.is_opening}::boolean, ${b.category_id}::bigint) AS id`.execute(trx);
      return r.rows[0];
    });
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number, @Query() q: Record<string, string>) {
    const sheet = await sql`
      SELECT cs.*, l.code AS location_code, l.name AS location_name,
             uc.full_name AS created_by_name, ua.full_name AS approved_by_name
      FROM inventory.count_sheet cs
      JOIN core.location l ON l.id = cs.location_id
      JOIN core.app_user uc ON uc.id = cs.created_by
      LEFT JOIN core.app_user ua ON ua.id = cs.approved_by
      WHERE cs.id = ${id}`
      .execute(this.dbs.db)
      .then((r) => r.rows[0]);
    if (!sheet) throw new NotFoundException('Conteo no encontrado');

    const { page, pageSize, offset } = paging(q, 100);
    const search = q.q?.trim() ? `%${q.q.trim()}%` : null;
    const where = sql`
      WHERE cl.count_sheet_id = ${id}
        AND (${search}::text IS NULL OR vf.sku ILIKE ${search} OR vf.product_name ILIKE ${search}
             OR vf.legacy_code ILIKE ${search} OR vf.barcode = ${q.q?.trim() || null})
        AND (${q.filter || null}::text IS NULL
             OR (${q.filter || null} = 'pending' AND cl.counted_qty IS NULL AND vf.tracking_mode = 'quantity')
             OR (${q.filter || null} = 'diff' AND cl.difference <> 0)
             OR (${q.filter || null} = 'counted' AND cl.counted_qty IS NOT NULL))`;
    const [lines, total, summary] = await Promise.all([
      sql`
        SELECT cl.*, vf.sku, vf.legacy_code, vf.product_name, vf.image_url, vf.tracking_mode, vf.size_label
        FROM inventory.count_line cl
        JOIN catalog.v_variant_full vf ON vf.variant_id = cl.variant_id
        ${where}
        ORDER BY vf.product_name, vf.sku
        LIMIT ${pageSize} OFFSET ${offset}`
        .execute(this.dbs.db)
        .then((r) => r.rows),
      sql<{ n: number }>`
        SELECT count(*)::int AS n FROM inventory.count_line cl
        JOIN catalog.v_variant_full vf ON vf.variant_id = cl.variant_id ${where}`.execute(this.dbs.db),
      sql`
        SELECT count(*)::int AS lines,
               count(*) FILTER (WHERE cl.counted_qty IS NOT NULL)::int AS counted,
               count(*) FILTER (WHERE vf.tracking_mode = 'serial')::int AS serial_lines,
               count(*) FILTER (WHERE cl.difference <> 0)::int AS differences,
               COALESCE(sum(cl.difference) FILTER (WHERE cl.difference > 0), 0) AS surplus,
               COALESCE(sum(cl.difference) FILTER (WHERE cl.difference < 0), 0) AS shortage
        FROM inventory.count_line cl
        JOIN catalog.v_variant_full vf ON vf.variant_id = cl.variant_id
        WHERE cl.count_sheet_id = ${id}`
        .execute(this.dbs.db)
        .then((r) => r.rows[0]),
    ]);
    return { ...sheet, summary, lines: { items: lines, total: total.rows[0].n, page, pageSize } };
  }

  @Put(':id/lines/:lineId')
  setLine(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('lineId', ParseIntPipe) lineId: number,
    @Body(zod(countLineInput)) b: z.infer<typeof countLineInput>,
  ) {
    return this.dbs.tx(u, async (trx) => {
      const sheet = await trx.selectFrom('inventory.count_sheet').select('status').where('id', '=', id).executeTakeFirstOrThrow();
      if (!['open', 'counting'].includes(sheet.status)) {
        throw new UnprocessableEntityException('El conteo ya no está abierto');
      }
      const line = await sql<{ tracking_mode: string }>`
        SELECT v.tracking_mode FROM inventory.count_line cl JOIN catalog.variant v ON v.id = cl.variant_id
        WHERE cl.id = ${lineId} AND cl.count_sheet_id = ${id}`
        .execute(trx)
        .then((r) => r.rows[0]);
      if (!line) throw new NotFoundException('Línea no encontrada');
      if (line.tracking_mode === 'serial' && b.counted_qty !== null) {
        throw new UnprocessableEntityException(
          'Las variantes serializadas se cuentan pieza por pieza (menú Piezas), no por cantidad',
        );
      }
      await trx
        .updateTable('inventory.count_line')
        .set({ ...b, counted_at: b.counted_qty === null ? null : sql`now()` })
        .where('id', '=', lineId)
        .execute();
      await trx
        .updateTable('inventory.count_sheet')
        .set({ status: 'counting', counted_by: sql`COALESCE(counted_by, ${u.id}::bigint)` })
        .where('id', '=', id)
        .where('status', '=', 'open')
        .execute();
      return trx.selectFrom('inventory.count_line').selectAll().where('id', '=', lineId).executeTakeFirstOrThrow();
    });
  }

  @Post(':id/apply')
  apply(@CurrentUser() u: SessionUser, @Param('id', ParseIntPipe) id: number) {
    return this.dbs.tx(u, async (trx) => {
      const r = await sql<{ n: number }>`SELECT inventory.apply_count_sheet(${id}::bigint, ${u.id}::bigint) AS n`.execute(trx);
      return { movements: r.rows[0].n };
    });
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() u: SessionUser, @Param('id', ParseIntPipe) id: number) {
    return this.dbs.tx(u, async (trx) => {
      const r = await trx
        .updateTable('inventory.count_sheet')
        .set({ status: 'cancelled', closed_at: sql`now()` })
        .where('id', '=', id)
        .where('status', 'in', ['open', 'counting'])
        .executeTakeFirst();
      if (!r.numUpdatedRows) throw new UnprocessableEntityException('Solo se anula un conteo abierto');
      return { ok: true };
    });
  }
}

import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { sql } from 'kysely';
import { MOVEMENT_SIGN, MovementInput, movementInput, stockLimitsInput } from '@minitta/shared';
import { DbService, SessionUser } from '../../db/db.service';
import { CurrentUser, paging, zod } from '../../common/http';

@Controller()
export class StockController {
  constructor(private readonly dbs: DbService) {}

  /** Disponibilidad por sede (inventory.v_availability). */
  @Get('stock')
  async stock(@Query() q: Record<string, string>) {
    const { page, pageSize, offset } = paging(q, 50);
    const search = q.q?.trim() ? `%${q.q.trim()}%` : null;
    const where = sql`
      WHERE (${q.location_id || null}::bigint IS NULL OR a.location_id = ${q.location_id || null}::bigint)
        AND (${search}::text IS NULL OR a.sku ILIKE ${search} OR a.product_name ILIKE ${search}
             OR vf.legacy_code ILIKE ${search})
        AND (${q.below_min === 'true'} = false OR a.below_min)
        AND (${q.with_stock === 'false'} = true OR a.on_hand <> 0 OR a.reserved <> 0 OR a.in_transit <> 0)`;
    const [rows, total] = await Promise.all([
      sql`
        SELECT a.*, vf.product_id, vf.legacy_code, vf.tracking_mode, vf.image_url, vf.size_label, vf.material_name
        FROM inventory.v_availability a
        JOIN catalog.v_variant_full vf ON vf.variant_id = a.variant_id
        ${where}
        ORDER BY a.below_min DESC, a.product_name, a.sku, a.location_code
        LIMIT ${pageSize} OFFSET ${offset}`.execute(this.dbs.db),
      sql<{ n: number; units: number }>`
        SELECT count(*)::int AS n, COALESCE(sum(a.on_hand), 0) AS units
        FROM inventory.v_availability a
        JOIN catalog.v_variant_full vf ON vf.variant_id = a.variant_id
        ${where}`.execute(this.dbs.db),
    ]);
    return { items: rows.rows, total: total.rows[0].n, units: total.rows[0].units, page, pageSize };
  }

  /** Mínimo y máximo por sede: es configuración, no saldo (el saldo no se escribe). */
  @Put('stock/:variantId/:locationId/limits')
  limits(
    @CurrentUser() u: SessionUser,
    @Param('variantId', ParseIntPipe) variantId: number,
    @Param('locationId', ParseIntPipe) locationId: number,
    @Body(zod(stockLimitsInput)) b: { min_quantity: number; max_quantity: number | null },
  ) {
    return this.dbs.tx(u, (trx) =>
      trx
        .insertInto('inventory.stock')
        .values({ variant_id: variantId, location_id: locationId, ...b })
        .onConflict((oc) => oc.columns(['variant_id', 'location_id']).doUpdateSet({ ...b, updated_at: sql`now()` }))
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }

  @Get('kardex')
  async kardex(@Query() q: Record<string, string>) {
    const { page, pageSize, offset } = paging(q, 50);
    const where = sql`
      WHERE (${q.variant_id || null}::bigint IS NULL OR k.variant_id = ${q.variant_id || null}::bigint)
        AND (${q.product_id || null}::bigint IS NULL OR vf.product_id = ${q.product_id || null}::bigint)
        AND (${q.location_id || null}::bigint IS NULL OR k.location_id = ${q.location_id || null}::bigint)
        AND (${q.type || null}::text IS NULL OR k.type::text = ${q.type || null})
        AND (${q.from || null}::date IS NULL OR k.occurred_at >= ${q.from || null}::date)
        AND (${q.to || null}::date IS NULL OR k.occurred_at < ${q.to || null}::date + 1)`;
    const [rows, total] = await Promise.all([
      sql`
        SELECT k.*, vf.product_id, vf.product_name, vf.image_url, l.name AS location_name,
               si.serial_code, mr.name AS reason_name
        FROM inventory.v_kardex k
        JOIN catalog.v_variant_full vf ON vf.variant_id = k.variant_id
        JOIN core.location l ON l.id = k.location_id
        JOIN inventory.movement m ON m.id = k.id
        LEFT JOIN inventory.serial_item si ON si.id = m.serial_id
        LEFT JOIN inventory.movement_reason mr ON mr.code = k.reason_code
        ${where}
        ORDER BY k.occurred_at DESC, k.id DESC
        LIMIT ${pageSize} OFFSET ${offset}`.execute(this.dbs.db),
      sql<{ n: number }>`
        SELECT count(*)::int AS n FROM inventory.v_kardex k
        JOIN catalog.v_variant_full vf ON vf.variant_id = k.variant_id ${where}`.execute(this.dbs.db),
    ]);
    return { items: rows.rows, total: total.rows[0].n, page, pageSize };
  }

  /**
   * Registra un movimiento con inventory.post_movement() (regla 3: la app no
   * inserta en el kardex a mano). El signo lo fija el tipo, salvo en ajustes.
   */
  @Post('movements')
  post(@CurrentUser() u: SessionUser, @Body(zod(movementInput)) b: MovementInput) {
    const sign = MOVEMENT_SIGN[b.type];
    const qty = sign === 0 ? b.quantity : sign * Math.abs(b.quantity);
    return this.dbs.tx(u, async (trx) => {
      const r = await sql<{ id: number }>`
        SELECT inventory.post_movement(
          p_variant_id  => ${b.variant_id}::bigint,
          p_location_id => ${b.location_id}::bigint,
          p_type        => ${b.type}::inventory.movement_type,
          p_quantity    => ${qty}::numeric,
          p_user_id     => ${u.id}::bigint,
          p_serial_id   => ${b.serial_id}::bigint,
          p_unit_cost   => ${b.unit_cost}::numeric,
          p_currency    => ${b.unit_cost != null ? (b.currency_code ?? 'PEN') : null}::char(3),
          p_reason      => ${b.reason_code}::text,
          p_doc_type    => 'manual',
          p_notes       => ${b.notes}::text) AS id`.execute(trx);
      return r.rows[0];
    });
  }

  @Get('integrity')
  async integrity() {
    const r = await sql`
      SELECT i.*, vf.sku, l.code AS location_code
      FROM inventory.v_stock_integrity i
      LEFT JOIN catalog.v_variant_full vf ON vf.variant_id = i.variant_id
      LEFT JOIN core.location l ON l.id = i.location_id`.execute(this.dbs.db);
    return r.rows;
  }
}

import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { exchangeRateInput, metalRateInput, priceListInput } from '@minitta/shared';
import { DbService, SessionUser } from '../../db/db.service';
import { CurrentUser, paging, zod } from '../../common/http';

@Controller('pricing')
export class PricingController {
  constructor(private readonly dbs: DbService) {}

  // ---- listas de precio -------------------------------------------------------
  @Get('lists')
  lists() {
    return sql`
      SELECT pl.*,
             (SELECT count(*) FROM pricing.price p WHERE p.price_list_id = pl.id AND p.valid_to IS NULL)::int AS prices,
             (SELECT count(*) FROM pricing.price p
               WHERE p.price_list_id = pl.id AND p.valid_to IS NULL AND p.mode <> 'manual')::int AS calculated,
             COALESCE((SELECT json_agg(location_id) FROM pricing.price_list_location x
                        WHERE x.price_list_id = pl.id), '[]') AS location_ids
      FROM pricing.price_list pl ORDER BY pl.priority`
      .execute(this.dbs.db)
      .then((r) => r.rows);
  }

  @Put('lists/:id')
  updateList(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(priceListInput)) b: z.infer<typeof priceListInput>,
  ) {
    return this.dbs.tx(u, async (trx) => {
      const { location_ids, ...data } = b;
      await trx.updateTable('pricing.price_list').set(data).where('id', '=', id).execute();
      await trx.deleteFrom('pricing.price_list_location').where('price_list_id', '=', id).execute();
      if (location_ids.length) {
        await trx
          .insertInto('pricing.price_list_location')
          .values(location_ids.map((location_id) => ({ price_list_id: id, location_id })))
          .execute();
      }
      return { id };
    });
  }

  /** Precios vigentes de una lista, con el efectivo de resolve_price(). */
  @Get('lists/:id/prices')
  async listPrices(@Param('id', ParseIntPipe) id: number, @Query() q: Record<string, string>) {
    const { page, pageSize, offset } = paging(q, 50);
    const search = q.q?.trim() ? `%${q.q.trim()}%` : null;
    const where = sql`
      WHERE p.price_list_id = ${id} AND p.valid_to IS NULL
        AND (${search}::text IS NULL OR vf.sku ILIKE ${search} OR vf.product_name ILIKE ${search}
             OR vf.legacy_code ILIKE ${search})
        AND (${q.mode || null}::text IS NULL OR p.mode::text = ${q.mode || null})`;
    const [rows, total] = await Promise.all([
      sql`
        SELECT p.*, vf.sku, vf.product_id, vf.product_name, vf.legacy_code, vf.image_url, vf.weight_g,
               pricing.resolve_price(p.variant_id, p.price_list_id, p.min_quantity) AS effective
        FROM pricing.price p
        JOIN catalog.v_variant_full vf ON vf.variant_id = p.variant_id
        ${where}
        ORDER BY vf.product_name, vf.sku
        LIMIT ${pageSize} OFFSET ${offset}`.execute(this.dbs.db),
      sql<{ n: number }>`
        SELECT count(*)::int AS n FROM pricing.price p
        JOIN catalog.v_variant_full vf ON vf.variant_id = p.variant_id ${where}`.execute(this.dbs.db),
    ]);
    return { items: rows.rows, total: total.rows[0].n, page, pageSize };
  }

  /** Tras cambiar el precio del gramo: recalcula el caché de los precios por peso/margen. */
  @Post('refresh')
  refresh(@CurrentUser() u: SessionUser, @Body('price_list_id') listId?: number) {
    return this.dbs.tx(u, async (trx) => {
      const r = await sql<{ n: number }>`
        SELECT pricing.refresh_calculated_prices(${listId ?? null}::bigint) AS n`.execute(trx);
      return { updated: r.rows[0].n };
    });
  }

  // ---- precio del gramo -------------------------------------------------------
  @Get('metal-rates')
  metalRates() {
    return sql`
      SELECT r.*, m.code AS material_code, m.name AS material_name, u.full_name AS created_by_name,
             r.valid_from = (SELECT max(r2.valid_from) FROM pricing.metal_rate r2
                             WHERE r2.material_id = r.material_id AND r2.currency_code = r.currency_code
                               AND r2.valid_from <= current_date) AS is_current
      FROM pricing.metal_rate r
      JOIN catalog.material m ON m.id = r.material_id
      LEFT JOIN core.app_user u ON u.id = r.created_by
      ORDER BY r.valid_from DESC, m.name LIMIT 300`
      .execute(this.dbs.db)
      .then((r) => r.rows);
  }

  @Post('metal-rates')
  addMetalRate(@CurrentUser() u: SessionUser, @Body(zod(metalRateInput)) b: z.infer<typeof metalRateInput>) {
    return this.dbs.tx(u, (trx) =>
      trx
        .insertInto('pricing.metal_rate')
        .values({ ...b, created_by: u.id })
        .onConflict((oc) =>
          oc.columns(['material_id', 'currency_code', 'valid_from']).doUpdateSet({
            price_per_gram: b.price_per_gram,
            source: b.source,
            created_by: u.id,
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }

  // ---- tipo de cambio ---------------------------------------------------------
  @Get('exchange-rates')
  exchangeRates() {
    return this.dbs.db
      .selectFrom('pricing.exchange_rate')
      .selectAll()
      .orderBy('rate_date', 'desc')
      .limit(120)
      .execute();
  }

  @Post('exchange-rates')
  addExchangeRate(@CurrentUser() u: SessionUser, @Body(zod(exchangeRateInput)) b: z.infer<typeof exchangeRateInput>) {
    return this.dbs.tx(u, (trx) =>
      trx
        .insertInto('pricing.exchange_rate')
        .values(b)
        .onConflict((oc) =>
          oc.columns(['currency_code', 'rate_date']).doUpdateSet({ buy: b.buy, sell: b.sell, source: b.source }),
        )
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }
}

import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  PriceInput,
  VariantInput,
  VariantStoneInput,
  optNonNeg,
  optText,
  priceInput,
  variantInput,
  variantStoneInput,
} from '@minitta/shared';
import { DbService, SessionUser, Tx } from '../../db/db.service';
import { CurrentUser, zod } from '../../common/http';

const costInput = z.object({
  metal_cost: optNonNeg,
  stone_cost: optNonNeg,
  labor_cost: optNonNeg,
  plating_cost: optNonNeg,
  packaging_cost: optNonNeg,
  other_cost: optNonNeg,
  currency_code: z.string().length(3).default('PEN'),
  notes: optText,
});

@Controller()
export class VariantsController {
  constructor(private readonly dbs: DbService) {}

  /** Buscador para los selectores de variante (movimientos, transferencias, piezas). */
  @Get('variants/search')
  async search(@Query('q') q = '', @Query('location_id') locationId?: string) {
    const term = `%${q.trim()}%`;
    const r = await sql`
      SELECT vf.variant_id, vf.sku, vf.legacy_code, vf.product_id, vf.product_name, vf.size_label,
             vf.metal_color, vf.tracking_mode, vf.image_url, vf.variant_status,
             s.on_hand, s.available
      FROM catalog.v_variant_full vf
      LEFT JOIN inventory.stock s
             ON s.variant_id = vf.variant_id AND s.location_id = ${locationId || null}::bigint
      WHERE vf.variant_status <> 'archived'
        AND (vf.sku ILIKE ${term} OR vf.legacy_code ILIKE ${term} OR vf.product_name ILIKE ${term}
             OR vf.barcode = ${q.trim()} OR vf.product_code ILIKE ${term})
      ORDER BY (vf.sku ILIKE ${q.trim() + '%'}) DESC, vf.product_name, vf.sku
      LIMIT 30`.execute(this.dbs.db);
    return r.rows;
  }

  @Post('products/:productId/variants')
  create(
    @CurrentUser() u: SessionUser,
    @Param('productId', ParseIntPipe) productId: number,
    @Body(zod(variantInput)) body: VariantInput,
  ) {
    return this.dbs.tx(u, async (trx) => {
      if (body.is_default) await this.clearDefault(trx, productId);
      const v = await trx
        .insertInto('catalog.variant')
        .values({
          ...body,
          product_id: productId,
          sku: body.sku ?? `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          created_by: u.id,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      if (!body.sku) await this.generateSku(trx, v.id);
      return { id: v.id };
    });
  }

  @Put('variants/:id')
  update(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(variantInput)) body: VariantInput,
  ) {
    return this.dbs.tx(u, async (trx) => {
      const cur = await trx.selectFrom('catalog.variant').select('product_id').where('id', '=', id).executeTakeFirstOrThrow();
      if (body.is_default) await this.clearDefault(trx, cur.product_id);
      const { sku, ...rest } = body;
      await trx
        .updateTable('catalog.variant')
        .set({ ...rest, ...(sku ? { sku } : {}) })
        .where('id', '=', id)
        .execute();
      if (!sku) await this.generateSku(trx, id);
      return { id };
    });
  }

  private async clearDefault(trx: Tx, productId: number) {
    await trx.updateTable('catalog.variant').set({ is_default: false }).where('product_id', '=', productId).execute();
  }

  /** SKU = {producto}-{talla}-{color metal}-{color piedra} (decisión 1), único. */
  private async generateSku(trx: Tx, variantId: number) {
    await sql`
      WITH g AS (
        SELECT v.id, upper(concat_ws('-', p.code, COALESCE(sv.label, v.size_label),
                                     left(v.metal_color, 3), left(v.stone_color, 3))) AS sku
        FROM catalog.variant v
        JOIN catalog.product p ON p.id = v.product_id
        LEFT JOIN catalog.size_value sv ON sv.id = v.size_value_id
        WHERE v.id = ${variantId})
      UPDATE catalog.variant v
         SET sku = CASE WHEN EXISTS (SELECT 1 FROM catalog.variant o WHERE o.sku = g.sku AND o.id <> v.id)
                        THEN g.sku || '-' || v.id ELSE g.sku END
        FROM g WHERE v.id = g.id`.execute(trx);
  }

  // ---- piedras ---------------------------------------------------------------
  @Post('variants/:id/stones')
  addStone(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(variantStoneInput)) body: VariantStoneInput,
  ) {
    return this.dbs.tx(u, async (trx) => {
      if (body.is_center) await this.clearCenter(trx, id);
      return trx
        .insertInto('catalog.variant_stone')
        .values({ ...body, variant_id: id, cost_currency: body.unit_cost != null ? (body.cost_currency ?? 'PEN') : null })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  @Put('variant-stones/:id')
  updateStone(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(variantStoneInput)) body: VariantStoneInput,
  ) {
    return this.dbs.tx(u, async (trx) => {
      const cur = await trx.selectFrom('catalog.variant_stone').select('variant_id').where('id', '=', id).executeTakeFirstOrThrow();
      if (body.is_center) await this.clearCenter(trx, cur.variant_id, id);
      return trx
        .updateTable('catalog.variant_stone')
        .set({ ...body, cost_currency: body.unit_cost != null ? (body.cost_currency ?? 'PEN') : null })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  @Delete('variant-stones/:id')
  async removeStone(@CurrentUser() u: SessionUser, @Param('id', ParseIntPipe) id: number) {
    await this.dbs.tx(u, (trx) => trx.deleteFrom('catalog.variant_stone').where('id', '=', id).execute());
    return { ok: true };
  }

  private async clearCenter(trx: Tx, variantId: number, exceptId?: number) {
    let q = trx.updateTable('catalog.variant_stone').set({ is_center: false }).where('variant_id', '=', variantId);
    if (exceptId) q = q.where('id', '<>', exceptId);
    await q.execute();
  }

  // ---- precios: nunca se sobrescriben, se cierra el vigente y se abre otro ------
  @Post('variants/:id/prices')
  setPrice(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(priceInput)) body: PriceInput,
  ) {
    return this.dbs.tx(u, async (trx) => {
      await trx
        .updateTable('pricing.price')
        .set({ valid_to: sql`now()` })
        .where('variant_id', '=', id)
        .where('price_list_id', '=', body.price_list_id)
        .where('min_quantity', '=', body.min_quantity)
        .where('valid_to', 'is', null)
        .execute();
      const p = await trx
        .insertInto('pricing.price')
        .values({
          ...body,
          variant_id: id,
          valid_from: sql`now() + interval '1 millisecond'`,
          created_by: u.id,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      if (body.mode !== 'manual') {
        // el monto calculado se guarda como caché, con su fecha (decisión 3)
        await sql`
          UPDATE pricing.price
             SET amount = COALESCE(pricing.resolve_price(variant_id, price_list_id, min_quantity,
                                                         now() + interval '1 millisecond'), amount),
                 recalculated_at = now()
           WHERE id = ${p.id}`.execute(trx);
      }
      return { id: p.id };
    });
  }

  @Delete('prices/:id')
  async closePrice(@CurrentUser() u: SessionUser, @Param('id', ParseIntPipe) id: number) {
    await this.dbs.tx(u, (trx) =>
      trx.updateTable('pricing.price').set({ valid_to: sql`now()` }).where('id', '=', id).where('valid_to', 'is', null).execute(),
    );
    return { ok: true };
  }

  @Get('variants/:id/price-history')
  priceHistory(@Param('id', ParseIntPipe) id: number) {
    return sql`
      SELECT pr.id, pr.mode, pr.amount, pr.valid_from, pr.valid_to, pl.name AS list_name, u.full_name AS user_name
      FROM pricing.price pr
      JOIN pricing.price_list pl ON pl.id = pr.price_list_id
      LEFT JOIN core.app_user u ON u.id = pr.created_by
      WHERE pr.variant_id = ${id}
      ORDER BY pr.valid_from DESC LIMIT 100`
      .execute(this.dbs.db)
      .then((r) => r.rows);
  }

  // ---- costo (solo usuarios con can_see_cost) ---------------------------------
  @Post('variants/:id/cost')
  setCost(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(costInput)) body: z.infer<typeof costInput>,
  ) {
    return this.dbs.tx(u, async (trx) => {
      const me = await trx.selectFrom('core.app_user').select('can_see_cost').where('id', '=', u.id).executeTakeFirst();
      if (!me?.can_see_cost) {
        throw new ForbiddenException('Su usuario no tiene permiso para ver ni editar costos');
      }
      await trx
        .updateTable('pricing.variant_cost')
        .set({ valid_to: sql`now()` })
        .where('variant_id', '=', id)
        .where('valid_to', 'is', null)
        .execute();
      return trx
        .insertInto('pricing.variant_cost')
        .values({
          variant_id: id,
          metal_cost: body.metal_cost ?? 0,
          stone_cost: body.stone_cost ?? 0,
          labor_cost: body.labor_cost ?? 0,
          plating_cost: body.plating_cost ?? 0,
          packaging_cost: body.packaging_cost ?? 0,
          other_cost: body.other_cost ?? 0,
          currency_code: body.currency_code,
          notes: body.notes,
          source: 'manual',
          valid_from: sql`now() + interval '1 millisecond'`,
          created_by: u.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }
}

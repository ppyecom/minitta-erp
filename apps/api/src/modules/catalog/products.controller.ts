import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { sql } from 'kysely';
import { ProductInput, productInput } from '@minitta/shared';
import { DbService, SessionUser, Tx } from '../../db/db.service';
import { CurrentUser, paging, zod } from '../../common/http';
import { MediaService } from './media.service';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly dbs: DbService,
    private readonly media: MediaService,
  ) {}

  @Get()
  async list(@Query() q: Record<string, string>) {
    const { page, pageSize, offset } = paging(q);
    const search = q.q?.trim() ? `%${q.q.trim()}%` : null;
    const where = sql`
      WHERE (${search}::text IS NULL
             OR p.name ILIKE ${search} OR p.code ILIKE ${search} OR p.legacy_code ILIKE ${search}
             OR EXISTS (SELECT 1 FROM catalog.variant v
                        WHERE v.product_id = p.id
                          AND (v.sku ILIKE ${search} OR v.legacy_code ILIKE ${search} OR v.barcode ILIKE ${search})))
        AND (${q.status || null}::text IS NULL OR p.status::text = ${q.status || null})
        AND (${q.kind || null}::text IS NULL OR p.kind::text = ${q.kind || null})
        AND (${q.material_id || null}::bigint IS NULL OR p.material_id = ${q.material_id || null}::bigint)
        AND (${q.category_id || null}::bigint IS NULL OR EXISTS (
              SELECT 1 FROM catalog.product_category pc
              JOIN catalog.category c ON c.id = pc.category_id
              JOIN catalog.category f ON f.id = ${q.category_id || null}::bigint
              WHERE pc.product_id = p.id AND c.path <@ f.path))`;

    const sort = q.sort === 'name' ? sql`p.name` : q.sort === 'code' ? sql`p.code` : sql`p.updated_at DESC`;

    const [rows, total] = await Promise.all([
      sql`
        SELECT p.id, p.code, p.name, p.kind, p.status, p.legacy_code, p.updated_at,
               m.name AS material_name, c.name AS category_name,
               (SELECT count(*) FROM catalog.variant v WHERE v.product_id = p.id AND v.status <> 'archived')::int AS variants,
               (SELECT COALESCE(sum(s.on_hand), 0) FROM inventory.stock s
                  JOIN catalog.variant v ON v.id = s.variant_id WHERE v.product_id = p.id) AS on_hand,
               (SELECT min(pr.amount) FROM pricing.price pr
                  JOIN catalog.variant v ON v.id = pr.variant_id
                  JOIN pricing.price_list pl ON pl.id = pr.price_list_id AND pl.code = 'publico'
                 WHERE v.product_id = p.id AND pr.valid_to IS NULL) AS price_from,
               (SELECT md.url FROM catalog.media md
                 WHERE md.kind = 'image' AND (md.product_id = p.id
                        OR md.variant_id IN (SELECT id FROM catalog.variant WHERE product_id = p.id))
                 ORDER BY md.is_primary DESC, md.sort_order, md.id LIMIT 1) AS image_url
        FROM catalog.product p
        LEFT JOIN catalog.material m ON m.id = p.material_id
        LEFT JOIN catalog.product_category pc ON pc.product_id = p.id AND pc.is_primary
        LEFT JOIN catalog.category c ON c.id = pc.category_id
        ${where}
        ORDER BY ${sort}, p.id DESC
        LIMIT ${pageSize} OFFSET ${offset}`.execute(this.dbs.db),
      sql<{ n: number }>`SELECT count(*)::int AS n FROM catalog.product p ${where}`.execute(this.dbs.db),
    ]);
    return { items: rows.rows, total: total.rows[0].n, page, pageSize };
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number, @Headers('x-user-id') userId?: string) {
    const db = this.dbs.db;
    const product = await sql<Record<string, unknown>>`
      SELECT p.*, pc.category_id, m.name AS material_name, m.is_priced_by_weight
      FROM catalog.product p
      LEFT JOIN catalog.product_category pc ON pc.product_id = p.id AND pc.is_primary
      LEFT JOIN catalog.material m ON m.id = p.material_id
      WHERE p.id = ${id}`
      .execute(db)
      .then((r) => r.rows[0]);
    if (!product) throw new NotFoundException('Producto no encontrado');

    const canSeeCost = userId
      ? Boolean(
          (
            await db
              .selectFrom('core.app_user')
              .select('can_see_cost')
              .where('id', '=', Number(userId) || 0)
              .executeTakeFirst()
          )?.can_see_cost,
        )
      : false;

    const [tags, media, variants, stones, prices, stock, costs] = await Promise.all([
      db.selectFrom('catalog.product_tag').select('tag_id').where('product_id', '=', id).execute(),
      db
        .selectFrom('catalog.media')
        .selectAll()
        .where((eb) =>
          eb.or([
            eb('product_id', '=', id),
            eb('variant_id', 'in', eb.selectFrom('catalog.variant').select('id').where('product_id', '=', id)),
          ]),
        )
        .orderBy('is_primary', 'desc')
        .orderBy('sort_order')
        .orderBy('id')
        .execute(),
      sql`
        SELECT v.*, sv.label AS size_value_label,
               (SELECT count(*) FROM inventory.serial_item si
                 WHERE si.variant_id = v.id AND si.status NOT IN ('sold','scrapped','lost'))::int AS serials
        FROM catalog.variant v
        LEFT JOIN catalog.size_value sv ON sv.id = v.size_value_id
        WHERE v.product_id = ${id}
        ORDER BY v.status = 'archived', sv.sort_order NULLS LAST, sv.value NULLS LAST, v.id`
        .execute(db)
        .then((r) => r.rows),
      sql`
        SELECT vs.*, s.name AS stone_name, s.is_gem, c.name AS color_name,
               cut.name AS cut_name, st.name AS setting_name
        FROM catalog.variant_stone vs
        JOIN catalog.variant v ON v.id = vs.variant_id
        JOIN catalog.stone s ON s.id = vs.stone_id
        LEFT JOIN catalog.color c ON c.code = vs.color_code
        LEFT JOIN catalog.stone_cut cut ON cut.code = vs.cut_code
        LEFT JOIN catalog.setting_type st ON st.code = vs.setting_code
        WHERE v.product_id = ${id}
        ORDER BY vs.is_center DESC, vs.id`
        .execute(db)
        .then((r) => r.rows),
      sql`
        SELECT pr.*, pl.code AS list_code, pl.name AS list_name, pl.currency_code,
               pricing.resolve_price(pr.variant_id, pr.price_list_id, pr.min_quantity) AS effective
        FROM pricing.price pr
        JOIN catalog.variant v ON v.id = pr.variant_id
        JOIN pricing.price_list pl ON pl.id = pr.price_list_id
        WHERE v.product_id = ${id} AND pr.valid_to IS NULL
        ORDER BY pl.priority, pr.min_quantity`
        .execute(db)
        .then((r) => r.rows),
      sql`
        SELECT s.variant_id, s.location_id, l.code AS location_code, l.name AS location_name,
               s.on_hand, s.reserved, s.in_transit, s.available, s.min_quantity, s.max_quantity
        FROM inventory.stock s
        JOIN catalog.variant v ON v.id = s.variant_id
        JOIN core.location l ON l.id = s.location_id
        WHERE v.product_id = ${id} AND (s.on_hand <> 0 OR s.reserved <> 0 OR s.in_transit <> 0 OR s.min_quantity <> 0)
        ORDER BY l.code`
        .execute(db)
        .then((r) => r.rows),
      canSeeCost
        ? sql`
            SELECT vc.* FROM pricing.variant_cost vc
            JOIN catalog.variant v ON v.id = vc.variant_id
            WHERE v.product_id = ${id} AND vc.valid_to IS NULL`
            .execute(db)
            .then((r) => r.rows)
        : Promise.resolve(null),
    ]);

    return {
      ...product,
      tag_ids: tags.map((t) => t.tag_id),
      media,
      variants,
      stones,
      prices,
      stock,
      costs,
      can_see_cost: canSeeCost,
    };
  }

  @Post()
  create(@CurrentUser() u: SessionUser, @Body(zod(productInput)) body: ProductInput) {
    return this.dbs.tx(u, async (trx) => {
      const { category_id, tag_ids, ...data } = body;
      const p = await trx
        .insertInto('catalog.product')
        .values({
          ...data,
          slug: sql`core.slugify(${data.name} || '-' || ${data.code})`,
          created_by: u.id,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      await this.saveRelations(trx, p.id, category_id, tag_ids);
      return { id: p.id };
    });
  }

  @Put(':id')
  update(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(productInput)) body: ProductInput,
  ) {
    return this.dbs.tx(u, async (trx) => {
      const { category_id, tag_ids, ...data } = body;
      await trx
        .updateTable('catalog.product')
        .set({
          ...data,
          discontinued_on:
            data.status === 'discontinued' || data.status === 'archived'
              ? sql`COALESCE(discontinued_on, current_date)`
              : null,
        })
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      await this.saveRelations(trx, id, category_id, tag_ids);
      return { id };
    });
  }

  private async saveRelations(trx: Tx, productId: number, categoryId: number | null, tagIds: number[]) {
    await trx.deleteFrom('catalog.product_category').where('product_id', '=', productId).execute();
    if (categoryId) {
      await trx
        .insertInto('catalog.product_category')
        .values({ product_id: productId, category_id: categoryId, is_primary: true })
        .execute();
    }
    await trx.deleteFrom('catalog.product_tag').where('product_id', '=', productId).execute();
    if (tagIds.length) {
      await trx
        .insertInto('catalog.product_tag')
        .values(tagIds.map((tag_id) => ({ product_id: productId, tag_id })))
        .execute();
    }
  }

  // ---- imágenes locales -------------------------------------------------------
  @Post(':id/media')
  @UseInterceptors(FilesInterceptor('files', 20, { limits: { fileSize: 25 * 1024 * 1024 } }))
  async upload(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('variant_id') variantId?: string,
  ) {
    const saved = await Promise.all((files ?? []).map((f) => this.media.saveImage(f, `products/${id}`)));
    return this.dbs.tx(u, async (trx) => {
      const has = await trx
        .selectFrom('catalog.media')
        .select('id')
        .where('product_id', '=', id)
        .where('is_primary', '=', true)
        .executeTakeFirst();
      const maxOrder = await trx
        .selectFrom('catalog.media')
        .select(sql<number>`COALESCE(max(sort_order), 0)`.as('m'))
        .where('product_id', '=', id)
        .executeTakeFirstOrThrow();
      const rows = saved.map((s, i) => ({
        product_id: id,
        variant_id: variantId ? Number(variantId) : null,
        kind: 'image' as const,
        storage_key: s.storageKey,
        url: s.url,
        mime_type: s.mime,
        width_px: s.width,
        height_px: s.height,
        bytes: s.bytes,
        alt_text: s.originalName,
        sort_order: maxOrder.m + i + 1,
        is_primary: !has && i === 0,
      }));
      if (!rows.length) return [];
      return trx.insertInto('catalog.media').values(rows).returningAll().execute();
    });
  }

  @Patch('media/:mediaId/primary')
  setPrimary(@CurrentUser() u: SessionUser, @Param('mediaId', ParseIntPipe) mediaId: number) {
    return this.dbs.tx(u, async (trx) => {
      const m = await trx.selectFrom('catalog.media').selectAll().where('id', '=', mediaId).executeTakeFirstOrThrow();
      await trx
        .updateTable('catalog.media')
        .set({ is_primary: false })
        .where('product_id', '=', m.product_id)
        .execute();
      await trx.updateTable('catalog.media').set({ is_primary: true }).where('id', '=', mediaId).execute();
      return { ok: true };
    });
  }

  @Delete('media/:mediaId')
  async removeMedia(@CurrentUser() u: SessionUser, @Param('mediaId', ParseIntPipe) mediaId: number) {
    const m = await this.dbs.tx(u, (trx) =>
      trx.deleteFrom('catalog.media').where('id', '=', mediaId).returningAll().executeTakeFirstOrThrow(),
    );
    await this.media.remove(m.storage_key);
    return { ok: true };
  }
}

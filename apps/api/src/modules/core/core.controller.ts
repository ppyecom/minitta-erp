import { Body, Controller, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { sql } from 'kysely';
import { LocationInput, UserInput, locationInput, userInput } from '@minitta/shared';
import { DbService, SessionUser } from '../../db/db.service';
import { CurrentUser, zod } from '../../common/http';

@Controller()
export class CoreController {
  constructor(private readonly dbs: DbService) {}

  /**
   * Todas las tablas de referencia en una sola llamada: la interfaz las cachea
   * y arma con ellas los combos de los formularios.
   */
  @Get('lookups')
  async lookups() {
    const db = this.dbs.db;
    const [
      currencies, units, taxCategories, materials, metalColors, finishes, stones, stoneCuts,
      settingTypes, colors, sizeScales, sizeValues, categories, collections, tags, priceLists,
      reasons, locations, users, suppliers,
    ] = await Promise.all([
      db.selectFrom('core.currency').selectAll().where('is_active', '=', true).orderBy('is_base', 'desc').execute(),
      db.selectFrom('core.unit').selectAll().orderBy('kind').orderBy('code').execute(),
      db.selectFrom('core.tax_category').selectAll().where('is_active', '=', true).execute(),
      db.selectFrom('catalog.material').selectAll().where('is_active', '=', true).orderBy('name').execute(),
      db.selectFrom('catalog.metal_color').selectAll().where('is_active', '=', true).orderBy('name').execute(),
      db.selectFrom('catalog.finish').selectAll().where('is_active', '=', true).orderBy('name').execute(),
      db.selectFrom('catalog.stone').selectAll().where('is_active', '=', true).orderBy('name').execute(),
      db.selectFrom('catalog.stone_cut').selectAll().where('is_active', '=', true).orderBy('name').execute(),
      db.selectFrom('catalog.setting_type').selectAll().where('is_active', '=', true).orderBy('name').execute(),
      db.selectFrom('catalog.color').selectAll().where('is_active', '=', true).orderBy('name').execute(),
      db.selectFrom('catalog.size_scale').selectAll().where('is_active', '=', true).execute(),
      db.selectFrom('catalog.size_value').selectAll().orderBy('size_scale_id').orderBy('sort_order').orderBy('value').execute(),
      db
        .selectFrom('catalog.category')
        .select(['id', 'parent_id', 'slug', 'name', 'level', 'sort_order', 'is_active'])
        .select(sql<string>`path::text`.as('path'))
        .orderBy(sql`path`)
        .execute(),
      db.selectFrom('catalog.collection').selectAll().where('is_active', '=', true).orderBy('name').execute(),
      db.selectFrom('catalog.tag').selectAll().where('is_active', '=', true).orderBy('name').execute(),
      db.selectFrom('pricing.price_list').selectAll().orderBy('priority').execute(),
      db.selectFrom('inventory.movement_reason').selectAll().where('is_active', '=', true).orderBy('name').execute(),
      db.selectFrom('core.location').selectAll().orderBy('is_active', 'desc').orderBy('code').execute(),
      db
        .selectFrom('core.app_user')
        .select(['id', 'username', 'full_name', 'can_see_cost', 'is_active', 'is_system'])
        .orderBy('is_system')
        .orderBy('full_name')
        .execute(),
      db.selectFrom('core.supplier').select(['id', 'code', 'name']).where('is_active', '=', true).orderBy('name').execute(),
    ]);
    return {
      currencies, units, taxCategories, materials, metalColors, finishes, stones, stoneCuts,
      settingTypes, colors, sizeScales, sizeValues, categories, collections, tags, priceLists,
      reasons, locations, users, suppliers,
    };
  }

  // ---- usuarios -------------------------------------------------------------
  @Get('users')
  users() {
    return this.dbs.db.selectFrom('core.app_user').selectAll().orderBy('is_system').orderBy('full_name').execute();
  }

  @Post('users')
  createUser(@CurrentUser() u: SessionUser, @Body(zod(userInput)) body: UserInput) {
    return this.dbs.tx(u, (trx) =>
      trx.insertInto('core.app_user').values(body).returningAll().executeTakeFirstOrThrow(),
    );
  }

  @Put('users/:id')
  updateUser(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(userInput)) body: UserInput,
  ) {
    return this.dbs.tx(u, (trx) =>
      trx.updateTable('core.app_user').set(body).where('id', '=', id).returningAll().executeTakeFirstOrThrow(),
    );
  }

  /** Primer arranque: si no hay usuarios de personas, crea el del administrador. */
  @Post('users/bootstrap')
  async bootstrap(@Body(zod(userInput)) body: UserInput) {
    const people = await this.dbs.db
      .selectFrom('core.app_user')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('is_system', '=', false)
      .executeTakeFirstOrThrow();
    if (people.n > 0) return { created: false };
    const user = await this.dbs.db
      .insertInto('core.app_user')
      .values({ ...body, can_see_cost: true })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { created: true, user };
  }

  // ---- sedes ----------------------------------------------------------------
  @Get('locations')
  locations() {
    return sql`
      SELECT l.*, u.full_name AS manager_name,
             COALESCE(s.skus, 0)::int AS skus, COALESCE(s.units, 0) AS units
      FROM core.location l
      LEFT JOIN core.app_user u ON u.id = l.manager_user_id
      LEFT JOIN (SELECT location_id, count(*) FILTER (WHERE on_hand <> 0) AS skus, sum(on_hand) AS units
                 FROM inventory.stock GROUP BY 1) s ON s.location_id = l.id
      ORDER BY l.is_active DESC, l.code`
      .execute(this.dbs.db)
      .then((r) => r.rows);
  }

  @Post('locations')
  createLocation(@CurrentUser() u: SessionUser, @Body(zod(locationInput)) body: LocationInput) {
    return this.dbs.tx(u, (trx) =>
      trx.insertInto('core.location').values(body).returningAll().executeTakeFirstOrThrow(),
    );
  }

  @Put('locations/:id')
  updateLocation(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(locationInput)) body: LocationInput,
  ) {
    return this.dbs.tx(u, (trx) =>
      trx.updateTable('core.location').set(body).where('id', '=', id).returningAll().executeTakeFirstOrThrow(),
    );
  }

  // ---- auditoría --------------------------------------------------------------
  @Get('audit/:entity/:id')
  audit(@Param('entity') entity: string, @Param('id', ParseIntPipe) id: number) {
    return sql`
      SELECT a.id, a.action, a.changed_at, a.client_info, a.diff, u.full_name AS user_name
      FROM core.audit_log a LEFT JOIN core.app_user u ON u.id = a.changed_by
      WHERE a.entity = ${entity} AND a.entity_id = ${id}
      ORDER BY a.changed_at DESC LIMIT 100`
      .execute(this.dbs.db)
      .then((r) => r.rows);
  }

  // ---- inicio -----------------------------------------------------------------
  @Get('dashboard')
  async dashboard() {
    const db = this.dbs.db;
    const kpis = await sql<Record<string, number>>`
      SELECT
        (SELECT count(*) FROM catalog.product WHERE status = 'active')::int        AS products_active,
        (SELECT count(*) FROM catalog.product WHERE status = 'draft')::int         AS products_draft,
        (SELECT count(*) FROM catalog.variant WHERE status = 'active')::int        AS variants_active,
        (SELECT count(*) FROM inventory.serial_item WHERE status = 'in_stock')::int AS serials_in_stock,
        (SELECT count(*) FROM inventory.serial_item WHERE status = 'in_workshop')::int AS serials_workshop,
        (SELECT COALESCE(sum(on_hand), 0) FROM inventory.stock s
           JOIN core.location l ON l.id = s.location_id WHERE l.is_active)          AS units_on_hand,
        (SELECT count(*) FROM inventory.v_reorder)::int                             AS below_min,
        (SELECT count(*) FROM inventory.transfer WHERE status = 'sent')::int        AS transfers_in_transit,
        (SELECT count(*) FROM inventory.count_sheet WHERE status IN ('open','counting'))::int AS counts_open,
        (SELECT count(*) FROM inventory.reservation WHERE status = 'active')::int   AS reservations_active,
        (SELECT count(*) FROM inventory.v_stock_integrity)::int                     AS integrity_drift,
        (SELECT count(*) FROM inventory.movement WHERE occurred_at >= current_date)::int AS movements_today
    `.execute(db);

    const [recent, byLocation, metal] = await Promise.all([
      sql`SELECT k.id, k.occurred_at, k.sku, k.location_code, k.type, k.quantity,
                 k.created_by_username, vf.product_name, vf.image_url
          FROM inventory.v_kardex k JOIN catalog.v_variant_full vf ON vf.variant_id = k.variant_id
          ORDER BY k.occurred_at DESC, k.id DESC LIMIT 8`.execute(db),
      sql`SELECT l.id, l.code, l.name, COALESCE(sum(s.on_hand), 0) AS units,
                 count(s.*) FILTER (WHERE s.on_hand <> 0)::int AS skus
          FROM core.location l LEFT JOIN inventory.stock s ON s.location_id = l.id
          WHERE l.is_active AND l.holds_stock
          GROUP BY l.id ORDER BY units DESC, l.code`.execute(db),
      sql`SELECT DISTINCT ON (m.id) m.id, m.code, m.name, r.price_per_gram, r.currency_code, r.valid_from
          FROM catalog.material m JOIN pricing.metal_rate r ON r.material_id = m.id
          WHERE r.valid_from <= current_date
          ORDER BY m.id, r.valid_from DESC`.execute(db),
    ]);
    return { kpis: kpis.rows[0], recent: recent.rows, byLocation: byLocation.rows, metal: metal.rows };
  }
}

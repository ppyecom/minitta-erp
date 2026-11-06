import { Body, Controller, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { categoryInput, materialInput, simpleCodeInput, stoneInput } from '@minitta/shared';
import { DbService, SessionUser } from '../../db/db.service';
import { CurrentUser, zod } from '../../common/http';

/** Tablas maestras del catálogo: piedras, materiales, categorías, colores, acabados. */
@Controller('masters')
export class MastersController {
  constructor(private readonly dbs: DbService) {}

  @Get('usage')
  usage() {
    // cuántas veces se usa cada maestro: para que la pantalla muestre qué se puede tocar
    return sql`
      SELECT 'stone' AS kind, stone_id AS id, count(*)::int AS n FROM catalog.variant_stone GROUP BY stone_id
      UNION ALL SELECT 'material', material_id, count(*)::int FROM catalog.product WHERE material_id IS NOT NULL GROUP BY material_id
      UNION ALL SELECT 'category', category_id, count(*)::int FROM catalog.product_category GROUP BY category_id`
      .execute(this.dbs.db)
      .then((r) => r.rows);
  }

  // ---- piedras ----------------------------------------------------------------
  @Post('stones')
  createStone(@CurrentUser() u: SessionUser, @Body(zod(stoneInput)) b: z.infer<typeof stoneInput>) {
    return this.dbs.tx(u, (trx) =>
      trx.insertInto('catalog.stone').values({ ...b, code: b.code.toUpperCase() }).returningAll().executeTakeFirstOrThrow(),
    );
  }

  @Put('stones/:id')
  updateStone(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(stoneInput)) b: z.infer<typeof stoneInput>,
  ) {
    return this.dbs.tx(u, (trx) =>
      trx.updateTable('catalog.stone').set(b).where('id', '=', id).returningAll().executeTakeFirstOrThrow(),
    );
  }

  // ---- materiales ---------------------------------------------------------------
  @Post('materials')
  createMaterial(@CurrentUser() u: SessionUser, @Body(zod(materialInput)) b: z.infer<typeof materialInput>) {
    return this.dbs.tx(u, (trx) =>
      trx.insertInto('catalog.material').values({ ...b, code: b.code.toUpperCase() }).returningAll().executeTakeFirstOrThrow(),
    );
  }

  @Put('materials/:id')
  updateMaterial(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(materialInput)) b: z.infer<typeof materialInput>,
  ) {
    return this.dbs.tx(u, (trx) =>
      trx.updateTable('catalog.material').set(b).where('id', '=', id).returningAll().executeTakeFirstOrThrow(),
    );
  }

  // ---- categorías (árbol ltree) ---------------------------------------------------
  @Post('categories')
  createCategory(@CurrentUser() u: SessionUser, @Body(zod(categoryInput)) b: z.infer<typeof categoryInput>) {
    return this.dbs.tx(u, async (trx) => {
      const r = await sql<{ id: number }>`
        INSERT INTO catalog.category (parent_id, slug, name, path, description, sort_order)
        SELECT ${b.parent_id}::bigint, s.slug, ${b.name},
               CASE WHEN ${b.parent_id}::bigint IS NULL THEN text2ltree(s.label)
                    ELSE (SELECT path FROM catalog.category WHERE id = ${b.parent_id}::bigint) || text2ltree(s.label) END,
               ${b.description}, ${b.sort_order}
        FROM (SELECT COALESCE(${b.slug}, core.slugify(${b.name})) AS slug,
                     replace(COALESCE(${b.slug}, core.slugify(${b.name})), '-', '_') AS label) s
        RETURNING id`.execute(trx);
      return r.rows[0];
    });
  }

  @Put('categories/:id')
  updateCategory(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(categoryInput.pick({ name: true, description: true, sort_order: true }))) b: {
      name: string;
      description: string | null;
      sort_order: number;
    },
  ) {
    // solo nombre y orden: mover una rama cambia el path de todos sus hijos (otra migración)
    return this.dbs.tx(u, (trx) =>
      trx.updateTable('catalog.category').set(b).where('id', '=', id).returningAll().executeTakeFirstOrThrow(),
    );
  }

  // ---- tablas de código + nombre ------------------------------------------------------
  @Post('colors')
  createColor(@CurrentUser() u: SessionUser, @Body(zod(simpleCodeInput)) b: z.infer<typeof simpleCodeInput>) {
    return this.dbs.tx(u, (trx) =>
      trx.insertInto('catalog.color').values({ code: b.code.toLowerCase(), name: b.name, hex: b.hex }).returningAll().executeTakeFirstOrThrow(),
    );
  }

  @Post('metal-colors')
  createMetalColor(@CurrentUser() u: SessionUser, @Body(zod(simpleCodeInput)) b: z.infer<typeof simpleCodeInput>) {
    return this.dbs.tx(u, (trx) =>
      trx.insertInto('catalog.metal_color').values({ code: b.code.toLowerCase(), name: b.name, hex: b.hex }).returningAll().executeTakeFirstOrThrow(),
    );
  }

  @Post('finishes')
  createFinish(@CurrentUser() u: SessionUser, @Body(zod(simpleCodeInput)) b: z.infer<typeof simpleCodeInput>) {
    return this.dbs.tx(u, (trx) =>
      trx.insertInto('catalog.finish').values({ code: b.code.toLowerCase(), name: b.name }).returningAll().executeTakeFirstOrThrow(),
    );
  }

  @Post('stone-cuts')
  createCut(@CurrentUser() u: SessionUser, @Body(zod(simpleCodeInput)) b: z.infer<typeof simpleCodeInput>) {
    return this.dbs.tx(u, (trx) =>
      trx.insertInto('catalog.stone_cut').values({ code: b.code.toLowerCase(), name: b.name }).returningAll().executeTakeFirstOrThrow(),
    );
  }

  @Post('setting-types')
  createSetting(@CurrentUser() u: SessionUser, @Body(zod(simpleCodeInput)) b: z.infer<typeof simpleCodeInput>) {
    return this.dbs.tx(u, (trx) =>
      trx.insertInto('catalog.setting_type').values({ code: b.code.toLowerCase(), name: b.name }).returningAll().executeTakeFirstOrThrow(),
    );
  }

  @Post('collections')
  createCollection(@CurrentUser() u: SessionUser, @Body(zod(simpleCodeInput)) b: z.infer<typeof simpleCodeInput>) {
    return this.dbs.tx(u, (trx) =>
      trx.insertInto('catalog.collection').values({ code: b.code.toUpperCase(), name: b.name }).returningAll().executeTakeFirstOrThrow(),
    );
  }

  @Post('tags')
  createTag(@CurrentUser() u: SessionUser, @Body(zod(simpleCodeInput)) b: z.infer<typeof simpleCodeInput>) {
    return this.dbs.tx(u, (trx) =>
      trx
        .insertInto('catalog.tag')
        .values({ slug: sql`core.slugify(${b.code})`, name: b.name })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }
}

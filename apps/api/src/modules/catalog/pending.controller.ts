import { Controller, Get, Query } from '@nestjs/common';
import { sql } from 'kysely';
import { DbService } from '../../db/db.service';
import { paging } from '../../common/http';

/**
 * Lista de trabajo del personal: qué le falta a cada artículo.
 *
 * Se apoya en catalog.v_pending, que calcula los motivos sobre el dato de hoy.
 * No consulta el esquema `migration`: una variante sale de la lista en cuanto
 * alguien completa el dato, sin que nadie tenga que marcarla como resuelta.
 */
@Controller('pending')
export class PendingController {
  constructor(private readonly dbs: DbService) {}

  @Get()
  async list(@Query() q: Record<string, string>) {
    const { page, pageSize, offset } = paging(q, 50);
    const where = sql`
      WHERE (${q.reason || null}::text IS NULL OR ${q.reason || null} = ANY(p.reasons))
        AND (${q.blocking || null}::text IS NULL OR p.blocks_sale)
        AND (${q.q || null}::text IS NULL
             OR p.sku ILIKE '%' || ${q.q || null} || '%'
             OR p.product_name ILIKE '%' || ${q.q || null} || '%'
             OR p.legacy_code ILIKE '%' || ${q.q || null} || '%')`;

    const [rows, total, summary] = await Promise.all([
      sql`
        SELECT p.* FROM catalog.v_pending p
        ${where}
        ORDER BY p.blocks_sale DESC, cardinality(p.reasons) DESC, p.product_name, p.sku
        LIMIT ${pageSize} OFFSET ${offset}`.execute(this.dbs.db),
      sql<{ n: number }>`SELECT count(*)::int AS n FROM catalog.v_pending p ${where}`.execute(this.dbs.db),
      // el conteo por motivo es sobre TODO, no sobre el filtro: es el reparto de trabajo
      sql`
        SELECT r.reason, count(*)::int AS items,
               count(*) FILTER (WHERE p.blocks_sale)::int AS blocking
        FROM catalog.v_pending p, unnest(p.reasons) AS r(reason)
        GROUP BY r.reason ORDER BY count(*) DESC`.execute(this.dbs.db),
    ]);

    const totals = await sql<{ pending: number; blocking: number; sellable: number }>`
      SELECT (SELECT count(*) FROM catalog.v_pending)::int                      AS pending,
             (SELECT count(*) FROM catalog.v_pending WHERE blocks_sale)::int    AS blocking,
             (SELECT count(*) FROM catalog.variant v
                JOIN catalog.product pr ON pr.id = v.product_id
               WHERE pr.status = 'active' AND v.status = 'active')::int         AS sellable`
      .execute(this.dbs.db)
      .then((r) => r.rows[0]);

    return {
      items: rows.rows,
      total: total.rows[0].n,
      page,
      pageSize,
      summary: summary.rows,
      totals,
    };
  }
}

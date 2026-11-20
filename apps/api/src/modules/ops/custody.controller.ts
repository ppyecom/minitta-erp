import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { CustodyInput, custodyDeliverInput, custodyInput, custodyMoveInput } from '@minitta/shared';
import { DbService, SessionUser } from '../../db/db.service';
import { CurrentUser, paging, zod } from '../../common/http';
import { Requires } from '../../auth/auth.guard';

/**
 * Custodia: piezas de clientes. NO son inventario y no tienen variante — por eso
 * no pueden aparecer en inventory.movement. Toda la trazabilidad vive en
 * ops.custody_event, que es append-only.
 */
@Requires('inventory.read')
@Controller('ops/custody')
export class CustodyController {
  constructor(private readonly dbs: DbService) {}

  @Get()
  async list(@Query() q: Record<string, string>) {
    const { page, pageSize, offset } = paging(q);
    const where = sql`
      WHERE (${q.status || null}::text IS NULL OR c.status::text = ${q.status || null})
        AND (${q.location_id || null}::bigint IS NULL OR c.location_id = ${q.location_id || null}::bigint)
        AND (${q.pending || null}::text IS NULL OR c.status <> 'delivered')
        AND (${q.q || null}::text IS NULL
             OR c.customer_name ILIKE '%' || ${q.q || null} || '%'
             OR c.code ILIKE '%' || ${q.q || null} || '%'
             OR c.description ILIKE '%' || ${q.q || null} || '%')`;
    const [rows, total] = await Promise.all([
      sql`
        SELECT c.*, l.code AS location_code, l.name AS location_name,
               m.name AS material_name, u.full_name AS received_by_name,
               (c.promised_on IS NOT NULL AND c.promised_on < current_date
                AND c.status <> 'delivered') AS is_overdue,
               (SELECT count(*)::int FROM ops.custody_event e WHERE e.custody_item_id = c.id) AS events,
               (SELECT w.code FROM ops.work_order w
                 WHERE w.custody_item_id = c.id AND w.status NOT IN ('closed','cancelled')
                 ORDER BY w.id DESC LIMIT 1) AS open_work_order
        FROM ops.custody_item c
        JOIN core.location l ON l.id = c.location_id
        LEFT JOIN catalog.material m ON m.id = c.material_id
        LEFT JOIN core.app_user u ON u.id = c.received_by
        ${where}
        ORDER BY (c.status <> 'delivered') DESC, c.received_at DESC
        LIMIT ${pageSize} OFFSET ${offset}`.execute(this.dbs.db),
      sql<{ n: number }>`SELECT count(*)::int AS n FROM ops.custody_item c ${where}`.execute(this.dbs.db),
    ]);
    return { items: rows.rows, total: total.rows[0].n, page, pageSize };
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const item = await sql`
      SELECT c.*, l.code AS location_code, l.name AS location_name,
             m.name AS material_name, u.full_name AS received_by_name,
             ud.full_name AS delivered_by_name
      FROM ops.custody_item c
      JOIN core.location l ON l.id = c.location_id
      LEFT JOIN catalog.material m ON m.id = c.material_id
      LEFT JOIN core.app_user u ON u.id = c.received_by
      LEFT JOIN core.app_user ud ON ud.id = c.delivered_by
      WHERE c.id = ${id}`
      .execute(this.dbs.db)
      .then((r) => r.rows[0] as Record<string, unknown> | undefined);
    if (!item) throw new NotFoundException('Pieza en custodia no encontrada');

    const [events, orders] = await Promise.all([
      sql`
        SELECT e.id, e.kind, e.occurred_at, e.weight_g, e.notes,
               lf.name AS from_location, lt.name AS to_location,
               u.full_name AS registered_by, w.code AS work_order,
               e.weight_g - ${item.received_weight_g as number} AS weight_diff_g
        FROM ops.custody_event e
        LEFT JOIN core.location lf ON lf.id = e.from_location_id
        LEFT JOIN core.location lt ON lt.id = e.to_location_id
        LEFT JOIN core.app_user u ON u.id = e.created_by
        LEFT JOIN ops.work_order w ON w.id = e.work_order_id
        WHERE e.custody_item_id = ${id}
        ORDER BY e.occurred_at, e.id`.execute(this.dbs.db),
      sql`
        SELECT w.id, w.code, w.kind, w.status, w.promised_on
        FROM ops.work_order w WHERE w.custody_item_id = ${id} ORDER BY w.id DESC`.execute(this.dbs.db),
    ]);
    return { ...item, events: events.rows, work_orders: orders.rows };
  }

  @Requires('ops.custody')
  @Post()
  create(@CurrentUser() u: SessionUser, @Body(zod(custodyInput)) b: CustodyInput) {
    return this.dbs.tx(u, async (trx) => {
      const code = await sql<{ c: string }>`
        SELECT 'CUS-' || to_char(now(), 'YYMM') || '-' ||
               lpad((count(*) + 1)::text, 4, '0') AS c
        FROM ops.custody_item
        WHERE received_at >= date_trunc('month', now())`
        .execute(trx)
        .then((r) => r.rows[0].c);
      return trx
        .insertInto('ops.custody_item')
        .values({ ...b, code, received_by: u.id })
        .returning(['id', 'code'])
        .executeTakeFirstOrThrow();
    });
  }

  /** Mover la pieza (al taller, a otra sede): escribe el eslabón de la cadena. */
  @Requires('ops.custody')
  @Post(':id/move')
  move(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(custodyMoveInput)) b: z.infer<typeof custodyMoveInput>,
  ) {
    return this.dbs.tx(u, async (trx) => {
      await sql`SELECT ops.move_custody(${id}::bigint, ${b.to_location_id}::bigint, ${u.id}::bigint,
                                        ${b.kind}::ops.custody_event_kind, ${b.weight_g}::numeric,
                                        ${b.notes}::text)`.execute(trx);
      return { ok: true };
    });
  }

  /** Entrega al cliente: exige el peso de salida y cierra la cadena. */
  @Requires('ops.custody')
  @Post(':id/deliver')
  deliver(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(custodyDeliverInput)) b: z.infer<typeof custodyDeliverInput>,
  ) {
    return this.dbs.tx(u, async (trx) => {
      await sql`SELECT ops.deliver_custody(${id}::bigint, ${b.delivered_to}, ${b.weight_g}::numeric,
                                           ${u.id}::bigint, ${b.notes}::text)`.execute(trx);
      return { ok: true };
    });
  }
}

import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  ConsignmentInput,
  consignmentInput,
  consignmentMoveInput,
  settlementInput,
} from '@minitta/shared';
import { DbService, SessionUser } from '../../db/db.service';
import { CurrentUser, paging, zod } from '../../common/http';
import { Requires } from '../../auth/auth.guard';

/** Mercadería en poder de un tercero: qué tiene, qué vendió y qué nos debe. */
@Requires('inventory.read')
@Controller('ops/consignments')
export class ConsignmentsController {
  constructor(private readonly dbs: DbService) {}

  @Get()
  async list(@Query() q: Record<string, string>) {
    const { page, pageSize, offset } = paging(q);
    const where = sql`
      WHERE (${q.status || null}::text IS NULL OR c.status::text = ${q.status || null})`;
    const [rows, total] = await Promise.all([
      sql`
        SELECT c.*, lp.code AS partner_code, lp.name AS partner_location_name,
               lf.code AS from_code, u.full_name AS responsible_name,
               (SELECT count(*)::int FROM ops.consignment_line l WHERE l.consignment_id = c.id) AS lines,
               (SELECT COALESCE(sum(l.quantity_sent), 0) FROM ops.consignment_line l WHERE l.consignment_id = c.id) AS units_sent,
               (SELECT COALESCE(sum(l.quantity_sent - l.quantity_sold - l.quantity_returned), 0)
                  FROM ops.consignment_line l WHERE l.consignment_id = c.id) AS units_pending,
               (c.due_on IS NOT NULL AND c.due_on < current_date AND c.status = 'active') AS is_overdue
        FROM ops.consignment c
        JOIN core.location lp ON lp.id = c.partner_location_id
        JOIN core.location lf ON lf.id = c.from_location_id
        LEFT JOIN core.app_user u ON u.id = c.responsible_user_id
        ${where}
        ORDER BY (c.status = 'active') DESC, c.started_on DESC
        LIMIT ${pageSize} OFFSET ${offset}`.execute(this.dbs.db),
      sql<{ n: number }>`SELECT count(*)::int AS n FROM ops.consignment c ${where}`.execute(this.dbs.db),
    ]);
    return { items: rows.rows, total: total.rows[0].n, page, pageSize };
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const c = await sql`
      SELECT c.*, lp.code AS partner_code, lp.name AS partner_location_name,
             lf.code AS from_code, lf.name AS from_name, u.full_name AS responsible_name
      FROM ops.consignment c
      JOIN core.location lp ON lp.id = c.partner_location_id
      JOIN core.location lf ON lf.id = c.from_location_id
      LEFT JOIN core.app_user u ON u.id = c.responsible_user_id
      WHERE c.id = ${id}`
      .execute(this.dbs.db)
      .then((r) => r.rows[0]);
    if (!c) throw new NotFoundException('Consignación no encontrada');

    const [lines, settlements] = await Promise.all([
      sql`
        SELECT l.*, vf.sku, vf.product_name, vf.image_url, si.serial_code,
               l.quantity_sent - l.quantity_sold - l.quantity_returned AS quantity_pending
        FROM ops.consignment_line l
        JOIN catalog.v_variant_full vf ON vf.variant_id = l.variant_id
        LEFT JOIN inventory.serial_item si ON si.id = l.serial_id
        WHERE l.consignment_id = ${id} ORDER BY l.id`.execute(this.dbs.db),
      sql`
        SELECT s.*, u.full_name AS settled_by_name
        FROM ops.consignment_settlement s
        LEFT JOIN core.app_user u ON u.id = s.settled_by
        WHERE s.consignment_id = ${id} ORDER BY s.settled_at DESC`.execute(this.dbs.db),
    ]);
    return { ...c, lines: lines.rows, settlements: settlements.rows };
  }

  @Requires('ops.consignment')
  @Post()
  create(@CurrentUser() u: SessionUser, @Body(zod(consignmentInput)) b: ConsignmentInput) {
    return this.dbs.tx(u, async (trx) => {
      const { lines, ...head } = b;
      const code = await sql<{ c: string }>`
        SELECT 'CON-' || to_char(now(), 'YYMM') || '-' ||
               lpad((count(*) + 1)::text, 4, '0') AS c
        FROM ops.consignment WHERE created_at >= date_trunc('month', now())`
        .execute(trx)
        .then((r) => r.rows[0].c);
      const c = await trx
        .insertInto('ops.consignment')
        .values({ ...head, code, created_by: u.id })
        .returning(['id', 'code'])
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('ops.consignment_line')
        .values(lines.map((l) => ({ ...l, consignment_id: c.id })))
        .execute();
      return c;
    });
  }

  @Requires('ops.consignment')
  @Post(':id/send')
  send(@CurrentUser() u: SessionUser, @Param('id', ParseIntPipe) id: number) {
    return this.dbs.tx(u, async (trx) => {
      await sql`SELECT ops.send_consignment(${id}::bigint, ${u.id}::bigint)`.execute(trx);
      return { ok: true };
    });
  }

  @Requires('ops.consignment')
  @Post(':id/lines/:lineId/sale')
  sale(
    @CurrentUser() u: SessionUser,
    @Param('lineId', ParseIntPipe) lineId: number,
    @Body(zod(consignmentMoveInput)) b: z.infer<typeof consignmentMoveInput>,
  ) {
    return this.dbs.tx(u, async (trx) => {
      await sql`SELECT ops.report_consignment_sale(${lineId}::bigint, ${b.quantity}::numeric, ${u.id}::bigint)`.execute(trx);
      return { ok: true };
    });
  }

  @Requires('ops.consignment')
  @Post(':id/lines/:lineId/return')
  returnLine(
    @CurrentUser() u: SessionUser,
    @Param('lineId', ParseIntPipe) lineId: number,
    @Body(zod(consignmentMoveInput)) b: z.infer<typeof consignmentMoveInput>,
  ) {
    return this.dbs.tx(u, async (trx) => {
      await sql`SELECT ops.return_consignment(${lineId}::bigint, ${b.quantity}::numeric, ${u.id}::bigint)`.execute(trx);
      return { ok: true };
    });
  }

  @Requires('ops.consignment.settle')
  @Post(':id/settle')
  settle(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(settlementInput)) b: z.infer<typeof settlementInput>,
  ) {
    return this.dbs.tx(u, async (trx) => {
      const r = await sql<{ id: number }>`
        SELECT ops.settle_consignment(${id}::bigint, ${b.period_from}::date,
                                      ${b.period_to}::date, ${u.id}::bigint) AS id`.execute(trx);
      return { id: r.rows[0].id };
    });
  }
}

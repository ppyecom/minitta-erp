import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { layawayPaymentInput } from '@minitta/shared';
import { DbService, SessionUser } from '../../db/db.service';
import { CurrentUser, zod } from '../../common/http';
import { Requires } from '../../auth/auth.guard';

/**
 * Lo transversal de los procesos: dónde está todo, qué está vencido, y los
 * apartados con sus cuotas.
 */
@Requires('inventory.read')
@Controller('ops')
export class OpsController {
  constructor(private readonly dbs: DbService) {}

  /** Todo lo que en este momento NO está en una sede. */
  @Get('pieces-out')
  async piecesOut(@Query() q: Record<string, string>) {
    const rows = await sql`
      SELECT * FROM ops.v_pieces_out
      WHERE (${q.kind || null}::text IS NULL OR kind = ${q.kind || null})
        AND (${q.overdue || null}::text IS NULL OR is_overdue)
      ORDER BY is_overdue DESC, days_out DESC, kind`.execute(this.dbs.db);
    const summary = await sql`
      SELECT kind, count(*)::int AS items,
             count(*) FILTER (WHERE is_overdue)::int AS overdue,
             max(days_out)::int AS max_days
      FROM ops.v_pieces_out GROUP BY kind ORDER BY kind`.execute(this.dbs.db);
    return { items: rows.rows, summary: summary.rows };
  }

  /** Lo que ya debería haber vuelto. */
  @Get('overdue')
  async overdue() {
    const rows = await sql`SELECT * FROM ops.v_overdue ORDER BY days_out DESC`.execute(this.dbs.db);
    return { items: rows.rows };
  }

  /** Cuánto oro se pierde por tipo de trabajo, contra el estándar. */
  @Get('loss-summary')
  async lossSummary() {
    const rows = await sql`SELECT * FROM ops.v_loss_summary ORDER BY loss_g DESC NULLS LAST`.execute(
      this.dbs.db,
    );
    const standards = await sql`
      SELECT s.*, m.name AS material_name FROM ops.loss_standard s
      LEFT JOIN catalog.material m ON m.id = s.material_id
      WHERE s.is_active ORDER BY s.work_order_kind`.execute(this.dbs.db);
    return { items: rows.rows, standards: standards.rows };
  }

  @Get('layaways')
  async layaways(@Query() q: Record<string, string>) {
    const rows = await sql`
      SELECT b.*, b.deposit + b.paid AS total_paid,
             (b.status = 'active' AND b.expires_at IS NOT NULL AND b.expires_at < now()) AS is_overdue
      FROM ops.v_layaway_balance b
      WHERE (${q.status || null}::text IS NULL OR b.status::text = ${q.status || null})
      ORDER BY (b.status = 'active') DESC, b.reserved_at DESC`.execute(this.dbs.db);
    return { items: rows.rows };
  }

  @Get('layaways/:id/payments')
  async payments(@Param('id', ParseIntPipe) id: number) {
    const rows = await sql`
      SELECT p.*, u.full_name AS received_by_name
      FROM ops.layaway_payment p
      LEFT JOIN core.app_user u ON u.id = p.received_by
      WHERE p.reservation_id = ${id} ORDER BY p.paid_at`.execute(this.dbs.db);
    return { items: rows.rows };
  }

  @Requires('ops.layaway')
  @Post('layaways/:id/payments')
  addPayment(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(layawayPaymentInput)) b: z.infer<typeof layawayPaymentInput>,
  ) {
    return this.dbs.tx(u, async (trx) => {
      const r = await sql<{ paid: number }>`
        SELECT ops.register_layaway_payment(${id}::bigint, ${b.amount}::numeric,
                                            ${b.currency_code}::char(3), ${u.id}::bigint,
                                            ${b.method}::ops.payment_method,
                                            ${b.receipt_no}::text) AS paid`.execute(trx);
      return { paid: r.rows[0].paid };
    });
  }

  /** Caduca los apartados vencidos y libera la pieza reservada. */
  @Requires('ops.layaway')
  @Post('layaways/expire')
  expire(@CurrentUser() u: SessionUser) {
    return this.dbs.tx(u, async (trx) => {
      const r = await sql<{ n: number }>`SELECT ops.expire_layaways(${u.id}::bigint)::int AS n`.execute(trx);
      return { expired: r.rows[0].n };
    });
  }
}

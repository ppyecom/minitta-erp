import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  WorkOrderInput,
  workOrderInput,
  workOrderItemInput,
  workOrderLossInput,
  workOrderOutputInput,
} from '@minitta/shared';
import { DbService, SessionUser } from '../../db/db.service';
import { CurrentUser, paging, zod } from '../../common/http';
import { Requires } from '../../auth/auth.guard';

/**
 * Órdenes de taller. El cierre pasa SIEMPRE por ops.close_work_order(), que
 * valida el cuadre de gramos y la aprobación de la merma: un UPDATE directo
 * sobre el estado saltearía el control.
 */
@Requires('inventory.read')
@Controller('ops/work-orders')
export class WorkOrdersController {
  constructor(private readonly dbs: DbService) {}

  @Get()
  async list(@Query() q: Record<string, string>) {
    const { page, pageSize, offset } = paging(q);
    const open = q.open === 'true';
    const where = sql`
      WHERE (${q.status || null}::text IS NULL OR w.status::text = ${q.status || null})
        AND (${q.kind || null}::text IS NULL OR w.kind::text = ${q.kind || null})
        AND (${q.location_id || null}::bigint IS NULL OR w.location_id = ${q.location_id || null}::bigint)
        AND (${open}::boolean IS NOT TRUE OR w.status NOT IN ('closed','cancelled'))`;
    const [rows, total] = await Promise.all([
      sql`
        SELECT w.*, l.code AS location_code, l.name AS location_name,
               u.full_name AS assigned_user_name, s.name AS assigned_supplier_name,
               c.code AS custody_code, cuc.name AS customer_name,
               b.input_g, b.output_g, b.recovered_g, b.loss_g, b.diff_g, b.loss_pct,
               b.max_loss_pct, b.balanced,
               (w.promised_on IS NOT NULL AND w.promised_on < current_date
                AND w.status NOT IN ('closed','cancelled')) AS is_overdue
        FROM ops.work_order w
        JOIN core.location l ON l.id = w.location_id
        JOIN ops.v_work_order_balance b ON b.id = w.id
        LEFT JOIN core.app_user u ON u.id = w.assigned_user_id
        LEFT JOIN core.supplier s ON s.id = w.assigned_supplier_id
        LEFT JOIN ops.custody_item c ON c.id = w.custody_item_id
        LEFT JOIN core.customer cuc ON cuc.id = c.customer_id
        ${where}
        ORDER BY (w.status NOT IN ('closed','cancelled')) DESC, w.opened_at DESC
        LIMIT ${pageSize} OFFSET ${offset}`.execute(this.dbs.db),
      sql<{ n: number }>`SELECT count(*)::int AS n FROM ops.work_order w ${where}`.execute(this.dbs.db),
    ]);
    return { items: rows.rows, total: total.rows[0].n, page, pageSize };
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const w = await sql`
      SELECT w.*, l.code AS location_code, l.name AS location_name,
             u.full_name AS assigned_user_name, s.name AS assigned_supplier_name,
             c.code AS custody_code, cuc.name AS customer_name, c.description AS custody_description,
             b.input_g, b.output_g, b.recovered_g, b.loss_g, b.diff_g, b.loss_pct,
             b.max_loss_pct, b.balanced
      FROM ops.work_order w
      JOIN core.location l ON l.id = w.location_id
      JOIN ops.v_work_order_balance b ON b.id = w.id
      LEFT JOIN core.app_user u ON u.id = w.assigned_user_id
      LEFT JOIN core.supplier s ON s.id = w.assigned_supplier_id
      LEFT JOIN ops.custody_item c ON c.id = w.custody_item_id
      LEFT JOIN core.customer cuc ON cuc.id = c.customer_id
      WHERE w.id = ${id}`
      .execute(this.dbs.db)
      .then((r) => r.rows[0]);
    if (!w) throw new NotFoundException('Orden de taller no encontrada');

    const [inputs, outputs, losses] = await Promise.all([
      sql`
        SELECT i.*, vf.sku, vf.product_name, vf.image_url, vf.tracking_mode,
               si.serial_code, cu.code AS custody_code, cu.description AS custody_description,
               m.name AS material_name, lf.code AS from_location_code
        FROM ops.work_order_input i
        LEFT JOIN catalog.v_variant_full vf ON vf.variant_id = i.variant_id
        LEFT JOIN inventory.serial_item si ON si.id = i.serial_id
        LEFT JOIN ops.custody_item cu ON cu.id = i.custody_item_id
        LEFT JOIN catalog.material m ON m.id = i.material_id
        LEFT JOIN core.location lf ON lf.id = i.from_location_id
        WHERE i.work_order_id = ${id} ORDER BY i.id`.execute(this.dbs.db),
      sql`
        SELECT o.*, vf.sku, vf.product_name, vf.image_url, vf.tracking_mode,
               si.serial_code, cu.code AS custody_code, lt.code AS to_location_code
        FROM ops.work_order_output o
        LEFT JOIN catalog.v_variant_full vf ON vf.variant_id = o.variant_id
        LEFT JOIN inventory.serial_item si ON si.id = o.serial_id
        LEFT JOIN ops.custody_item cu ON cu.id = o.custody_item_id
        LEFT JOIN core.location lt ON lt.id = o.to_location_id
        WHERE o.work_order_id = ${id} ORDER BY o.id`.execute(this.dbs.db),
      sql`
        SELECT ls.*, m.name AS material_name, ua.full_name AS approved_by_name,
               uc.full_name AS created_by_name
        FROM ops.work_order_loss ls
        LEFT JOIN catalog.material m ON m.id = ls.material_id
        LEFT JOIN core.app_user ua ON ua.id = ls.approved_by
        LEFT JOIN core.app_user uc ON uc.id = ls.created_by
        WHERE ls.work_order_id = ${id} ORDER BY ls.id`.execute(this.dbs.db),
    ]);
    return { ...w, inputs: inputs.rows, outputs: outputs.rows, losses: losses.rows };
  }

  @Requires('ops.workshop')
  @Post()
  create(@CurrentUser() u: SessionUser, @Body(zod(workOrderInput)) b: WorkOrderInput) {
    return this.dbs.tx(u, async (trx) => {
      const code = await sql<{ c: string }>`
        SELECT 'OT-' || to_char(now(), 'YYMM') || '-' ||
               lpad((count(*) + 1)::text, 4, '0') AS c
        FROM ops.work_order WHERE opened_at >= date_trunc('month', now())`
        .execute(trx)
        .then((r) => r.rows[0].c);
      return trx
        .insertInto('ops.work_order')
        .values({ ...b, code, status: 'open', created_by: u.id })
        .returning(['id', 'code'])
        .executeTakeFirstOrThrow();
    });
  }

  @Requires('ops.workshop')
  @Post(':id/inputs')
  addInput(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(workOrderItemInput)) b: z.infer<typeof workOrderItemInput>,
  ) {
    return this.dbs.tx(u, (trx) =>
      trx
        .insertInto('ops.work_order_input')
        .values({ ...b, work_order_id: id })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
  }

  @Requires('ops.workshop')
  @Post(':id/outputs')
  addOutput(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(workOrderOutputInput)) b: z.infer<typeof workOrderOutputInput>,
  ) {
    return this.dbs.tx(u, (trx) =>
      trx
        .insertInto('ops.work_order_output')
        .values({ ...b, work_order_id: id })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
  }

  @Requires('ops.workshop')
  @Post(':id/losses')
  addLoss(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(workOrderLossInput)) b: z.infer<typeof workOrderLossInput>,
  ) {
    return this.dbs.tx(u, (trx) =>
      trx
        .insertInto('ops.work_order_loss')
        .values({ ...b, work_order_id: id, created_by: u.id })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
  }

  /**
   * Firma de la merma que supera el estándar. La regla de que firme otro ya no es
   * decorativa: con el login real, la restricción wo_loss_approver_is_someone_else
   * (012) la impone en la base. Acá sólo se traduce a un mensaje entendible.
   */
  @Requires('ops.loss.approve')
  @Post(':id/losses/:lossId/approve')
  approveLoss(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('lossId', ParseIntPipe) lossId: number,
  ) {
    return this.dbs.tx(u, async (trx) => {
      const loss = await trx
        .selectFrom('ops.work_order_loss')
        .select('created_by')
        .where('id', '=', lossId)
        .where('work_order_id', '=', id)
        .executeTakeFirst();
      if (!loss) throw new NotFoundException('No existe esa merma en la orden');
      if (loss.created_by === u.id) {
        throw new ForbiddenException(
          'La merma la tiene que firmar otra persona: usted fue quien la cargó.',
        );
      }
      await trx
        .updateTable('ops.work_order_loss')
        .set({ approved_by: u.id, approved_at: new Date() })
        .where('id', '=', lossId)
        .where('work_order_id', '=', id)
        .execute();
      return { ok: true };
    });
  }

  @Requires('ops.workshop')
  @Post(':id/start')
  start(@CurrentUser() u: SessionUser, @Param('id', ParseIntPipe) id: number) {
    return this.dbs.tx(u, async (trx) => {
      await sql`SELECT ops.start_work_order(${id}::bigint, ${u.id}::bigint)`.execute(trx);
      return { ok: true };
    });
  }

  /** Acá se valida el cuadre de gramos. Si no cuadra, la base lo rechaza. */
  @Requires('ops.workshop')
  @Post(':id/close')
  close(@CurrentUser() u: SessionUser, @Param('id', ParseIntPipe) id: number) {
    return this.dbs.tx(u, async (trx) => {
      await sql`SELECT ops.close_work_order(${id}::bigint, ${u.id}::bigint)`.execute(trx);
      return { ok: true };
    });
  }

  @Requires('ops.workshop')
  @Post(':id/cancel')
  cancel(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(z.object({ reason: z.string().trim().min(1, 'Indique el motivo') })))
    b: { reason: string },
  ) {
    return this.dbs.tx(u, async (trx) => {
      await sql`SELECT ops.cancel_work_order(${id}::bigint, ${u.id}::bigint, ${b.reason})`.execute(trx);
      return { ok: true };
    });
  }
}

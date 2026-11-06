import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { TransferInput, receiveInput, transferInput } from '@minitta/shared';
import { DbService, SessionUser } from '../../db/db.service';
import { CurrentUser, paging, zod } from '../../common/http';

/** Transferencias entre sedes: borrador → enviada (send_transfer) → recibida (receive_transfer). */
@Controller('transfers')
export class TransfersController {
  constructor(private readonly dbs: DbService) {}

  @Get()
  async list(@Query() q: Record<string, string>) {
    const { page, pageSize, offset } = paging(q);
    const where = sql`
      WHERE (${q.status || null}::text IS NULL OR t.status::text = ${q.status || null})
        AND (${q.location_id || null}::bigint IS NULL
             OR t.from_location_id = ${q.location_id || null}::bigint
             OR t.to_location_id = ${q.location_id || null}::bigint)`;
    const [rows, total] = await Promise.all([
      sql`
        SELECT t.*, lf.code AS from_code, lf.name AS from_name, lt.code AS to_code, lt.name AS to_name,
               us.full_name AS sent_by_name, ur.full_name AS received_by_name,
               (SELECT count(*) FROM inventory.transfer_line l WHERE l.transfer_id = t.id)::int AS lines,
               (SELECT COALESCE(sum(quantity_sent), 0) FROM inventory.transfer_line l WHERE l.transfer_id = t.id) AS units
        FROM inventory.transfer t
        JOIN core.location lf ON lf.id = t.from_location_id
        JOIN core.location lt ON lt.id = t.to_location_id
        LEFT JOIN core.app_user us ON us.id = t.sent_by
        LEFT JOIN core.app_user ur ON ur.id = t.received_by
        ${where}
        ORDER BY t.created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}`.execute(this.dbs.db),
      sql<{ n: number }>`SELECT count(*)::int AS n FROM inventory.transfer t ${where}`.execute(this.dbs.db),
    ]);
    return { items: rows.rows, total: total.rows[0].n, page, pageSize };
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const t = await sql`
      SELECT t.*, lf.code AS from_code, lf.name AS from_name, lt.code AS to_code, lt.name AS to_name,
             us.full_name AS sent_by_name, ur.full_name AS received_by_name
      FROM inventory.transfer t
      JOIN core.location lf ON lf.id = t.from_location_id
      JOIN core.location lt ON lt.id = t.to_location_id
      LEFT JOIN core.app_user us ON us.id = t.sent_by
      LEFT JOIN core.app_user ur ON ur.id = t.received_by
      WHERE t.id = ${id}`
      .execute(this.dbs.db)
      .then((r) => r.rows[0]);
    if (!t) throw new NotFoundException('Transferencia no encontrada');
    const lines = await sql`
      SELECT l.*, vf.sku, vf.product_name, vf.image_url, vf.tracking_mode, si.serial_code
      FROM inventory.transfer_line l
      JOIN catalog.v_variant_full vf ON vf.variant_id = l.variant_id
      LEFT JOIN inventory.serial_item si ON si.id = l.serial_id
      WHERE l.transfer_id = ${id} ORDER BY l.id`
      .execute(this.dbs.db)
      .then((r) => r.rows);
    return { ...t, lines };
  }

  @Post()
  create(@CurrentUser() u: SessionUser, @Body(zod(transferInput)) b: TransferInput) {
    if (b.from_location_id === b.to_location_id) {
      throw new UnprocessableEntityException('El origen y el destino deben ser sedes distintas');
    }
    return this.dbs.tx(u, async (trx) => {
      const { lines, ...head } = b;
      const code = await sql<{ c: string }>`
        SELECT 'TR-' || to_char(now(), 'YYYYMMDD') || '-' ||
               lpad((count(*) + 1)::text, 3, '0') AS c
        FROM inventory.transfer WHERE created_at >= current_date`
        .execute(trx)
        .then((r) => r.rows[0].c);
      const t = await trx
        .insertInto('inventory.transfer')
        .values({ ...head, code })
        .returning(['id', 'code'])
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('inventory.transfer_line')
        .values(lines.map((l) => ({ ...l, transfer_id: t.id, quantity_sent: l.serial_id ? 1 : l.quantity_sent })))
        .execute();
      return t;
    });
  }

  @Post(':id/send')
  send(@CurrentUser() u: SessionUser, @Param('id', ParseIntPipe) id: number) {
    return this.dbs.tx(u, async (trx) => {
      await sql`SELECT inventory.send_transfer(${id}::bigint, ${u.id}::bigint)`.execute(trx);
      return { ok: true };
    });
  }

  /** Recepción: lo que no llegó queda como ajuste en origen (lo hace receive_transfer). */
  @Post(':id/receive')
  receive(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(receiveInput)) b: z.infer<typeof receiveInput>,
  ) {
    return this.dbs.tx(u, async (trx) => {
      for (const l of b.lines) {
        await trx
          .updateTable('inventory.transfer_line')
          .set({ quantity_received: l.quantity_received })
          .where('id', '=', l.id)
          .where('transfer_id', '=', id)
          .execute();
      }
      await sql`SELECT inventory.receive_transfer(${id}::bigint, ${u.id}::bigint)`.execute(trx);
      return { ok: true };
    });
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() u: SessionUser, @Param('id', ParseIntPipe) id: number) {
    return this.dbs.tx(u, async (trx) => {
      const r = await trx
        .updateTable('inventory.transfer')
        .set({ status: 'cancelled' })
        .where('id', '=', id)
        .where('status', '=', 'draft')
        .executeTakeFirst();
      if (!r.numUpdatedRows) {
        throw new UnprocessableEntityException('Solo se puede anular una transferencia en borrador');
      }
      return { ok: true };
    });
  }
}

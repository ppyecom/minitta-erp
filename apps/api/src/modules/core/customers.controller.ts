import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { sql } from 'kysely';
import { CustomerInput, customerInput } from '@minitta/shared';
import { DbService, SessionUser } from '../../db/db.service';
import { CurrentUser, paging, zod } from '../../common/http';
import { Requires } from '../../auth/auth.guard';

/**
 * Clientes. Uno solo para todo el ERP: la misma persona en custodia, en un
 * apartado y (cuando llegue) en una venta es la misma fila. Antes era texto
 * libre en tres lugares que no se hablaban — ver docs/11.
 *
 * El código (CLI-000001) lo pone la base; la unicidad por documento también.
 * Acá no se reimplementa ninguna de las dos.
 */
@Requires('customers.read')
@Controller('customers')
export class CustomersController {
  constructor(private readonly dbs: DbService) {}

  /**
   * Búsqueda como se busca en el mostrador: parte del nombre, el teléfono o el
   * documento. Devuelve lo que el cliente tiene abierto, que es lo primero que
   * se pregunta cuando alguien entra a la tienda.
   */
  @Get()
  async list(@Query() q: Record<string, string>) {
    const { page, pageSize, offset } = paging(q);
    const term = q.q?.trim() || null;
    const where = sql`
      WHERE (${term}::text IS NULL
             OR c.name ILIKE '%' || ${term} || '%'
             OR c.trade_name ILIKE '%' || ${term} || '%'
             OR c.phone LIKE '%' || ${term} || '%'
             OR c.document_number LIKE ${term} || '%'
             OR c.code ILIKE ${term} || '%')
        AND (${q.kind || null}::text IS NULL OR c.kind::text = ${q.kind || null})
        AND (${q.active || null}::text IS NULL OR c.is_active)
        AND (${q.with_open || null}::text IS NULL OR c.open_items > 0)`;

    const [rows, total] = await Promise.all([
      sql`
        SELECT c.* FROM core.v_customer_360 c ${where}
        ORDER BY c.open_items DESC, c.last_activity DESC NULLS LAST, c.name
        LIMIT ${pageSize} OFFSET ${offset}`.execute(this.dbs.db),
      sql<{ n: number }>`
        SELECT count(*)::int AS n FROM core.v_customer_360 c ${where}`.execute(this.dbs.db),
    ]);
    return { items: rows.rows, total: total.rows[0].n, page, pageSize };
  }

  /** Los cumpleaños del mes: la mitad de las ventas de regalo de una joyería. */
  @Get('birthdays')
  birthdays(@Query('month') month?: string) {
    const m = Number(month) || new Date().getMonth() + 1;
    return sql`
      SELECT id, code, name, phone, email, birth_date,
             EXTRACT(DAY FROM birth_date)::int AS day
        FROM core.customer
       WHERE is_active AND birth_date IS NOT NULL
         AND EXTRACT(MONTH FROM birth_date) = ${m}
       ORDER BY EXTRACT(DAY FROM birth_date), name`
      .execute(this.dbs.db)
      .then((r) => r.rows);
  }

  /** El cliente con su historia: piezas en custodia y apartados. */
  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const customer = await sql<Record<string, unknown>>`
      SELECT c.*, v.custody_total, v.custody_open, v.layaway_total,
             v.layaway_active, v.layaway_paid, v.open_items, v.last_activity
        FROM core.customer c
        JOIN core.v_customer_360 v ON v.customer_id = c.id
       WHERE c.id = ${id}`
      .execute(this.dbs.db)
      .then((r) => r.rows[0]);
    if (!customer) throw new NotFoundException('Cliente no encontrado');

    const [custody, layaways] = await Promise.all([
      sql`
        SELECT ci.id, ci.code, ci.status, ci.description, ci.received_at,
               ci.promised_on, ci.received_weight_g, l.name AS location_name,
               (ci.promised_on IS NOT NULL AND ci.promised_on < current_date
                AND ci.status <> 'delivered') AS is_overdue
          FROM ops.custody_item ci
          JOIN core.location l ON l.id = ci.location_id
         WHERE ci.customer_id = ${id}
         ORDER BY (ci.status <> 'delivered') DESC, ci.received_at DESC`
        .execute(this.dbs.db)
        .then((r) => r.rows),
      sql`
        SELECT r.id, r.status, r.quantity, r.reserved_at, r.expires_at,
               v.sku, p.name AS product_name, l.name AS location_name,
               COALESCE(r.deposit_amount, 0) AS deposit,
               COALESCE(pay.total, 0) AS paid
          FROM inventory.reservation r
          JOIN catalog.variant v ON v.id = r.variant_id
          JOIN catalog.product p ON p.id = v.product_id
          JOIN core.location l ON l.id = r.location_id
          LEFT JOIN (SELECT reservation_id, sum(amount) AS total
                       FROM ops.layaway_payment GROUP BY 1) pay
                 ON pay.reservation_id = r.id
         WHERE r.customer_id = ${id}
         ORDER BY (r.status = 'active') DESC, r.reserved_at DESC`
        .execute(this.dbs.db)
        .then((r) => r.rows),
    ]);

    return { ...customer, custody, layaways };
  }

  @Requires('customers.write')
  @Post()
  create(@CurrentUser() u: SessionUser, @Body(zod(customerInput)) body: CustomerInput) {
    return this.dbs.tx(u, (trx) =>
      trx
        .insertInto('core.customer')
        // `code` lo pone el trigger trg_customer_code
        .values({ ...body, created_by: u.id })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }

  @Requires('customers.write')
  @Put(':id')
  update(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(customerInput)) body: CustomerInput,
  ) {
    return this.dbs.tx(u, (trx) =>
      trx
        .updateTable('core.customer')
        .set(body)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }
}

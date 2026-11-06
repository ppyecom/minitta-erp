import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect, Transaction, sql } from 'kysely';
import { Pool, types } from 'pg';
import { config } from '../config';
import type { DB } from './db-types';

// bigint (ids) y numeric (montos, pesos) llegan como string desde pg: los pasamos a
// number. Los ids caben de sobra en 2^53 y los montos tienen 4 decimales como mucho.
types.setTypeParser(20, (v) => Number(v)); // int8
types.setTypeParser(1700, (v) => Number(v)); // numeric
types.setTypeParser(1082, (v) => v); // date: se deja 'YYYY-MM-DD', sin zona horaria

export type Tx = Transaction<DB>;

export interface SessionUser {
  id: number;
  clientInfo?: string;
}

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool = new Pool({ ...config.db, max: 10 });
  readonly db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: this.pool }) });

  /**
   * Toda escritura pasa por acá: abre una transacción y setea app.user_id y
   * app.client_info con SET LOCAL (set_config(..., true)), como exige el esquema.
   * Así la auditoría (core.audit_row) y el created_by de los movimientos tienen autor.
   */
  tx<T>(user: SessionUser, fn: (trx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('app.user_id', ${String(user.id)}, true),
                       set_config('app.client_info', ${user.clientInfo ?? 'erp-web'}, true)`.execute(
        trx,
      );
      return fn(trx);
    });
  }

  async onModuleDestroy() {
    await this.db.destroy();
  }
}

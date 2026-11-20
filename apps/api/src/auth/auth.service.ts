import { createHash, randomBytes } from 'node:crypto';
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { sql } from 'kysely';
import type { BootstrapInput } from '@minitta/shared';
import { DbService, SessionUser } from '../db/db.service';
import { hashPassword, verifyPassword } from './password';

/** Cuánto dura una sesión sin actividad. Una jornada de tienda entra holgada. */
const SESSION_HOURS = 12;
/** Intentos fallidos antes de bloquear, y cuánto dura el bloqueo. */
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export const SESSION_COOKIE = 'minitta_session';

/** De la cookie sólo se guarda el SHA-256: la tabla no sirve para entrar. */
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export interface AuthenticatedUser extends SessionUser {
  username: string;
  fullName: string;
  permissions: Set<string>;
  mustChangePassword: boolean;
  sessionId: number;
}

@Injectable()
export class AuthService {
  constructor(private readonly dbs: DbService) {}

  // ---------------------------------------------------------------------------
  // ingreso
  // ---------------------------------------------------------------------------
  /**
   * Verifica usuario y contraseña y abre una sesión. Devuelve el token en claro
   * una sola vez: va a la cookie y no se vuelve a poder leer de la base.
   *
   * El mensaje de error es siempre el mismo (usuario inexistente, clave errada
   * o usuario inactivo) para no confirmar qué usuarios existen.
   */
  async login(
    username: string,
    password: string,
    clientInfo: string,
    ip: string | null,
  ): Promise<{ token: string; user: AuthenticatedUser }> {
    const invalid = new UnauthorizedException('Usuario o contraseña incorrectos');

    const row = await this.dbs.db
      .selectFrom('core.app_user')
      .select(['id', 'username', 'full_name', 'password_hash', 'is_active', 'is_system',
               'must_change_password', 'failed_attempts', 'locked_until'])
      .where('username', '=', username)
      .executeTakeFirst();

    // Se verifica la contraseña incluso sin usuario, contra un hash descartable,
    // para que un usuario inexistente tarde lo mismo que uno con clave errada.
    if (!row) {
      await verifyPassword(password, await hashPassword('tiempo-constante'));
      throw invalid;
    }
    if (!row.is_active || row.is_system) throw invalid;

    if (row.locked_until && new Date(row.locked_until) > new Date()) {
      throw new UnauthorizedException(
        `Usuario bloqueado por intentos fallidos. Vuelva a intentar en unos minutos o pida a un administrador que lo desbloquee.`,
      );
    }

    if (!(await verifyPassword(password, row.password_hash))) {
      await this.registerFailure(row.id, row.failed_attempts);
      throw invalid;
    }

    // entró: se limpia el contador y se abre la sesión
    const token = randomBytes(32).toString('base64url');
    await this.dbs.tx({ id: row.id, clientInfo }, async (trx) => {
      await trx
        .updateTable('core.app_user')
        .set({ failed_attempts: 0, locked_until: null, last_login_at: new Date() })
        .where('id', '=', row.id)
        .execute();
      await trx
        .insertInto('core.user_session')
        .values({
          user_id: row.id,
          token_hash: tokenHash(token),
          client_info: clientInfo,
          ip,
          expires_at: sql`now() + make_interval(hours => ${SESSION_HOURS})`,
        })
        .execute();
    });

    const user = await this.userFromToken(token);
    if (!user) throw invalid; // no debería pasar nunca
    return { token, user };
  }

  private async registerFailure(userId: number, attempts: number) {
    const next = attempts + 1;
    await this.dbs.tx({ id: userId, clientInfo: 'login-fallido' }, (trx) =>
      trx
        .updateTable('core.app_user')
        .set({
          failed_attempts: next,
          locked_until:
            next >= MAX_ATTEMPTS
              ? sql`now() + make_interval(mins => ${LOCK_MINUTES})`
              : null,
        })
        .where('id', '=', userId)
        .execute(),
    );
  }

  // ---------------------------------------------------------------------------
  // la sesión en cada petición
  // ---------------------------------------------------------------------------
  /**
   * Resuelve el token de la cookie a un usuario con sus permisos. Devuelve null
   * si la sesión no existe, venció o fue revocada. Renueva el vencimiento: la
   * sesión caduca por inactividad, no a las 12 horas de haber entrado.
   */
  async userFromToken(token: string | undefined): Promise<AuthenticatedUser | null> {
    if (!token) return null;

    const row = await this.dbs.db
      .selectFrom('core.user_session as s')
      .innerJoin('core.app_user as u', 'u.id', 's.user_id')
      .select(['s.id as session_id', 's.client_info', 'u.id as user_id', 'u.username',
               'u.full_name', 'u.must_change_password', 'u.is_active'])
      .select(sql<string[]>`ARRAY(SELECT core.user_permissions(u.id))`.as('permissions'))
      .where('s.token_hash', '=', tokenHash(token))
      .where('s.revoked_at', 'is', null)
      .where(sql<boolean>`s.expires_at > now()`)
      .executeTakeFirst();

    if (!row || !row.is_active) return null;

    // un UPDATE por petición es barato y es lo que hace que la sesión sea
    // "12 horas sin usarla", no "12 horas desde que entró"
    await this.dbs.db
      .updateTable('core.user_session')
      .set({
        last_seen_at: new Date(),
        expires_at: sql`now() + make_interval(hours => ${SESSION_HOURS})`,
      })
      .where('id', '=', row.session_id)
      .execute();

    return {
      id: row.user_id,
      username: row.username,
      fullName: row.full_name,
      clientInfo: row.client_info ?? 'erp-web',
      permissions: new Set(row.permissions),
      mustChangePassword: row.must_change_password,
      sessionId: row.session_id,
    };
  }

  /** Cierra la sesión de esta cookie. */
  async logout(user: AuthenticatedUser) {
    await this.dbs.tx(user, (trx) =>
      trx
        .updateTable('core.user_session')
        .set({ revoked_at: new Date(), revoked_by: user.id })
        .where('id', '=', user.sessionId)
        .where('revoked_at', 'is', null)
        .execute(),
    );
  }

  /** Cierra todas las sesiones de un usuario (lo usa el administrador). */
  async revokeAll(target: number, by: AuthenticatedUser) {
    const r = await this.dbs.tx(by, (trx) =>
      trx
        .updateTable('core.user_session')
        .set({ revoked_at: new Date(), revoked_by: by.id })
        .where('user_id', '=', target)
        .where('revoked_at', 'is', null)
        .executeTakeFirst(),
    );
    return { closed: Number(r.numUpdatedRows ?? 0) };
  }

  // ---------------------------------------------------------------------------
  // contraseñas
  // ---------------------------------------------------------------------------
  /** El dueño cambia su propia clave: hay que saber la anterior. */
  async changeOwnPassword(user: AuthenticatedUser, current: string, next: string) {
    const row = await this.dbs.db
      .selectFrom('core.app_user')
      .select('password_hash')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();

    if (!(await verifyPassword(current, row.password_hash))) {
      throw new ForbiddenException('La contraseña actual no es correcta');
    }
    await this.setPassword(user, user.id, next, false);
    // cambiar la clave cierra las demás sesiones: si alguien la tenía, se queda afuera
    await this.dbs.tx(user, (trx) =>
      trx
        .updateTable('core.user_session')
        .set({ revoked_at: new Date(), revoked_by: user.id })
        .where('user_id', '=', user.id)
        .where('id', '<>', user.sessionId)
        .where('revoked_at', 'is', null)
        .execute(),
    );
    return { ok: true };
  }

  /**
   * Un administrador le pone una clave a otro. Queda `must_change_password`:
   * el administrador no debe terminar sabiendo la clave de nadie.
   */
  async resetPassword(by: AuthenticatedUser, target: number, next: string) {
    const row = await this.dbs.db
      .selectFrom('core.app_user')
      .select(['is_system'])
      .where('id', '=', target)
      .executeTakeFirstOrThrow();
    if (row.is_system) {
      throw new ForbiddenException('Un usuario de sistema no se loguea: no tiene contraseña');
    }
    await this.setPassword(by, target, next, true);
    await this.revokeAll(target, by);
    return { ok: true };
  }

  private async setPassword(by: SessionUser, target: number, plain: string, mustChange: boolean) {
    const hash = await hashPassword(plain);
    await this.dbs.tx(by, (trx) =>
      trx
        .updateTable('core.app_user')
        .set({
          password_hash: hash,
          password_set_at: new Date(),
          must_change_password: mustChange,
          failed_attempts: 0,
          locked_until: null,
        })
        .where('id', '=', target)
        .execute(),
    );
  }

  // ---------------------------------------------------------------------------
  // primer usuario
  // ---------------------------------------------------------------------------
  /**
   * Crea el primer administrador. Sólo funciona con la base recién migrada: en
   * cuanto existe una persona (no un usuario de sistema), deja de responder.
   */
  async bootstrap(body: BootstrapInput) {
    const people = await this.dbs.db
      .selectFrom('core.app_user')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('is_system', '=', false)
      .executeTakeFirstOrThrow();
    if (people.n > 0) return { created: false as const };

    const hash = await hashPassword(body.password);
    const created = await this.dbs.db.transaction().execute(async (trx) => {
      const u = await trx
        .insertInto('core.app_user')
        .values({
          username: body.username,
          full_name: body.full_name,
          password_hash: hash,
          password_set_at: new Date(),
          can_see_cost: true,
          is_active: true,
        })
        .returning(['id', 'username', 'full_name'])
        .executeTakeFirstOrThrow();

      const admin = await trx
        .selectFrom('core.role')
        .select('id')
        .where('code', '=', 'admin')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('core.user_role')
        .values({ user_id: u.id, role_id: admin.id })
        .execute();
      return u;
    });

    return { created: true as const, user: created };
  }
}

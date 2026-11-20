import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { sql } from 'kysely';
import { RoleInput, UserRolesInput, roleInput, userRolesInput } from '@minitta/shared';
import { DbService } from '../db/db.service';
import { CurrentUser, zod } from '../common/http';
import type { AuthenticatedUser } from './auth.service';
import { Requires } from './auth.guard';

/**
 * Roles y permisos. Todo acá exige core.users: quién puede qué es tan sensible
 * como el stock, y cada cambio queda en core.audit_log por los triggers de 012.
 */
@Controller('access')
export class AccessController {
  constructor(private readonly dbs: DbService) {}

  /** El catálogo de permisos, agrupado por módulo para la pantalla de roles. */
  @Get('permissions')
  permissions() {
    return this.dbs.db
      .selectFrom('core.permission')
      .selectAll()
      .orderBy('sort_order')
      .orderBy('code')
      .execute();
  }

  @Get('roles')
  roles() {
    return sql<Record<string, unknown>>`
      SELECT r.*,
             COALESCE(array_agg(rp.permission_id) FILTER (WHERE rp.permission_id IS NOT NULL), '{}') AS permission_ids,
             (SELECT count(*)::int FROM core.user_role ur WHERE ur.role_id = r.id) AS users
        FROM core.role r
        LEFT JOIN core.role_permission rp ON rp.role_id = r.id
       GROUP BY r.id
       ORDER BY r.is_system DESC, r.name`
      .execute(this.dbs.db)
      .then((r) => r.rows);
  }

  /** Quién puede entrar, con qué roles y cuántas sesiones tiene abiertas. */
  @Get('users')
  users() {
    return this.dbs.db.selectFrom('core.v_user_access').selectAll().orderBy('full_name').execute();
  }

  @Requires('core.users')
  @Post('roles')
  create(@CurrentUser() u: AuthenticatedUser, @Body(zod(roleInput)) body: RoleInput) {
    const { permission_ids, ...role } = body;
    return this.dbs.tx(u, async (trx) => {
      const r = await trx.insertInto('core.role').values(role).returningAll().executeTakeFirstOrThrow();
      await setPermissions(trx, r.id, permission_ids);
      return r;
    });
  }

  @Requires('core.users')
  @Put('roles/:id')
  async update(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(roleInput)) body: RoleInput,
  ) {
    const { permission_ids, ...role } = body;
    return this.dbs.tx(u, async (trx) => {
      const current = await trx
        .selectFrom('core.role')
        .select(['code', 'is_system'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

      // al rol de administrador no se le quitan permisos: sería dejar el ERP sin dueño
      if (current.is_system) {
        const r = await trx
          .updateTable('core.role')
          .set({ name: role.name, description: role.description })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        return r;
      }

      const r = await trx.updateTable('core.role').set(role).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await trx.deleteFrom('core.role_permission').where('role_id', '=', id).execute();
      await setPermissions(trx, id, permission_ids);
      return r;
    });
  }

  @Requires('core.users')
  @Delete('roles/:id')
  remove(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.dbs.tx(u, async (trx) => {
      const r = await trx
        .selectFrom('core.role')
        .select('is_system')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      if (r.is_system) {
        // no se borra; la base igual lo permitiría, así que el corte está acá
        return { deleted: false, reason: 'Es un rol del sistema' };
      }
      await trx.deleteFrom('core.role').where('id', '=', id).execute();
      return { deleted: true };
    });
  }

  /** Reemplaza los roles de un usuario por la lista que llega. */
  @Requires('core.users')
  @Put('users/:id/roles')
  setRoles(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(userRolesInput)) body: UserRolesInput,
  ) {
    return this.dbs.tx(u, async (trx) => {
      await trx.deleteFrom('core.user_role').where('user_id', '=', id).execute();
      if (body.role_ids.length) {
        await trx
          .insertInto('core.user_role')
          .values(body.role_ids.map((role_id) => ({ user_id: id, role_id, granted_by: u.id })))
          .execute();
      }
      return trx
        .selectFrom('core.v_user_access')
        .selectAll()
        .where('user_id', '=', id)
        .executeTakeFirstOrThrow();
    });
  }
}

type Trx = Parameters<Parameters<DbService['tx']>[1]>[0];

async function setPermissions(trx: Trx, roleId: number, permissionIds: number[]) {
  if (!permissionIds.length) return;
  await trx
    .insertInto('core.role_permission')
    .values(permissionIds.map((permission_id) => ({ role_id: roleId, permission_id })))
    .execute();
}

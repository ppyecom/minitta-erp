import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { sql } from 'kysely';
import {
  BootstrapInput,
  ChangePasswordInput,
  LoginInput,
  ResetPasswordInput,
  bootstrapInput,
  changePasswordInput,
  loginInput,
  resetPasswordInput,
} from '@minitta/shared';
import { DbService } from '../db/db.service';
import { CurrentUser, zod } from '../common/http';
import { AuthService, SESSION_COOKIE, type AuthenticatedUser } from './auth.service';
import { AllowPendingPassword, Public, Requires } from './auth.guard';

/** Doce horas, igual que la sesión en la base. */
const COOKIE_MAX_AGE = 12 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly dbs: DbService,
  ) {}

  /**
   * Estado inicial, sin sesión: le dice a la pantalla de login si todavía hay
   * que crear el primer usuario.
   */
  @Public()
  @Get('status')
  async status() {
    const people = await this.dbs.db
      .selectFrom('core.app_user')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('is_system', '=', false)
      .executeTakeFirstOrThrow();
    return { needsBootstrap: people.n === 0 };
  }

  @Public()
  @HttpCode(200)
  @Post('bootstrap')
  bootstrap(@Body(zod(bootstrapInput)) body: BootstrapInput) {
    return this.auth.bootstrap(body);
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  async login(
    @Body(zod(loginInput)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const clientInfo = body.station ? `erp-web / ${body.station}` : 'erp-web';
    const { token, user } = await this.auth.login(
      body.username,
      body.password,
      clientInfo,
      req.ip ?? null,
    );

    // httpOnly: el JavaScript de la página no puede leer el token, así que un
    // XSS no se lo lleva. sameSite lax alcanza: la API y la web son el mismo origen.
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE,
      // en producción detrás de HTTPS conviene secure: true (ver docs/10)
      secure: false,
    });
    return sessionPayload(user);
  }

  @AllowPendingPassword()
  @Get('me')
  me(@CurrentUser() u: AuthenticatedUser) {
    return sessionPayload(u);
  }

  @AllowPendingPassword()
  @HttpCode(200)
  @Post('logout')
  async logout(@CurrentUser() u: AuthenticatedUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(u);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @AllowPendingPassword()
  @HttpCode(200)
  @Post('password')
  changePassword(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(changePasswordInput)) body: ChangePasswordInput,
  ) {
    return this.auth.changeOwnPassword(u, body.current_password, body.new_password);
  }

  /** Las sesiones abiertas del propio usuario, para que vea dónde quedó conectado. */
  @Get('sessions')
  sessions(@CurrentUser() u: AuthenticatedUser) {
    return this.dbs.db
      .selectFrom('core.user_session')
      .select(['id', 'client_info', 'created_at', 'last_seen_at', 'expires_at'])
      .select(sql<boolean>`id = ${u.sessionId}`.as('is_current'))
      .where('user_id', '=', u.id)
      .where('revoked_at', 'is', null)
      .where(sql<boolean>`expires_at > now()`)
      .orderBy('last_seen_at', 'desc')
      .execute();
  }

  // ---- administración de accesos (core.users) -------------------------------
  @Requires('core.users')
  @HttpCode(200)
  @Post('users/:id/password')
  reset(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(zod(resetPasswordInput)) body: ResetPasswordInput,
  ) {
    return this.auth.resetPassword(u, id, body.new_password);
  }

  @Requires('core.users')
  @HttpCode(200)
  @Post('users/:id/logout')
  revokeAll(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.auth.revokeAll(id, u);
  }

  @Requires('core.users')
  @HttpCode(200)
  @Post('users/:id/unlock')
  unlock(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.dbs.tx(u, async (trx) => {
      await trx
        .updateTable('core.app_user')
        .set({ failed_attempts: 0, locked_until: null })
        .where('id', '=', id)
        .execute();
      return { ok: true };
    });
  }
}

/** Lo que la interfaz necesita saber de la sesión. Nunca el hash ni el token. */
function sessionPayload(u: AuthenticatedUser) {
  return {
    id: u.id,
    username: u.username,
    full_name: u.fullName,
    permissions: [...u.permissions],
    must_change_password: u.mustChangePassword,
  };
}

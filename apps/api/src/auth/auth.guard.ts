import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService, SESSION_COOKIE, type AuthenticatedUser } from './auth.service';

const PUBLIC = 'auth:public';
const PERMISSION = 'auth:permission';
const ALLOW_PENDING = 'auth:allow-pending';

/** Sin sesión: sólo el login, el bootstrap y el estado inicial. */
export const Public = () => SetMetadata(PUBLIC, true);

/**
 * Exige un permiso de core.permission. La base es la que decide: el guard
 * pregunta por core.user_can() a través de los permisos que trae la sesión.
 */
export const Requires = (permission: string) => SetMetadata(PERMISSION, permission);

/** Accesible con la clave vencida (cambiar la contraseña, cerrar sesión, /me). */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING, true);

/** Lee una cookie del encabezado sin depender de cookie-parser. */
function cookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/**
 * Guard global: resuelve la cookie de sesión a un usuario y, si el endpoint
 * declara un permiso con @Requires(), lo exige.
 *
 * Reemplaza la cabecera x-user-id, que cualquiera podía escribir. Los
 * controladores no cambian: siguen recibiendo @CurrentUser().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const handlers = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, handlers)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = await this.auth.userFromToken(cookie(req, SESSION_COOKIE));
    if (!user) throw new UnauthorizedException('Su sesión venció. Vuelva a ingresar.');

    // con la clave vencida sólo se puede cambiarla
    if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING, handlers)) {
      throw new ForbiddenException('Debe cambiar su contraseña antes de seguir.');
    }

    const needed = this.reflector.getAllAndOverride<string>(PERMISSION, handlers);
    if (needed && !user.permissions.has(needed)) {
      throw new ForbiddenException(`No tiene permiso para esta acción (${needed}).`);
    }

    req.user = user;
    return true;
  }
}

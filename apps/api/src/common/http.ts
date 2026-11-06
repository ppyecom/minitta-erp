import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  PipeTransform,
  UnauthorizedException,
  createParamDecorator,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DatabaseError } from 'pg';
import { ZodError, ZodTypeAny, z } from 'zod';
import type { SessionUser } from '../db/db.service';

/** Valida el body (o query) con un esquema de @minitta/shared. */
@Injectable()
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: S) {}
  transform(value: unknown): z.infer<S> {
    const r = this.schema.safeParse(value);
    if (!r.success) throw r.error;
    return r.data;
  }
}
export const zod = <S extends ZodTypeAny>(schema: S) => new ZodPipe(schema);

/**
 * Usuario de la sesión. Hasta que exista el login, la interfaz manda el usuario
 * elegido en el selector como cabecera x-user-id. Se exige en toda escritura.
 */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const id = Number(req.header('x-user-id'));
  if (!Number.isInteger(id) || id <= 0) {
    throw new UnauthorizedException('Elija un usuario en la barra superior antes de guardar.');
  }
  const station = req.header('x-client-info');
  return { id, clientInfo: station ? `erp-web / ${station}` : 'erp-web' };
});

export function paging(q: Record<string, unknown>, def = 25) {
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || def));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/**
 * Traduce los errores de Postgres a respuestas legibles. Los RAISE EXCEPTION del
 * esquema ya vienen en español ("saldo insuficiente: ..."), se pasan tal cual.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('API');

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (err instanceof ZodError) {
      return res.status(400).json({
        message: 'Revise los datos del formulario',
        fields: err.flatten().fieldErrors,
      });
    }
    if (err instanceof HttpException) {
      const body = err.getResponse();
      return res.status(err.getStatus()).json(typeof body === 'string' ? { message: body } : body);
    }
    if (err instanceof DatabaseError) {
      const detail = err.detail ? ` (${err.detail})` : '';
      switch (err.code) {
        case 'P0001': // RAISE EXCEPTION
          return res.status(422).json({ message: err.message });
        case '23505':
          return res.status(409).json({ message: `Ya existe un registro con ese valor${detail}` });
        case '23503':
          return res
            .status(409)
            .json({ message: `El registro está relacionado con otros datos${detail}` });
        case '23514':
        case '23502':
        case '22P02':
        case '22003':
          return res.status(400).json({ message: `Dato no válido: ${err.message}${detail}` });
      }
      this.log.error(`${err.code} ${err.message}`);
      return res.status(500).json({ message: `Error de base de datos: ${err.message}` });
    }
    if (err instanceof BadRequestException) {
      return res.status(400).json({ message: err.message });
    }
    this.log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    return res.status(500).json({ message: 'Error interno del servidor' });
  }
}

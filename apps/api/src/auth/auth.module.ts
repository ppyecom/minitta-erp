import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from '../db/db.module';
import { AccessController } from './access.controller';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

/**
 * El guard se registra como APP_GUARD: protege TODOS los endpoints por omisión.
 * Un endpoint se abre a propósito con @Public(), nunca por olvido. Así agregar
 * un controlador nuevo no deja un agujero.
 */
@Module({
  imports: [DbModule],
  controllers: [AuthController, AccessController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}

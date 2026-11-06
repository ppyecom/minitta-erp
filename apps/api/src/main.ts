import 'reflect-metadata';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: true });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());

  // imágenes locales
  mkdirSync(config.uploadsDir, { recursive: true });
  app.useStaticAssets(config.uploadsDir, { prefix: '/uploads/', maxAge: '30d', immutable: true });

  // en producción (npm run build && npm start) la API sirve también la interfaz
  const index = path.join(config.webDist, 'index.html');
  if (existsSync(index)) {
    app.useStaticAssets(config.webDist, { index: false });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
      res.sendFile(index);
    });
  }

  await app.listen(config.port, config.host);
  const log = new Logger('Minitta ERP');
  log.log(`API en http://${config.host}:${config.port}/api`);
  if (existsSync(index)) log.log(`Interfaz en http://localhost:${config.port}`);
}

bootstrap();

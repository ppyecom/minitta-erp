import path from 'node:path';
import dotenv from 'dotenv';

// el .env vive en la raíz del repo (mismo archivo que usan los scripts de migración)
export const ROOT_DIR = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const env = process.env;

export const config = {
  port: Number(env.API_PORT || 3000),
  host: env.API_HOST || '127.0.0.1',
  db: {
    host: env.PGHOST || 'localhost',
    port: Number(env.PGPORT || 5432),
    user: env.PGUSER || 'postgres',
    password: env.PGPASSWORD || '',
    database: env.PGDATABASE || 'minitta_erp',
  },
  // imágenes locales: fuera de git, servidas en /uploads
  uploadsDir: path.resolve(ROOT_DIR, env.UPLOADS_DIR || 'uploads'),
  // build de la web: si existe, la API la sirve en el mismo puerto
  webDist: path.join(ROOT_DIR, 'apps/web/dist'),
};

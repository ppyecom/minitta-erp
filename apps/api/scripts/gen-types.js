// Regenera src/db/db-types.ts leyendo el esquema real de la base (kysely-codegen).
// Correr después de cada migración nueva: npm run db:types
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const e = process.env;
const url = `postgres://${encodeURIComponent(e.PGUSER || 'postgres')}:${encodeURIComponent(
  e.PGPASSWORD || '',
)}@${e.PGHOST || 'localhost'}:${e.PGPORT || 5432}/${e.PGDATABASE || 'minitta_erp'}`;

execFileSync(
  process.execPath,
  [
    require.resolve('kysely-codegen/dist/cli/bin.js'),
    '--dialect=postgres',
    '--out-file=src/db/db-types.ts',
    '--include-pattern=(core|catalog|pricing|inventory).*',
    '--numeric-parser=number',
  ],
  { stdio: 'inherit', cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: url } },
);

// db.service.ts convierte int8 a number al leer (los ids caben en 2^53): los tipos
// tienen que decir lo mismo, si no cada .where('id', '=', id) pide un string.
const out = path.resolve(__dirname, '../src/db/db-types.ts');
const src = fs.readFileSync(out, 'utf8');
const fixed = src.replace(
  /export type Int8 = ColumnType<string,[^;]+;/,
  'export type Int8 = ColumnType<number, bigint | number | string, bigint | number | string>;',
);
if (fixed === src) throw new Error('No se encontró el tipo Int8 en db-types.ts: revisar kysely-codegen');
fs.writeFileSync(out, fixed);

#!/usr/bin/env node
/* =============================================================================
 * ERP v2 — migración 021: exportar el legacy DIRECTO de SQL Server
 *
 * Por qué existe este script:
 *   El export CSV que entrega el ERP viejo NO entrecomilla los campos de texto.
 *   Cualquier descripción con una coma ("alt 6.4cm,c/mostac,strass,...") agrega
 *   columnas y corre todos los valores siguientes: el peso aterriza en otra
 *   columna y el precio queda mal. En el export de muestra, 49 de 101 filas de
 *   almacen_articulo estaban corridas. Esa vía no sirve para migrar.
 *
 *   Leyendo directo de SQL Server el problema desaparece: los valores llegan
 *   tipados y este script los escribe en CSV con comillas correctas y UTF-8.
 *
 * Es SOLO LECTURA sobre el ERP viejo (SELECT). No escribe nada allá.
 *
 * Nombres de tablas: los del export CSV (almacen_articulo, STOCKS, TIPO_MONEDA)
 * no son los del servidor. Los reales salen del sync del e-commerce, que lee
 * esta misma base: ALMACEN.ARTICULO, SUNAT.TIPO_MONEDA, detalle_tienda. Cada
 * tabla lista sus candidatos y se usa el primero que exista. --check muestra
 * cuál se encontró y qué columnas faltan, sin exportar nada.
 *
 * Uso:
 *   node 021_export_from_sqlserver.js
 *   node 021_export_from_sqlserver.js --check --env ../../.env
 *
 * Config (desde .env en la raíz del proyecto, --env <ruta>, o variables de entorno):
 *   ERP_SQL_SERVER, ERP_SQL_PORT, ERP_SQL_DATABASE, ERP_SQL_USER, ERP_SQL_PASSWORD
 * ========================================================================== */

'use strict';

const fs   = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// de dónde salen las credenciales: --env <ruta>, ERP_ENV_FILE, o .env en la raíz
function envFilePath() {
  const i = process.argv.indexOf('--env');
  if (i >= 0 && process.argv[i + 1]) return path.resolve(process.argv[i + 1]);
  if (process.env.ERP_ENV_FILE) return path.resolve(process.env.ERP_ENV_FILE);
  return path.join(REPO_ROOT, '.env');
}

let sql;
try {
  sql = require('mssql');
} catch {
  console.error('Falta el paquete mssql. Instalalo con:  npm install');
  process.exit(1);
}

// --- config ------------------------------------------------------------------
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const fileEnv = loadEnvFile(envFilePath());
const cfg = (k, d) => process.env[k] || fileEnv[k] || d;

const config = {
  user:     cfg('ERP_SQL_USER'),
  password: cfg('ERP_SQL_PASSWORD'),
  server:   cfg('ERP_SQL_SERVER'),
  port:     parseInt(cfg('ERP_SQL_PORT', '1433'), 10),
  database: cfg('ERP_SQL_DATABASE'),
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  requestTimeout: 120000,
  connectionTimeout: 20000,
};

if (!config.server || !config.user || !config.database) {
  console.error('Falta configuración de SQL Server. Definí ERP_SQL_SERVER, ERP_SQL_USER, ERP_SQL_PASSWORD y ERP_SQL_DATABASE.');
  process.exit(1);
}

// --- tablas a exportar: el nombre de archivo coincide con legacy.<tabla> ------
// from:     candidatos 'esquema.tabla' (o 'tabla' = cualquier esquema), en orden.
// columns:  en el MISMO orden que legacy.<tabla> en 010_staging.sql: la carga
//           (\copy) es por posición. 'a|b' = la columna puede llamarse a o b.
// required: sin estas no tiene sentido migrar; si faltan, se corta.
const TABLES = [
  { file: 'almacen_articulo', from: ['ALMACEN.ARTICULO', 'almacen_articulo', 'ARTICULO'],
    required: ['CODIGO_ARTICULO', 'CODIGO', 'CODIGO_ALA', 'CODIGO_CLA_ALHAJAS', 'NOMBRE', 'PRECIO'],
    columns: [
    'CODIGO_ARTICULO','ID_TIPO','CODIGO','CODIGO_ALA','CODIGO_CLA_ALHAJAS',
    'CODIGO_TIPO_PIEDRA','CODIGO_CLASE_PIEDRA','CODIGO_COLOR','COD_PROVEEDOR',
    'ID_COLOR_METAL','ID_TIPO_MONEDA','NOMBRE','DESCRIPCION','IMAGEN','PESO','MEDIDA',
    'PRECIO_PIEDRA','PRECIO_PRODUCTO','PORCENTAJE_COMERCIANTE','PRECIO_COMERCIANTE',
    'PORC_MAYOR','PRECIO_MAYOR','PORCENTEJE','PRECIO','PREC_GR','CLAVE','STOCK',
    'STOCK_MINIMO','ACTIVO','NUMERO','MONEDA','INICIAL','FECHA_INGRESO','ID','TIP_PIED',
    'MEDIDA_PIEDRA','PID_MED','DEJAR_USAR','FAVORITO','IND_PRODUCTO','IND_ESTADO',
    'IND_REGISTRO','PC_REGISTRO','USUARIO_REGISTRO','FECHA_REGISTRO','PC_MODIFICO',
    'USUARIO_MODIFICO','FECHA_MODIFICO','USUARIO_ANULACION','FECHA_ANULACION'] },
  { file: 'material',             from: ['dbo.Material', 'Material'],
    required: ['codigo', 'nombre'], columns: ['codigo','nombre','Prefijo','IND_TIPO_VENTA'] },
  { file: 'tipo_alhajas',         from: ['dbo.tipo_alhajas', 'tipo_alhajas'],
    required: ['codigo_ala', 'nombre'], columns: ['codigo_ala','nombre','prejifo|prefijo'] },
  { file: 'clases_alhajas',       from: ['dbo.clases_alhajas', 'clases_alhajas'],
    required: ['codigo_cla_alhajas', 'nombre'], columns: ['codigo_cla_alhajas','nombre','prefijo'] },
  { file: 'tipo_piedra',          from: ['dbo.Tipo_piedra', 'Tipo_piedra'],
    required: ['cod_tipopiedra', 'nombre_piedra'], columns: ['cod_tipopiedra','nombre_piedra'] },
  { file: 'clase_piedra',         from: ['dbo.Clase_piedra', 'Clase_piedra'],
    required: ['cod_clasepiedra', 'nombre_clasepiedra'], columns: ['cod_clasepiedra','cod_tipopiedra','nombre_clasepiedra','nulo'] },
  { file: 'color_piedra',         from: ['dbo.color_piedra', 'color_piedra'],
    required: ['cod_colorpiedra', 'nombre_color'], columns: ['cod_colorpiedra','nombre_color'] },
  { file: 'color_metal_articulo', from: ['dbo.Color_metal_articulo', 'Color_metal_articulo'],
    required: ['id_color_metal', 'Color'], columns: ['id_color_metal','codigo','Color','imagen'] },
  // el stock por tienda: el e-commerce lo lee de detalle_tienda; el export CSV lo llamaba STOCKS
  { file: 'stocks',               from: ['detalle_tienda', 'STOCKS'],
    required: ['num_tienda', 'codigo_articulo', 'stock'],
    columns: ['num_tienda|id_tienda|cod_tienda|codigo_tienda','codigo_articulo','cantida|cantidad','stock','Estado','ModificadoPorUsuario','AplicacionOrigen','EstacionTrabajo'] },
  { file: 'tiendas',              from: ['dbo.tiendas', 'tiendas', 'TIENDA'],
    required: ['num_tienda', 'nombre'],
    columns: ['num_tienda','nombre','anulada','ubicacion','area','caja','telefono','celular','email','web','IMAGEN','VISOR','XML1','XML2','RUTA_INSTALACION','TIENDA','RUTA_PROF','SISTEMA','REPORTE','RECIBOS','ETIQUETA'] },
  { file: 'tipo_moneda',          from: ['SUNAT.TIPO_MONEDA', 'TIPO_MONEDA'],
    required: ['ID_TIPO_MONEDA', 'NOMBRE_CORTO'],
    columns: ['ID_TIPO_MONEDA','CODIGO_SUNAT','DESCRIPCION','NOMBRE_CORTO','ABREVIACION','SIMBOLO','ALIAS','IND_ESTADO','USUARIO_REGISTRO','FECHA_REGISTRO','USUARIO_MODIFICO','FECHA_MODIFICO','CODIGO_ISO'] },
];

// [ALMACEN].[ARTICULO]: cada parte entre corchetes ([ALMACEN.ARTICULO] sería
// una tabla llamada literalmente así)
const quoteIdent = (name) => `[${String(name).replace(/]/g, ']]')}]`;

// --- CSV bien formado (esto es lo que el export viejo no hace) ----------------
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s;
  if (v instanceof Date)        s = v.toISOString();
  else if (Buffer.isBuffer(v))  s = v.toString('base64');
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  // SIEMPRE entrecomillado: así una coma, un salto de línea o una comilla
  // dentro del texto no pueden correr las columnas.
  return '"' + s.replace(/"/g, '""') + '"';
}

const args     = process.argv.slice(2);
const outDir   = (() => { const i = args.indexOf('--out'); return i >= 0 ? args[i + 1] : path.join(__dirname, '.staging'); })();
const checkOnly = args.includes('--check');

/** Todas las tablas y vistas que el usuario puede ver: 'esquema.tabla' -> {schema, name}. */
async function listObjects(pool) {
  const r = await pool.request().query(`
    SELECT TABLE_SCHEMA AS sch, TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES`);
  return r.recordset.map((o) => ({ schema: o.sch, name: o.name }));
}

function findObject(objects, candidate) {
  const [a, b] = candidate.includes('.') ? candidate.split('.') : [null, candidate];
  return objects.find(
    (o) => o.name.toLowerCase() === b.toLowerCase() && (a === null || o.schema.toLowerCase() === a.toLowerCase()),
  );
}

/**
 * El primer candidato que exista Y tenga las columnas esenciales. Si uno existe
 * pero le faltan columnas (detalle_tienda con otro nombre para la tienda), se
 * prueba el siguiente; si ninguno sirve, el error dice qué columnas sí tiene.
 */
async function pickTable(pool, objects, t) {
  const tried = [];
  for (const c of t.from) {
    const table = findObject(objects, c);
    if (!table) continue;
    const actual = await tableColumns(pool, table);
    const cols = matchColumns(t.columns, actual);
    const missing = cols.filter((x) => !x.real).map((x) => x.name);
    const missingRequired = t.required.filter((r) => missing.some((m) => m.toLowerCase() === r.toLowerCase()));
    if (!missingRequired.length) return { table, cols, missing };
    tried.push(`${table.schema}.${table.name} (faltan ${missingRequired.join(', ')}; tiene: ${actual.join(', ')})`);
  }
  if (!tried.length) throw new Error(`no se encontró ninguna de: ${t.from.join(', ')}`);
  throw new Error(`ninguna tabla tiene las columnas esenciales: ${tried.join(' | ')}`);
}

async function tableColumns(pool, t) {
  const r = await pool.request()
    .input('s', sql.NVarChar, t.schema)
    .input('t', sql.NVarChar, t.name)
    .query(`SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = @s AND TABLE_NAME = @t`);
  return r.recordset.map((c) => c.name);
}

/** Para cada columna esperada, el nombre real en el servidor (o null si no existe). */
function matchColumns(spec, actual) {
  const byLower = new Map(actual.map((c) => [c.toLowerCase(), c]));
  return spec.map((s) => {
    const aliases = s.split('|');
    const real = aliases.map((a) => byLower.get(a.toLowerCase())).find(Boolean) ?? null;
    return { name: aliases[0], real };
  });
}

(async () => {
  console.log(`Conectando a ${config.server}:${config.port}/${config.database} como ${config.user} (solo lectura)...`);
  const pool = await sql.connect(config);
  console.log('Conectado.\n');

  if (!checkOnly) fs.mkdirSync(outDir, { recursive: true });

  const objects = await listObjects(pool);
  const summary = [];
  let failed = 0;

  for (const t of TABLES) {
    try {
      const { table, cols, missing } = await pickTable(pool, objects, t);
      const full = `${quoteIdent(table.schema)}.${quoteIdent(table.name)}`;
      const note = missing.length ? `sin: ${missing.join(', ')} (quedan vacías)` : '';

      if (checkOnly) {
        const r = await pool.request().query(`SELECT COUNT(*) AS n FROM ${full}`);
        summary.push({ tabla: t.file, origen: `${table.schema}.${table.name}`, filas: r.recordset[0].n, estado: 'ok', nota: note });
        continue;
      }

      const present = cols.filter((c) => c.real);
      const select = present.map((c) => `${quoteIdent(c.real)} AS ${quoteIdent(c.name)}`).join(', ');
      const rows = (await pool.request().query(`SELECT ${select} FROM ${full}`)).recordset;

      const out = fs.createWriteStream(path.join(outDir, `${t.file}.csv`), { encoding: 'utf8' });
      out.write(cols.map((c) => c.name).join(',') + '\n');
      for (const row of rows) {
        out.write(cols.map((c) => (c.real ? csvCell(row[c.name]) : '')).join(',') + '\n');
      }
      await new Promise((res, rej) => { out.end(err => err ? rej(err) : res()); });

      summary.push({ tabla: t.file, origen: `${table.schema}.${table.name}`, filas: rows.length, estado: 'ok', nota: note });
      console.log(`  ${t.file.padEnd(24)} ${String(rows.length).padStart(7)} filas  (${table.schema}.${table.name})`);
      if (note) console.log(`  ${''.padEnd(24)} ${note}`);
    } catch (e) {
      failed++;
      summary.push({ tabla: t.file, origen: '', filas: 0, estado: `ERROR: ${e.message}`, nota: '' });
      console.error(`  ${t.file.padEnd(24)} ERROR: ${e.message}`);
    }
  }

  await pool.close();

  console.log('\nResumen:');
  console.table(summary);

  if (failed && checkOnly) {
    // ayuda a corregir los candidatos de TABLES sin tener que entrar al servidor
    console.log('\nTablas visibles para este usuario (para corregir los nombres en TABLES):');
    console.log(objects.map((o) => `${o.schema}.${o.name}`).sort().join('\n'));
  }

  if (!checkOnly) {
    console.log(`\nCSV listos (UTF-8, entrecomillados) en: ${outDir}`);
    console.log('Siguiente paso:  .\\scripts\\migrar.ps1 -SinExportar');
  }

  process.exit(failed > 0 ? 1 : 0);
})().catch(e => {
  console.error('\nFalló la conexión o la consulta:', e.message);
  console.error('Verificá ERP_SQL_SERVER / ERP_SQL_USER / ERP_SQL_PASSWORD y que el servidor sea alcanzable.');
  process.exit(1);
});

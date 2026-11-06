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
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
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
// Las columnas se nombran explícitamente para que el orden del CSV no dependa
// del orden físico de la tabla en SQL Server.
const TABLES = [
  { file: 'almacen_articulo', from: 'almacen_articulo', columns: [
    'CODIGO_ARTICULO','ID_TIPO','CODIGO','CODIGO_ALA','CODIGO_CLA_ALHAJAS',
    'CODIGO_TIPO_PIEDRA','CODIGO_CLASE_PIEDRA','CODIGO_COLOR','COD_PROVEEDOR',
    'ID_COLOR_METAL','ID_TIPO_MONEDA','NOMBRE','DESCRIPCION','IMAGEN','PESO','MEDIDA',
    'PRECIO_PIEDRA','PRECIO_PRODUCTO','PORCENTAJE_COMERCIANTE','PRECIO_COMERCIANTE',
    'PORC_MAYOR','PRECIO_MAYOR','PORCENTEJE','PRECIO','PREC_GR','CLAVE','STOCK',
    'STOCK_MINIMO','ACTIVO','NUMERO','MONEDA','INICIAL','FECHA_INGRESO','ID','TIP_PIED',
    'MEDIDA_PIEDRA','PID_MED','DEJAR_USAR','FAVORITO','IND_PRODUCTO','IND_ESTADO',
    'IND_REGISTRO','PC_REGISTRO','USUARIO_REGISTRO','FECHA_REGISTRO','PC_MODIFICO',
    'USUARIO_MODIFICO','FECHA_MODIFICO','USUARIO_ANULACION','FECHA_ANULACION'] },
  { file: 'material',             from: 'material',             columns: ['codigo','nombre','Prefijo','IND_TIPO_VENTA'] },
  { file: 'tipo_alhajas',         from: 'tipo_alhajas',         columns: ['codigo_ala','nombre','prejifo'] },
  { file: 'clases_alhajas',       from: 'clases_alhajas',       columns: ['codigo_cla_alhajas','nombre','prefijo'] },
  { file: 'tipo_piedra',          from: 'Tipo_piedra',          columns: ['cod_tipopiedra','nombre_piedra'] },
  { file: 'clase_piedra',         from: 'clase_piedra',         columns: ['cod_clasepiedra','cod_tipopiedra','nombre_clasepiedra','nulo'] },
  { file: 'color_piedra',         from: 'color_piedra',         columns: ['cod_colorpiedra','nombre_color'] },
  { file: 'color_metal_articulo', from: 'Color_metal_articulo', columns: ['id_color_metal','codigo','Color','imagen'] },
  { file: 'stocks',               from: 'STOCKS',               columns: ['num_tienda','codigo_articulo','cantida','stock','Estado','ModificadoPorUsuario','AplicacionOrigen','EstacionTrabajo'] },
  { file: 'tiendas',              from: 'tiendas',              columns: ['num_tienda','nombre','anulada','ubicacion','area','caja','telefono','celular','email','web','IMAGEN','VISOR','XML1','XML2','RUTA_INSTALACION','TIENDA','RUTA_PROF','SISTEMA','REPORTE','RECIBOS','ETIQUETA'] },
  { file: 'tipo_moneda',          from: 'TIPO_MONEDA',          columns: ['ID_TIPO_MONEDA','CODIGO_SUNAT','DESCRIPCION','NOMBRE_CORTO','ABREVIACION','SIMBOLO','ALIAS','IND_ESTADO','USUARIO_REGISTRO','FECHA_REGISTRO','USUARIO_MODIFICO','FECHA_MODIFICO','CODIGO_ISO'] },
];

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

(async () => {
  console.log(`Conectando a ${config.server}:${config.port}/${config.database} como ${config.user} (solo lectura)...`);
  const pool = await sql.connect(config);
  console.log('Conectado.\n');

  if (!checkOnly) fs.mkdirSync(outDir, { recursive: true });

  const summary = [];
  let failed = 0;

  for (const t of TABLES) {
    const colList = t.columns.map(c => `[${c}]`).join(', ');
    try {
      if (checkOnly) {
        const r = await pool.request().query(`SELECT COUNT(*) AS n FROM [${t.from}]`);
        summary.push({ tabla: t.file, filas: r.recordset[0].n, estado: 'ok' });
        continue;
      }

      const result = await pool.request().query(`SELECT ${colList} FROM [${t.from}]`);
      const rows   = result.recordset;

      const out = fs.createWriteStream(path.join(outDir, `${t.file}.csv`), { encoding: 'utf8' });
      out.write(t.columns.join(',') + '\n');
      for (const row of rows) {
        out.write(t.columns.map(c => csvCell(row[c])).join(',') + '\n');
      }
      await new Promise((res, rej) => { out.end(err => err ? rej(err) : res()); });

      summary.push({ tabla: t.file, filas: rows.length, estado: 'ok' });
      console.log(`  ${t.file.padEnd(24)} ${String(rows.length).padStart(7)} filas`);
    } catch (e) {
      failed++;
      summary.push({ tabla: t.file, filas: 0, estado: `ERROR: ${e.message}` });
      console.error(`  ${t.file.padEnd(24)} ERROR: ${e.message}`);
    }
  }

  await pool.close();

  console.log('\nResumen:');
  console.table(summary);

  if (!checkOnly) {
    console.log(`\nCSV listos (UTF-8, entrecomillados) en: ${outDir}`);
    console.log('Ahora corré:  ./run.ps1 -SourceDir <cualquiera> -SkipPrepare');
  }

  process.exit(failed > 0 ? 1 : 0);
})().catch(e => {
  console.error('\nFalló la conexión o la consulta:', e.message);
  console.error('Verificá ERP_SQL_SERVER / ERP_SQL_USER / ERP_SQL_PASSWORD y que el servidor sea alcanzable.');
  process.exit(1);
});

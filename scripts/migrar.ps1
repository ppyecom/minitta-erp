# =============================================================================
# Migracion del ERP viejo (SQL Server) al ERP v2, en un solo comando.
# Se corre en la PC que llega al servidor del sistema viejo.
#
#   ./scripts/migrar.ps1                 corrida EN SECO: base temporal + reporte
#   ./scripts/migrar.ps1 -Final          carga DEFINITIVA en la base del ERP
#   ./scripts/migrar.ps1 -SinExportar    reusa los CSV ya exportados (no vuelve a leer el SQL Server)
#
# Pasos: 1) prueba la conexion al SQL Server   2) exporta las tablas (solo lectura)
#        3) crea la base y migra (db/migration/run.ps1) y deja el reporte en db/migration/.report
#
# Lee del .env: ERP_SQL_* (servidor viejo), PG* (base nueva), NODE_BIN y PG_BIN si
# son portables. La corrida en seco se puede repetir todas las veces que haga falta.
# =============================================================================
param(
  [switch]$Final,        # carga definitiva: BORRA y recrea la base del ERP
  [switch]$SinExportar   # reusa los CSV ya exportados en db/migration/.staging
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$migDir = Join-Path $root 'db\migration'
Set-Location $root

# --- config -----------------------------------------------------------------------
$vars = @{}
Get-Content (Join-Path $root '.env') | ForEach-Object {
  if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') { $vars[$Matches[1]] = $Matches[2].Trim() }
}
if ($vars['NODE_BIN']) { $env:Path = "$($vars['NODE_BIN']);$env:Path" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'No se encontro Node.js (instalarlo o definir NODE_BIN en el .env)' }

$psql = if ($vars['PG_BIN']) { Join-Path $vars['PG_BIN'] 'psql.exe' } else {
  (Get-Command psql -ErrorAction SilentlyContinue).Source
}
if (-not $psql) {
  $psql = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
          Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $psql -or -not (Test-Path $psql)) { throw 'No se encontro psql.exe (definir PG_BIN en el .env)' }

$pgHost = if ($vars['PGHOST']) { $vars['PGHOST'] } else { 'localhost' }
$pgPort = if ($vars['PGPORT']) { $vars['PGPORT'] } else { '5432' }
$pgUser = if ($vars['PGUSER']) { $vars['PGUSER'] } else { 'postgres' }
$pgDb   = if ($vars['PGDATABASE']) { $vars['PGDATABASE'] } else { 'minitta_erp' }
$env:PGPASSWORD = $vars['PGPASSWORD']
$apiPort = if ($vars['API_PORT']) { $vars['API_PORT'] } else { '3000' }

if (-not $SinExportar) {
  foreach ($k in 'ERP_SQL_SERVER', 'ERP_SQL_DATABASE', 'ERP_SQL_USER', 'ERP_SQL_PASSWORD') {
    if (-not $vars[$k]) { throw "Falta $k en el .env (datos del SQL Server del sistema viejo)" }
  }
}

Write-Host ''
if ($Final) { Write-Host '=== MIGRACION DEFINITIVA ===' -ForegroundColor Red }
else { Write-Host '=== Migracion en seco (no toca la base del ERP) ===' -ForegroundColor Cyan }
Write-Host "    sistema viejo : $($vars['ERP_SQL_SERVER']) / $($vars['ERP_SQL_DATABASE']) (solo lectura)"
Write-Host "    base nueva    : $pgHost`:$pgPort / $(if ($Final) { $pgDb } else { 'minitta_erp_dryrun (temporal)' })"
Write-Host ''

if ($Final) {
  # el ERP abierto mantiene conexiones y DROP DATABASE fallaria a mitad de camino
  $c = New-Object System.Net.Sockets.TcpClient
  $erpOpen = $false
  try { $c.Connect('127.0.0.1', [int]$apiPort); $erpOpen = $true } catch {} finally { $c.Close() }
  if ($erpOpen) { throw "El ERP esta abierto (puerto $apiPort). Cerrar su ventana antes de la carga definitiva." }

  Write-Host "ATENCION: se BORRA la base '$pgDb' y se vuelve a crear con los datos del sistema viejo." -ForegroundColor Red
  Write-Host 'Todo lo que se haya cargado a mano en el ERP nuevo se pierde.' -ForegroundColor Red
  $ok = Read-Host 'Escriba MIGRAR para continuar'
  if ($ok -ne 'MIGRAR') { Write-Host 'Cancelado.'; exit 1 }
}

# --- 1 y 2: conexion y exportacion -------------------------------------------------------
if (-not $SinExportar) {
  Write-Host '[1/3] Probando la conexion al sistema viejo...' -ForegroundColor Yellow
  node (Join-Path $migDir '021_export_from_sqlserver.js') --check
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo conectar al SQL Server: revisar ERP_SQL_* en el .env y que esta PC llegue al servidor' }

  Write-Host '[2/3] Exportando las tablas (solo lectura)...' -ForegroundColor Yellow
  node (Join-Path $migDir '021_export_from_sqlserver.js')
  if ($LASTEXITCODE -ne 0) { throw 'Fallo la exportacion' }
} else {
  Write-Host '[1-2/3] Se reusan los CSV de db/migration/.staging (-SinExportar)' -ForegroundColor DarkGray
}

# --- 3: migracion ----------------------------------------------------------------------
Write-Host '[3/3] Migrando...' -ForegroundColor Yellow
$runArgs = @{
  SourceDir   = $migDir
  SkipPrepare = $true
  PgHost      = $pgHost
  Port        = [int]$pgPort
  User        = $pgUser
  PsqlPath    = $psql
}
if ($Final) { $runArgs.Database = $pgDb; $runArgs.KeepDatabase = $true }
& (Join-Path $migDir 'run.ps1') @runArgs

Write-Host ''
if ($Final) {
  Write-Host "Migracion definitiva terminada en '$pgDb'." -ForegroundColor Green
  Write-Host 'Siguiente paso: abrir el ERP y hacer el inventario fisico de apertura de cada sede.' -ForegroundColor Green
} else {
  Write-Host 'Corrida en seco terminada. Revisar con la gente de tienda los archivos de:' -ForegroundColor Green
  Write-Host "  $(Join-Path $migDir '.report')" -ForegroundColor Green
}

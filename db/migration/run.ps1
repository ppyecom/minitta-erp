# =============================================================================
# ERP v2 - orquestador de la migracion legacy -> v2
#
# Por defecto es UNA CORRIDA EN SECO: crea una base nueva, la llena y muestra
# el reporte. No toca el ERP viejo (solo lee los CSV) ni ninguna base existente.
#
# Uso:
#   ./run.ps1 -SourceDir "C:\Users\piero\OneDrive\Desktop\productos"
#   ./run.ps1 -SourceDir "..." -Database minitta_erp -KeepDatabase
#   ./run.ps1 -SourceDir "..." -SkipPrepare          # reusa los CSV ya normalizados
# =============================================================================
param(
  [Parameter(Mandatory = $true)][string]$SourceDir,
  [string]$PgHost   = 'localhost',
  [int]   $Port     = 5433,
  [string]$User     = 'postgres',
  [string]$Database = 'minitta_erp_dryrun',
  [string]$PsqlPath = '',
  [switch]$KeepDatabase,
  [switch]$SkipPrepare,
  [string]$ReportDir = (Join-Path $PSScriptRoot '.report')
)

$ErrorActionPreference = 'Stop'
$root    = Split-Path $PSScriptRoot -Parent      # carpeta db/

# Los .sql estan en UTF-8. Sin esto psql toma la codificacion de Windows
# (WIN1252 en PCs en espanol) y corta en la primera tilde: "0x81 ... WIN1252".
$env:PGCLIENTENCODING = 'UTF8'
$staging = Join-Path $PSScriptRoot '.staging'

# --- ubicar psql -------------------------------------------------------------
if ($PsqlPath -and (Test-Path $PsqlPath)) {
  $psql = $PsqlPath
} else {
  $psql = (Get-Command psql -ErrorAction SilentlyContinue).Source
  if (-not $psql) {
    $psql = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
  }
}
if (-not $psql) { throw 'No se encontro psql. Pasalo con -PsqlPath.' }

if (-not $env:PGPASSWORD) {
  throw 'Falta la contrasena. Corre antes:  $env:PGPASSWORD = "..."'
}

function Invoke-Psql {
  param([string]$Db, [string[]]$PsqlArgs, [switch]$AllowFail)
  $all = @('-v','ON_ERROR_STOP=1','-h',$PgHost,'-p',$Port,'-U',$User,'-d',$Db) + $PsqlArgs
  & $psql @all
  if ($LASTEXITCODE -ne 0 -and -not $AllowFail) {
    throw "psql fallo (exit $LASTEXITCODE): $($PsqlArgs -join ' ')"
  }
}

Write-Host ''
Write-Host "=== Migracion ERP v2 $(if ($KeepDatabase) { '' } else { '(corrida en seco)' }) ===" -ForegroundColor Cyan
Write-Host "    psql     : $psql"
Write-Host "    servidor : $PgHost`:$Port"
Write-Host "    base     : $Database"
Write-Host ''

# --- 1. normalizar los CSV --------------------------------------------------
if (-not $SkipPrepare) {
  Write-Host '[1/6] Normalizando CSV del legacy (encoding + filas rotas)...' -ForegroundColor Yellow
  & (Join-Path $PSScriptRoot '020_prepare_csv.ps1') -SourceDir $SourceDir -OutDir $staging
} else {
  Write-Host '[1/6] Se omite la normalizacion (-SkipPrepare)' -ForegroundColor DarkGray
}

# --- 2. base limpia ---------------------------------------------------------
Write-Host ''
Write-Host '[2/6] Creando base limpia...' -ForegroundColor Yellow
& $psql -h $PgHost -p $Port -U $User -d postgres -c "DROP DATABASE IF EXISTS $Database;" | Out-Null
& $psql -h $PgHost -p $Port -U $User -d postgres -c "CREATE DATABASE $Database ENCODING 'UTF8';" | Out-Null

# --- 3. esquema v2 ----------------------------------------------------------
Write-Host '[3/6] Creando el esquema v2...' -ForegroundColor Yellow
Get-ChildItem (Join-Path $root '0*.sql') | Sort-Object Name | ForEach-Object {
  Write-Host "        $($_.Name)"
  Invoke-Psql -Db $Database -PsqlArgs @('-q','-f', $_.FullName)
}

# --- 4. staging + carga de los CSV -----------------------------------------
Write-Host '[4/6] Cargando el legacy en staging...' -ForegroundColor Yellow
Invoke-Psql -Db $Database -PsqlArgs @('-q','-f', (Join-Path $PSScriptRoot '010_staging.sql'))

$tables = @('almacen_articulo','material','tipo_alhajas','clases_alhajas','tipo_piedra',
            'clase_piedra','color_piedra','color_metal_articulo','stocks','tiendas','tipo_moneda')

foreach ($t in $tables) {
  $csv = Join-Path $staging "$t.csv"
  if (-not (Test-Path $csv)) { Write-Warning "        falta $t.csv - se omite"; continue }
  $copy = "\copy legacy.$t FROM '$($csv -replace '\\','/')' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')"
  Invoke-Psql -Db $Database -PsqlArgs @('-q','-c', $copy)
  $n = (& $psql -h $PgHost -p $Port -U $User -d $Database -tAc "SELECT count(*) FROM legacy.$t").Trim()
  Write-Host ("        {0,-24} {1,6} filas" -f $t, $n)
}

# --- 5. transformacion ------------------------------------------------------
Write-Host '[5/6] Transformando legacy -> v2...' -ForegroundColor Yellow
foreach ($step in @('030_maps.sql','040_catalog.sql','050_pricing.sql','060_inventory.sql')) {
  Write-Host "        $step"
  Invoke-Psql -Db $Database -PsqlArgs @('-q','-f', (Join-Path $PSScriptRoot $step))
}

# --- 6. reporte -------------------------------------------------------------
Write-Host '[6/6] Reporte de la corrida...' -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$reportFile = Join-Path $ReportDir ("reporte-{0}.txt" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

Invoke-Psql -Db $Database -PsqlArgs @('-f', (Join-Path $PSScriptRoot '070_report.sql')) |
  Tee-Object -FilePath $reportFile

# excepciones completas a CSV, para revisar con la gente de tienda
foreach ($v in @('v_exception_summary','v_cuarentena','v_agrupacion','v_descuadres_stock')) {
  $out = (Join-Path $ReportDir "$v.csv") -replace '\\','/'
  Invoke-Psql -Db $Database -PsqlArgs @('-q','-c', "\copy (SELECT * FROM migration.$v) TO '$out' WITH (FORMAT csv, HEADER true)")
}
Invoke-Psql -Db $Database -PsqlArgs @('-q','-c',
  "\copy (SELECT severity, stage, rule, legacy_key, message FROM migration.exception ORDER BY severity, stage, rule) TO '$((Join-Path $ReportDir 'excepciones.csv') -replace '\\','/')' WITH (FORMAT csv, HEADER true)")

Write-Host ''
Write-Host "Reporte guardado en: $ReportDir" -ForegroundColor Green

if (-not $KeepDatabase) {
  & $psql -h $PgHost -p $Port -U $User -d postgres -c "DROP DATABASE IF EXISTS $Database;" | Out-Null
  Write-Host "Base de prueba eliminada. Usa -KeepDatabase para conservarla." -ForegroundColor DarkGray
} else {
  Write-Host "Base conservada: $Database" -ForegroundColor Green
}

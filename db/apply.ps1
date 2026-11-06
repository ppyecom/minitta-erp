# =============================================================================
# ERP v2 - aplica el esquema completo (db/0*.sql) sobre una base
#
# Crea la base si no existe (ENCODING 'UTF8'), aplica las migraciones en orden
# con ON_ERROR_STOP=1 y para en el primer error mostrandolo.
#
# Uso:
#   $env:PGPASSWORD = "..."
#   ./apply.ps1 minitta_erp
#   ./apply.ps1 minitta_erp -SmokeTest
#   ./apply.ps1 minitta_erp_test -Recreate -SmokeTest -Drop
#   ./apply.ps1 minitta_erp -PgHost localhost -Port 5433 -User postgres
# =============================================================================
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Database,
  [string]$PgHost   = $(if ($env:PGHOST) { $env:PGHOST } else { 'localhost' }),
  [int]   $Port     = $(if ($env:PGPORT) { [int]$env:PGPORT } else { 5432 }),
  [string]$User     = $(if ($env:PGUSER) { $env:PGUSER } else { 'postgres' }),
  [string]$PsqlPath = '',
  [switch]$SmokeTest,   # corre db/999_smoke_test.sql al final
  [switch]$Recreate,    # borra la base antes de crearla (DESTRUCTIVO)
  [switch]$Drop         # borra la base al terminar (para pruebas desechables)
)

$ErrorActionPreference = 'Stop'

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
if (-not $psql) { throw 'No se encontro psql. Pasalo con -PsqlPath o agregalo al PATH.' }

$conn = @('-h', $PgHost, '-p', $Port, '-U', $User)

# OJO: psql mete varios -c encadenados en UNA transaccion, y DROP/CREATE DATABASE
# no pueden correr dentro de una transaccion. Por eso cada uno va en su propia
# invocacion, siempre con -c solo.
function Invoke-Maintenance {
  param([string]$Sql)
  & $psql @conn @('-v','ON_ERROR_STOP=1','-d','postgres','-q','-c', $Sql)
  if ($LASTEXITCODE -ne 0) { throw "psql fallo (exit $LASTEXITCODE) en: $Sql" }
}

function Test-DatabaseExists {
  $out = & $psql @conn @('-d','postgres','-tAc',
    "SELECT 1 FROM pg_database WHERE datname = '$Database'")
  if ($LASTEXITCODE -ne 0) { throw "No se pudo conectar a $PgHost`:$Port como $User (exit $LASTEXITCODE)." }
  return ($out | Out-String).Trim() -eq '1'
}

Write-Host ''
Write-Host '=== ERP v2 - aplicar esquema ===' -ForegroundColor Cyan
Write-Host "    psql     : $psql"
Write-Host "    servidor : $PgHost`:$Port  (usuario $User)"
Write-Host "    base     : $Database"
Write-Host ''

# --- 1. la base ---------------------------------------------------------------
if ($Recreate) {
  Write-Host "[1/3] Recreando la base $Database..." -ForegroundColor Yellow
  Invoke-Maintenance "DROP DATABASE IF EXISTS `"$Database`" WITH (FORCE);"
  Invoke-Maintenance "CREATE DATABASE `"$Database`" ENCODING 'UTF8';"
} elseif (Test-DatabaseExists) {
  Write-Host "[1/3] La base $Database ya existe." -ForegroundColor DarkGray
} else {
  Write-Host "[1/3] Creando la base $Database..." -ForegroundColor Yellow
  Invoke-Maintenance "CREATE DATABASE `"$Database`" ENCODING 'UTF8';"
}

# --- 2. migraciones ----------------------------------------------------------
$files = Get-ChildItem (Join-Path $PSScriptRoot '0*.sql') | Sort-Object Name
if (-not $files) { throw "No hay migraciones (db/0*.sql) en $PSScriptRoot" }

Write-Host ''
Write-Host "[2/3] Aplicando $($files.Count) migraciones..." -ForegroundColor Yellow
$failed = $null
foreach ($f in $files) {
  Write-Host ("        {0}" -f $f.Name) -NoNewline
  & $psql @conn @('-v','ON_ERROR_STOP=1','-d',$Database,'-q','-f', $f.FullName)
  if ($LASTEXITCODE -ne 0) {
    Write-Host '   FALLO' -ForegroundColor Red
    $failed = $f.Name
    break
  }
  Write-Host '   ok' -ForegroundColor Green
}

if ($failed) {
  Write-Host ''
  Write-Host "Se corto en $failed. El error de psql esta arriba." -ForegroundColor Red
  Write-Host 'Las migraciones ya aplicadas quedaron. Corregi el archivo y volve a correr' -ForegroundColor DarkGray
  Write-Host 'con -Recreate para arrancar de una base limpia.' -ForegroundColor DarkGray
  exit 1
}

# --- 3. prueba de humo ------------------------------------------------------
$smokeFailed = $false
if ($SmokeTest) {
  $smoke = Join-Path $PSScriptRoot '999_smoke_test.sql'
  Write-Host ''
  Write-Host '[3/3] Prueba de humo...' -ForegroundColor Yellow
  & $psql @conn @('-v','ON_ERROR_STOP=1','-d',$Database,'-f', $smoke)
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host "La prueba de humo fallo (exit $LASTEXITCODE)." -ForegroundColor Red
    $smokeFailed = $true
  } else {
    Write-Host ''
    Write-Host 'Prueba de humo OK.' -ForegroundColor Green
  }
} else {
  Write-Host ''
  Write-Host '[3/3] Prueba de humo omitida (pasa -SmokeTest para correrla).' -ForegroundColor DarkGray
}

# --- limpieza opcional ------------------------------------------------------
if ($Drop) {
  Invoke-Maintenance "DROP DATABASE IF EXISTS `"$Database`" WITH (FORCE);"
  Write-Host "Base $Database eliminada (-Drop)." -ForegroundColor DarkGray
}

if ($smokeFailed) { exit 1 }

Write-Host ''
Write-Host "Listo: esquema aplicado en $Database." -ForegroundColor Green
exit 0

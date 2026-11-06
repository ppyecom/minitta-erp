# =============================================================================
# Servidor PostgreSQL portable del ERP (sin servicio de Windows).
# Lee PG_BIN, PG_DATA y PGPORT del .env de la raiz.
#
#   ./scripts/pg.ps1 start     arranca el servidor (si no esta corriendo)
#   ./scripts/pg.ps1 stop      lo detiene
#   ./scripts/pg.ps1 status    dice si esta corriendo
#
# Despues de reiniciar la PC hay que volver a correr "start" (o npm run db:start).
# =============================================================================
param([Parameter(Position = 0)][ValidateSet('start', 'stop', 'status')][string]$Action = 'status')

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root '.env'
if (-not (Test-Path $envFile)) { throw "No existe $envFile (copiar .env.example a .env)" }

$vars = @{}
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') { $vars[$Matches[1]] = $Matches[2].Trim() }
}
$bin = $vars['PG_BIN']; $data = $vars['PG_DATA']
$port = if ($vars['PGPORT']) { $vars['PGPORT'] } else { '5432' }
if (-not $bin -or -not $data) { throw 'Faltan PG_BIN y PG_DATA en el .env' }

$pgctl = Join-Path $bin 'pg_ctl.exe'
$log = Join-Path (Split-Path $data -Parent) 'postgres.log'

& $pgctl status -D $data *> $null
$running = ($LASTEXITCODE -eq 0)

switch ($Action) {
  'status' {
    if ($running) { Write-Host "PostgreSQL corriendo en el puerto $port" -ForegroundColor Green }
    else { Write-Host 'PostgreSQL detenido' -ForegroundColor Yellow }
  }
  'start' {
    if ($running) { Write-Host "PostgreSQL ya estaba corriendo (puerto $port)" -ForegroundColor DarkGray; break }
    # Start-Process y no "&": postgres hereda las tuberias de salida de quien lo
    # lanza, y con "&" la consola se queda esperando hasta que el servidor se apaga.
    $p = Start-Process -FilePath $pgctl -ArgumentList @('start', '-D', "`"$data`"", '-l', "`"$log`"", '-o', "`"-p $port`"", '-w') `
      -WindowStyle Hidden -PassThru
    # WaitForExit y no -Wait: en PowerShell 5.1, -Wait espera tambien a los hijos (postgres)
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) { throw "No arranco. Revisar $log" }
    Write-Host "PostgreSQL arrancado en el puerto $port" -ForegroundColor Green
  }
  'stop' {
    if (-not $running) { Write-Host 'PostgreSQL ya estaba detenido' -ForegroundColor DarkGray; break }
    & $pgctl stop -D $data -m fast -w | Out-Null
    Write-Host 'PostgreSQL detenido' -ForegroundColor Green
  }
}

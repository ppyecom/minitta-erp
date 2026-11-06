# =============================================================================
# Servidor PostgreSQL del ERP.
#
#   ./scripts/pg.ps1 start     arranca el servidor (si no esta corriendo)
#   ./scripts/pg.ps1 stop      lo detiene
#   ./scripts/pg.ps1 status    dice si esta corriendo
#
# Dos formas de tener PostgreSQL, segun el .env:
#   - Portable (PG_BIN y PG_DATA definidos): este script lo arranca y lo detiene.
#     Despues de reiniciar la PC hay que volver a correr "start".
#   - Instalado con el instalador oficial (PG_BIN/PG_DATA vacios): corre como
#     servicio de Windows y arranca solo. Aca solo se verifica que responda.
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
$pgHost = if ($vars['PGHOST']) { $vars['PGHOST'] } else { 'localhost' }
$port = if ($vars['PGPORT']) { $vars['PGPORT'] } else { '5432' }

function Test-PgPort {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect($pgHost, [int]$port); return $true } catch { return $false } finally { $c.Close() }
}

# --- PostgreSQL instalado como servicio de Windows ---------------------------------
if (-not $bin -or -not $data) {
  if (Test-PgPort) {
    Write-Host "PostgreSQL (servicio de Windows) respondiendo en $pgHost`:$port" -ForegroundColor Green
    exit 0
  }
  if ($Action -eq 'stop') { Write-Host 'PostgreSQL corre como servicio: se detiene desde services.msc' -ForegroundColor DarkGray; exit 0 }
  Write-Host "PostgreSQL no responde en $pgHost`:$port." -ForegroundColor Red
  Write-Host 'Revisar en services.msc que el servicio postgresql-x64-NN este iniciado,' -ForegroundColor Red
  Write-Host 'o definir PG_BIN y PG_DATA en el .env si se usa la version portable.' -ForegroundColor Red
  exit 1
}

# --- PostgreSQL portable --------------------------------------------------------------
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

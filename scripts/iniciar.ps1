# =============================================================================
# Arranca el ERP en esta PC.
#
#   ./scripts/iniciar.ps1            uso diario: http://localhost:3000
#   ./scripts/iniciar.ps1 -Dev       desarrollo con recarga en vivo: http://localhost:5173
#   ./scripts/iniciar.ps1 -Build     fuerza recompilar antes de arrancar
#
# Lee NODE_BIN (Node portable) del .env. Cerrar la ventana detiene el ERP;
# PostgreSQL sigue corriendo hasta "npm run db:stop" o reiniciar la PC.
# =============================================================================
param([switch]$Dev, [switch]$Build)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$vars = @{}
Get-Content (Join-Path $root '.env') | ForEach-Object {
  if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') { $vars[$Matches[1]] = $Matches[2].Trim() }
}
if ($vars['NODE_BIN']) { $env:Path = "$($vars['NODE_BIN']);$env:Path" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'No se encontro Node.js: definir NODE_BIN en el .env' }

Write-Host ''
Write-Host '  Minitta ERP' -ForegroundColor Yellow
Write-Host ''

# 1. base de datos
& (Join-Path $PSScriptRoot 'pg.ps1') start
if ($LASTEXITCODE -ne 0) { exit 1 }

# 2. dependencias (primera vez o después de un git pull con paquetes nuevos)
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Write-Host 'Instalando dependencias (solo la primera vez)...' -ForegroundColor Cyan
  npm install --no-audit --no-fund
}

if ($Dev) {
  Write-Host 'Modo desarrollo: http://localhost:5173 (se recarga al guardar cambios)' -ForegroundColor Cyan
  Start-Job -ScriptBlock { Start-Sleep -Seconds 20; Start-Process 'http://localhost:5173' } | Out-Null
  npm run dev
  exit
}

# 3. compilar si falta el build (o si se pidió)
$apiBuilt = Test-Path (Join-Path $root 'apps/api/dist/main.js')
$webBuilt = Test-Path (Join-Path $root 'apps/web/dist/index.html')
if ($Build -or -not $apiBuilt -or -not $webBuilt) {
  Write-Host 'Compilando el ERP...' -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Fallo la compilacion' }
}

# 4. arrancar y abrir el navegador
$port = if ($vars['API_PORT']) { $vars['API_PORT'] } else { '3000' }
Write-Host "ERP en http://localhost:$port  (cerrar esta ventana lo detiene)" -ForegroundColor Green
Start-Job -ScriptBlock { param($p) Start-Sleep -Seconds 4; Start-Process "http://localhost:$p" } -ArgumentList $port | Out-Null
npm start

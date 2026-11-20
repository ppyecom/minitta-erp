# =============================================================================
# Prueba de punta a punta de la API.
#
# Crea una base desechable, levanta la API contra ella y recorre el camino real:
# arranque sin usuarios -> primer administrador -> login -> rol de vendedora ->
# los 403 que tiene que dar -> bloqueo por intentos -> cerrar sesion, y despues
# el cliente como entidad (buscarlo, crearlo, no duplicarlo, su historia).
#
# Verifica lo que las pruebas de humo de SQL (db/99*.sql) no pueden: que la
# cookie sea httpOnly, que el hash nunca se devuelva, que el guard global
# proteja los endpoints por omision, que scrypt verifique de verdad y que la
# validacion de entrada corte antes de llegar a la base.
#
#   ./scripts/e2e.ps1
#   ./scripts/e2e.ps1 -Database otra_prueba -ApiPort 3998 -KeepDatabase
#
# Lee la conexion del .env. Sale con 0 si todo paso, o con la cantidad de fallos.
# =============================================================================
param(
  [string]$Database = 'minitta_e2e',
  [int]   $ApiPort  = 3999,
  [switch]$KeepDatabase,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent

# Necesita PowerShell 7: usa -SkipHttpErrorCheck para leer las respuestas 401 y
# 403 sin que se vuelvan excepciones, y eso no existe en Windows PowerShell 5.1.
if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw "Esta prueba necesita PowerShell 7. Corrala con:  pwsh -File scripts/e2e.ps1  (o npm run test:e2e)"
}

Get-Content (Join-Path $repo '.env') | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
    $n = $Matches[1]; $v = $Matches[2].Trim('"').Trim("'")
    if ($v) { Set-Item -Path "env:$n" -Value $v }
  }
}
if (-not $env:PGPASSWORD) { throw 'Falta PGPASSWORD en el .env' }

$env:PGDATABASE = $Database
$env:API_PORT   = "$ApiPort"
$env:API_HOST   = '127.0.0.1'
$base = "http://127.0.0.1:$ApiPort/api"

$fails = 0
function Check($name, $ok, $detail = '') {
  if ($ok) { Write-Host "  OK      $name" -ForegroundColor Green }
  else { Write-Host "  FALLO   $name  $detail" -ForegroundColor Red; $script:fails++ }
}
# Invoke-WebRequest que no corta con 4xx: devuelve @(status, objeto)
function Call($method, $path, $body, $session) {
  $req = @{ Uri = "$base$path"; Method = $method; WebSession = $session
            SkipHttpErrorCheck = $true; ContentType = 'application/json' }
  if ($body) { $req.Body = ($body | ConvertTo-Json -Compress) }
  $r = Invoke-WebRequest @req
  $obj = $null
  if ($r.Content) { try { $obj = $r.Content | ConvertFrom-Json } catch {} }
  return @($r.StatusCode, $obj)
}

Write-Host ''
Write-Host "=== e2e de la API (base $Database, puerto $ApiPort) ===" -ForegroundColor Cyan

Set-Location $repo
Write-Host ''
Write-Host '[0] Base limpia...' -ForegroundColor Yellow
# psql escribe avisos por stderr; en Windows PowerShell 5.1 (el de "npm run") eso
# con ErrorActionPreference 'Stop' corta el script, así que acá se deja pasar y se
# juzga por el codigo de salida, como corresponde con un programa externo.
& {
  $ErrorActionPreference = 'Continue'
  & (Join-Path $repo 'db/apply.ps1') $Database -Recreate 2>&1 | Select-Object -Last 2
}
if ($LASTEXITCODE -ne 0) { throw "no se pudo preparar la base $Database (exit $LASTEXITCODE)" }

if (-not $SkipBuild) {
  Write-Host ''
  Write-Host '[1] Compilando...' -ForegroundColor Yellow
  npm run build -w @minitta/shared 2>&1 | Out-Null
  npm run build -w @minitta/api 2>&1 | Select-Object -Last 2
}

Write-Host ''
Write-Host '[2] Levantando la API...' -ForegroundColor Yellow
$log = Join-Path $env:TEMP 'minitta-e2e-api.log'
$err = Join-Path $env:TEMP 'minitta-e2e-api.err'
$api = Start-Process node -ArgumentList 'dist/main.js' -WorkingDirectory (Join-Path $repo 'apps/api') `
       -PassThru -NoNewWindow -RedirectStandardOutput $log -RedirectStandardError $err

try {
  $up = $false
  foreach ($i in 1..40) {
    Start-Sleep -Milliseconds 500
    try { Invoke-WebRequest "$base/auth/status" -SkipHttpErrorCheck -TimeoutSec 2 | Out-Null; $up = $true; break } catch {}
  }
  if (-not $up) { Get-Content $err -Tail 20; throw 'la API no levanto' }
  Write-Host '    arriba'

  Write-Host ''
  Write-Host '[3] Sin sesion no se entra a ningun lado' -ForegroundColor Yellow
  $s = Call GET '/auth/status' $null $null
  Check 'GET /auth/status responde 200' ($s[0] -eq 200)
  Check 'dice que falta crear el primer usuario' ($s[1].needsBootstrap -eq $true)
  foreach ($path in '/products', '/kardex', '/lookups', '/ops/work-orders') {
    $r = Call GET $path $null $null
    Check "GET $path sin cookie da 401" ($r[0] -eq 401) "dio $($r[0])"
  }

  Write-Host ''
  Write-Host '[4] Primer administrador' -ForegroundColor Yellow
  $b = Call POST '/auth/bootstrap' @{ username = 'admin'; full_name = 'Administrador'; password = 'minitta-2026' } $null
  Check 'bootstrap crea el administrador' ($b[1].created -eq $true) "$($b[0])"
  $b2 = Call POST '/auth/bootstrap' @{ username = 'otro'; full_name = 'Otro'; password = 'minitta-2026' } $null
  Check 'el segundo bootstrap NO crea nada' ($b2[1].created -eq $false)

  Write-Host ''
  Write-Host '[5] Login del administrador' -ForegroundColor Yellow
  $bad = Call POST '/auth/login' @{ username = 'admin'; password = 'equivocada'; station = 'caja-01' } $null
  Check 'clave incorrecta da 401' ($bad[0] -eq 401) "dio $($bad[0])"
  $nadie = Call POST '/auth/login' @{ username = 'no-existe'; password = 'x'; station = 'x' } $null
  Check 'usuario inexistente da el MISMO mensaje' ($nadie[1].message -eq $bad[1].message) "dijo '$($nadie[1].message)'"
  $sys = Call POST '/auth/login' @{ username = 'migracion'; password = 'x'; station = 'x' } $null
  Check 'un usuario de sistema no se loguea' ($sys[0] -eq 401) "dio $($sys[0])"

  $admin = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $li = Call POST '/auth/login' @{ username = 'admin'; password = 'minitta-2026'; station = 'caja-01' } $admin
  Check 'login correcto da 200' ($li[0] -eq 200) "dio $($li[0])"
  Check 'devuelve el usuario' ($li[1].username -eq 'admin')
  Check 'el admin trae los 24 permisos' ($li[1].permissions.Count -eq 24) "trajo $($li[1].permissions.Count)"
  Check 'nunca devuelve el hash' (-not ($li[1].PSObject.Properties.Name -contains 'password_hash'))
  $cookie = $admin.Cookies.GetCookies("http://127.0.0.1:$ApiPort") | Where-Object Name -eq 'minitta_session'
  Check 'la cookie de sesion es httpOnly' ($cookie.HttpOnly -eq $true)

  Write-Host ''
  Write-Host '[6] Con sesion, el admin entra a todo' -ForegroundColor Yellow
  foreach ($path in '/auth/me', '/lookups', '/products', '/kardex', '/access/roles', '/access/permissions') {
    $r = Call GET $path $null $admin
    Check "GET $path da 200" ($r[0] -eq 200) "dio $($r[0])"
  }
  $se = Call GET '/auth/sessions' $null $admin
  Check 've su sesion abierta' ($se[1].Count -eq 1) "vio $($se[1].Count)"
  Check 'la sesion dice de que PC es' ($se[1][0].client_info -eq 'erp-web / caja-01') "dijo '$($se[1][0].client_info)'"

  Write-Host ''
  Write-Host '[7] Una vendedora: ve lo suyo y nada mas' -ForegroundColor Yellow
  $nu = Call POST '/users' @{ username = 'ana'; full_name = 'Ana Vendedora'; email = ''; document_id = ''; can_see_cost = $false; is_active = $true } $admin
  Check 'el admin crea a la vendedora' ($nu[0] -in 200, 201) "dio $($nu[0])"
  $anaId = $nu[1].id
  $roles = Call GET '/access/roles' $null $admin
  $vend = ($roles[1] | Where-Object code -eq 'vendedor').id
  Check '/access/roles devuelve filas con id' ($vend -gt 0) "vendedor id = '$vend'"
  $rr = Call PUT "/access/users/$anaId/roles" @{ role_ids = @($vend) } $admin
  Check 'le asigna el rol de vendedora' ($rr[0] -eq 200) "dio $($rr[0])"
  $pw = Call POST "/auth/users/$anaId/password" @{ new_password = 'ana-12345' } $admin
  Check 'le pone una clave' ($pw[0] -eq 200) "dio $($pw[0])"

  $ana = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $al = Call POST '/auth/login' @{ username = 'ana'; password = 'ana-12345'; station = 'vitrina' } $ana
  Check 'la vendedora entra' ($al[0] -eq 200) "dio $($al[0])"
  Check 'y tiene que cambiar la clave' ($al[1].must_change_password -eq $true)
  $blocked = Call GET '/products' $null $ana
  Check 'con la clave sin cambiar, todo lo demas da 403' ($blocked[0] -eq 403) "dio $($blocked[0])"
  $cp = Call POST '/auth/password' @{ current_password = 'ana-12345'; new_password = 'ana-propia-1' } $ana
  Check 'cambia su clave' ($cp[0] -eq 200) "dio $($cp[0])"

  $pr2 = Call GET '/products' $null $ana
  Check 'ahora si ve el catalogo' ($pr2[0] -eq 200) "dio $($pr2[0])"
  foreach ($case in @(
      @{ m = 'POST'; p = '/movements'; b = @{ variant_id = 1; location_id = 1; type = 'adjust_in'; quantity = 5 }; what = 'mover stock' },
      @{ m = 'POST'; p = '/masters/stones'; b = @{ code = 'X'; name = 'X' };                                      what = 'editar maestros' },
      @{ m = 'POST'; p = '/transfers'; b = @{ from_location_id = 1; to_location_id = 2 };                          what = 'transferir' },
      @{ m = 'PUT';  p = "/access/users/$anaId/roles"; b = @{ role_ids = @($vend) };                                what = 'darse roles' })) {
    $r = Call $case.m $case.p $case.b $ana
    Check "NO puede $($case.what) (403)" ($r[0] -eq 403) "dio $($r[0])"
  }

  Write-Host ''
  Write-Host '[8] Bloqueo por intentos fallidos' -ForegroundColor Yellow
  foreach ($i in 1..5) { Call POST '/auth/login' @{ username = 'ana'; password = 'no'; station = 'x' } $null | Out-Null }
  $locked = Call POST '/auth/login' @{ username = 'ana'; password = 'ana-propia-1'; station = 'x' } $null
  Check 'a los 5 intentos queda bloqueada, aun con la clave buena' ($locked[0] -eq 401) "dio $($locked[0])"
  Check 'y el mensaje lo explica' ($locked[1].message -like '*bloqueado*') "dijo '$($locked[1].message)'"
  $un = Call POST "/auth/users/$anaId/unlock" $null $admin
  Check 'el admin la desbloquea' ($un[0] -eq 200) "dio $($un[0])"
  $ana2 = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $re = Call POST '/auth/login' @{ username = 'ana'; password = 'ana-propia-1'; station = 'vitrina' } $ana2
  Check 'y vuelve a entrar' ($re[0] -eq 200) "dio $($re[0])"

  Write-Host ''
  Write-Host '[9] Cerrar sesion' -ForegroundColor Yellow
  $lo = Call POST '/auth/logout' $null $ana2
  Check 'logout da 200' ($lo[0] -eq 200) "dio $($lo[0])"
  $after = Call GET '/products' $null $ana2
  Check 'despues del logout la cookie ya no sirve (401)' ($after[0] -eq 401) "dio $($after[0])"
  $kick = Call POST "/auth/users/$anaId/logout" $null $admin
  Check 'el admin puede cerrar las sesiones de otro' ($kick[0] -eq 200) "dio $($kick[0])"

  Write-Host ''
  Write-Host '[10] El cliente como entidad' -ForegroundColor Yellow
  # la fase 9 cerro las sesiones de Ana (el admin la deslogueo), asi que entra de nuevo
  $ana = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $relog = Call POST '/auth/login' @{ username = 'ana'; password = 'ana-propia-1'; station = 'vitrina' } $ana
  Check 'la vendedora vuelve a entrar' ($relog[0] -eq 200) "dio $($relog[0])"

  # el cliente de vitrina lo crea la migracion 013 y tiene que estar siempre
  $vitrina = Call GET '/customers?q=vitrina' $null $admin
  Check 'existe el cliente de vitrina' ($vitrina[1].items.Count -ge 1) "vio $($vitrina[1].items.Count)"

  # la vendedora puede crear un cliente en el mostrador: si costara dos
  # pantallas nadie lo haria y volveria el texto libre
  $c1 = Call POST '/customers' @{
    kind = 'person'; document_type = 'dni'; document_number = '40123456'
    name = 'María Quispe Huamán'; phone = '999888777'; birth_date = '1985-03-14'
    } $ana
  Check 'la vendedora crea un cliente' ($c1[0] -in 200, 201) "dio $($c1[0]) $($c1[1].message)"
  $mariaId = $c1[1].id
  Check 'el codigo lo genera la base' ($c1[1].code -match '^CLI-\d{6}$') "dio '$($c1[1].code)'"

  # ESTE es el bug que la migracion 013 arregla
  $dup = Call POST '/customers' @{
    kind = 'person'; document_type = 'dni'; document_number = '40123456'
    name = 'Maria Quispe H.' } $ana
  Check 'el mismo DNI no puede ser dos clientes' ($dup[0] -eq 409) "dio $($dup[0]) $($dup[1].message)"

  # la validacion de entrada corta antes de la base
  $badDni = Call POST '/customers' @{
    kind = 'person'; document_type = 'dni'; document_number = '4012345'; name = 'Siete digitos' } $ana
  Check 'un DNI de 7 digitos se rechaza (400)' ($badDni[0] -eq 400) "dio $($badDni[0])"
  $rucPerson = Call POST '/customers' @{
    kind = 'person'; document_type = 'ruc'; document_number = '20512345678'; name = 'Persona con RUC' } $ana
  Check 'un RUC en una persona se rechaza (400)' ($rucPerson[0] -eq 400) "dio $($rucPerson[0])"

  # sin documento SI se puede: el de vitrina no se deduplica, a proposito
  $sinDoc = Call POST '/customers' @{ kind = 'person'; document_type = 'none'; name = 'Señora del abrigo rojo' } $ana
  Check 'un cliente sin documento se puede guardar' ($sinDoc[0] -in 200, 201) "dio $($sinDoc[0])"
  $sinDoc2 = Call POST '/customers' @{ kind = 'person'; document_type = 'none'; name = 'Señora del abrigo rojo' } $ana
  Check 'y dos sin documento con el mismo nombre conviven' ($sinDoc2[0] -in 200, 201) "dio $($sinDoc2[0])"

  # asi se busca en el mostrador
  foreach ($term in 'quispe', '999888777', '40123456') {
    $r = Call GET "/customers?q=$term" $null $ana
    # el -and $mariaId evita que esto pase por casualidad si la creacion fallo
    $found = $mariaId -and @($r[1].items | Where-Object { $_.customer_id -eq $mariaId }).Count -eq 1
    Check "se encuentra buscando '$term'" $found "trajo $($r[1].items.Count) (id buscado: '$mariaId')"
  }
  $bd = Call GET '/customers/birthdays?month=3' $null $ana
  Check 'aparece en los cumpleanos de marzo' `
    ($mariaId -and @($bd[1] | Where-Object { $_.id -eq $mariaId }).Count -eq 1)

  # el taller solo lee: no puede crear ni corregir clientes
  $bruno = Call POST '/users' @{ username = 'bruno'; full_name = 'Bruno Taller'; email = ''
                                 document_id = ''; can_see_cost = $false; is_active = $true } $admin
  $brunoId = $bruno[1].id
  $tallerRole = ($roles[1] | Where-Object code -eq 'taller').id
  Call PUT "/access/users/$brunoId/roles" @{ role_ids = @($tallerRole) } $admin | Out-Null
  Call POST "/auth/users/$brunoId/password" @{ new_password = 'bruno-12345' } $admin | Out-Null
  $bs = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  Call POST '/auth/login' @{ username = 'bruno'; password = 'bruno-12345'; station = 'taller' } $bs | Out-Null
  Call POST '/auth/password' @{ current_password = 'bruno-12345'; new_password = 'bruno-propia-1' } $bs | Out-Null
  $tallerRead = Call GET '/customers' $null $bs
  Check 'el taller puede VER los clientes' ($tallerRead[0] -eq 200) "dio $($tallerRead[0])"
  $tallerWrite = Call POST '/customers' @{ kind = 'person'; document_type = 'none'; name = 'No deberia' } $bs
  Check 'el taller NO puede crear clientes (403)' ($tallerWrite[0] -eq 403) "dio $($tallerWrite[0])"

  Write-Host ''
  Write-Host '[11] Custodia y apartado cuelgan del mismo cliente' -ForegroundColor Yellow
  $loc = Call GET '/lookups' $null $admin
  $tienda = ($loc[1].locations | Where-Object { $_.holds_stock -and $_.is_active } | Select-Object -First 1).id
  $cus = Call POST '/ops/custody' @{
    customer_id = $mariaId; description = 'Anillo de compromiso'
    requested_service = 'Soldar aro'; received_weight_g = 4.82; location_id = $tienda } $ana
  Check 'se recibe una pieza en custodia del cliente' ($cus[0] -in 200, 201) "dio $($cus[0]) $($cus[1].message)"

  $cusList = Call GET "/ops/custody?customer_id=$mariaId" $null $ana
  Check 'la custodia trae el nombre desde core.customer' `
    (@($cusList[1].items).Count -eq 1 -and $cusList[1].items[0].customer_name -eq 'María Quispe Huamán') `
    "trajo $(@($cusList[1].items).Count): '$($cusList[1].items[0].customer_name)'"
  $byName = Call GET '/ops/custody?q=quispe' $null $ana
  Check 'la custodia se busca por el nombre del cliente' ($byName[1].items.Count -eq 1) "trajo $($byName[1].items.Count)"

  $ficha = Call GET "/customers/$mariaId" $null $ana
  Check 'la ficha del cliente muestra su custodia' ($ficha[1].custody.Count -eq 1) "vio $($ficha[1].custody.Count)"
  Check 'y la cuenta como abierta' ($ficha[1].open_items -eq 1) "dijo $($ficha[1].open_items)"

  # con una pieza nuestra en la vitrina del cliente, no se lo puede dar de baja
  $off = Call PUT "/customers/$mariaId" @{
    kind = 'person'; document_type = 'dni'; document_number = '40123456'
    name = 'María Quispe Huamán'; is_active = $false } $ana
  Check 'un cliente con algo abierto no se desactiva (422)' ($off[0] -eq 422) "dio $($off[0]) $($off[1].message)"

  # corregir el nombre lo corrige en toda la historia: es el punto de normalizar
  $fix = Call PUT "/customers/$mariaId" @{
    kind = 'person'; document_type = 'dni'; document_number = '40123456'
    name = 'María Quispe Huamán de Rojas'; phone = '999888777' } $ana
  Check 'se corrige el nombre del cliente' ($fix[0] -eq 200) "dio $($fix[0]) $($fix[1].message)"
  $cusAfter = Call GET "/ops/custody?customer_id=$mariaId" $null $ana
  Check 'y la custodia ya muestra el nombre corregido' `
    (@($cusAfter[1].items).Count -eq 1 -and
     $cusAfter[1].items[0].customer_name -eq 'María Quispe Huamán de Rojas') `
    "dijo '$($cusAfter[1].items[0].customer_name)'"

  Write-Host ''
  if ($fails -eq 0) { Write-Host 'TODO OK' -ForegroundColor Green }
  else { Write-Host "$fails CHEQUEOS FALLARON" -ForegroundColor Red }
}
finally {
  if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force }
  if (-not $KeepDatabase) {
    $psql = (Get-Command psql -ErrorAction SilentlyContinue).Source
    if (-not $psql) {
      $psql = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
              Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
    if ($psql) {
      & $psql -h $env:PGHOST -p $env:PGPORT -U $env:PGUSER -d postgres `
              -c "DROP DATABASE IF EXISTS `"$Database`" WITH (FORCE);" | Out-Null
    }
  }
}
exit $fails

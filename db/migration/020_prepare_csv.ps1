# =============================================================================
# ERP v2 - migracion 020: normalizar los CSV del legacy antes de cargarlos
#
# Hace tres cosas que el export del ERP viejo no hace:
#   1. Convierte de Windows-1252 a UTF-8  (arregla LAPIS?AZULI, NI?A, BA?O, DISE?O)
#   2. Re-escribe el CSV con comillas correctas (el export parte filas cuando la
#      descripcion trae comas o saltos de linea: por ejemplo APM1)
#   3. Detecta y aparta las filas rotas, en vez de cargarlas mal en silencio
#
# Uso:
#   ./020_prepare_csv.ps1 -SourceDir "C:\Users\piero\OneDrive\Desktop\productos"
# =============================================================================
param(
  [Parameter(Mandatory = $true)][string]$SourceDir,
  [string]$OutDir = (Join-Path $PSScriptRoot '.staging')
)

$ErrorActionPreference = 'Stop'

# nombre de archivo de origen -> tabla de staging + columna clave para validar
$files = @(
  @{ File = 'almacen-articulo.csv';      Table = 'almacen_articulo';      Key = 'CODIGO_ARTICULO';  KeyPattern = '^[A-Za-z0-9ÑñÁÉÍÓÚ_\-\.]+$' }
  @{ File = 'material.csv';              Table = 'material';              Key = 'codigo';           KeyPattern = '^.{1,3}$' }
  @{ File = 'tipo_alhajas.csv';          Table = 'tipo_alhajas';          Key = 'codigo_ala';       KeyPattern = '^.{1,3}$' }
  @{ File = 'clases_alhajas.csv';        Table = 'clases_alhajas';        Key = 'codigo_cla_alhajas'; KeyPattern = '^.{1,3}$' }
  @{ File = 'Tipo_piedra.csv';           Table = 'tipo_piedra';           Key = 'cod_tipopiedra';   KeyPattern = '^\d+$' }
  @{ File = 'clase_piedra.csv';          Table = 'clase_piedra';          Key = 'cod_clasepiedra';  KeyPattern = '^\d+$' }
  @{ File = 'color_piedra.csv';          Table = 'color_piedra';          Key = 'cod_colorpiedra';  KeyPattern = '^.{1,4}$' }
  @{ File = 'Color_metal_articulo.csv';  Table = 'color_metal_articulo';  Key = 'id_color_metal';   KeyPattern = '^\d+$' }
  @{ File = 'STOCKS.csv';                Table = 'stocks';                Key = 'codigo_articulo';  KeyPattern = '^[A-Za-z0-9ÑñÁÉÍÓÚ_\-\.]+$' }
  @{ File = 'tiendas.csv';               Table = 'tiendas';               Key = 'num_tienda';       KeyPattern = '^\d+$' }
  @{ File = 'TIPO_MONEDA.csv';           Table = 'tipo_moneda';           Key = 'ID_TIPO_MONEDA';   KeyPattern = '^\d+$' }
)

if (-not (Test-Path $SourceDir)) { throw "No existe la carpeta de origen: $SourceDir" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# Windows-1252: el encoding real del export del ERP viejo
$win1252 = [System.Text.Encoding]::GetEncoding(1252)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$summary = @()

foreach ($spec in $files) {
  $src = Join-Path $SourceDir $spec.File
  if (-not (Test-Path $src)) {
    Write-Warning "FALTA  $($spec.File) - se omite"
    $summary += [pscustomobject]@{ Tabla = $spec.Table; Filas = 0; Rotas = 0; Estado = 'FALTA' }
    continue
  }

  # leer como Windows-1252 y parsear como CSV (maneja comillas y saltos internos)
  $raw  = [System.IO.File]::ReadAllText($src, $win1252)
  $rows = $raw | ConvertFrom-Csv

  if (-not $rows) {
    $summary += [pscustomobject]@{ Tabla = $spec.Table; Filas = 0; Rotas = 0; Estado = 'VACIO' }
    continue
  }

  $cols = $rows[0].PSObject.Properties.Name

  # --- control de cantidad de campos por registro -----------------------------
  # El export del ERP viejo NO entrecomilla los campos de texto, asi que una
  # descripcion con comas ("alt 6.4cm,c/mostac,strass,...") agrega columnas y
  # CORRE todos los valores siguientes: el peso termina en otra columna y el
  # precio queda mal. ConvertFrom-Csv no avisa: descarta los campos de sobra en
  # silencio. Por eso se cuentan los campos registro por registro.
  $shifted = New-Object System.Collections.Generic.HashSet[int]
  $parser = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser($src, $win1252)
  $parser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
  $parser.SetDelimiters(',')
  $parser.HasFieldsEnclosedInQuotes = $true
  try {
    $null = $parser.ReadFields()            # cabecera
    $recNo = 0
    while (-not $parser.EndOfData) {
      try   { $fields = $parser.ReadFields() }
      catch { $parser.ReadLine() | Out-Null; $null = $shifted.Add($recNo); $recNo++; continue }
      if ($fields.Count -ne $cols.Count) { $null = $shifted.Add($recNo) }
      $recNo++
    }
  } finally { $parser.Close() }

  if ($cols -notcontains $spec.Key) {
    throw "$($spec.File): no se encontro la columna clave '$($spec.Key)'. Columnas: $($cols -join ', ')"
  }

  # una fila es valida si su columna clave tiene la forma esperada.
  # Las filas rotas del export (continuacion de una descripcion partida)
  # caen aca porque su clave es basura o esta vacia.
  $good = @()
  $bad  = @()
  $i = 0
  foreach ($r in $rows) {
    $k = [string]$r.($spec.Key)
    $keyOk = (-not [string]::IsNullOrWhiteSpace($k)) -and ($k -match $spec.KeyPattern)
    if ($keyOk -and -not $shifted.Contains($i)) { $good += $r } else { $bad += $r }
    $i++
  }

  $outFile = Join-Path $OutDir "$($spec.Table).csv"
  $good | Export-Csv -Path $outFile -NoTypeInformation -Encoding utf8NoBOM

  if ($bad.Count -gt 0) {
    $badFile = Join-Path $OutDir "$($spec.Table).RECHAZADAS.csv"
    $bad | Export-Csv -Path $badFile -NoTypeInformation -Encoding utf8NoBOM
    Write-Warning "$($spec.Table): $($bad.Count) fila(s) rota(s) apartadas en $badFile"
  }

  $summary += [pscustomobject]@{
    Tabla  = $spec.Table
    Filas  = $good.Count
    Rotas  = $bad.Count
    Estado = if ($bad.Count -eq 0) { 'OK' } else { 'CON FILAS ROTAS' }
  }
}

Write-Host ''
Write-Host 'Resumen de preparacion' -ForegroundColor Cyan
$summary | Format-Table -AutoSize

$totalBad = ($summary | Measure-Object -Property Rotas -Sum).Sum
if ($totalBad -gt 0) {
  Write-Host ''
  Write-Warning @"
Hay $totalBad fila(s) que el export del ERP viejo partio mal.
Estan en los archivos *.RECHAZADAS.csv y NO se van a migrar.
Lo correcto es volver a exportar esas tablas desde SQL Server con comillas
(bcp con -t'","' o un export que cite los campos de texto), o leer directo
de SQL Server. Revisar antes de la carga definitiva.
"@
}

Write-Host ''
Write-Host "Archivos listos en: $OutDir" -ForegroundColor Green

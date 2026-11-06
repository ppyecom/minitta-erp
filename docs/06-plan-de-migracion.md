# ERP v2 — Migración legacy → v2

Scripts en [`db/migration/`](../db/migration/). Están hechos para
**correrse muchas veces en seco**: crean una base nueva, la llenan, imprimen el reporte y
la borran. No escriben nada en el ERP viejo ni en ninguna base existente.

---

## 1. Hallazgo que cambia el plan: el export CSV no sirve

Al validar campo por campo apareció esto: **el export del ERP viejo no entrecomilla los
campos de texto**. Cualquier descripción con una coma agrega columnas y **corre todos los
valores siguientes**.

Caso real, `AWS1`:

```
AWS1,1,A,W,S,4,19,0N,,20,1,Tiaraz,alt 6.4cm,c/mostac,strass,alamb.forrado y perlas a extremos,C:\...jpg,28.5,...
                                         └──────── 4 campos donde debía haber 1 ────────┘
```

La descripción real es `"alt 6.4cm, c/mostac, strass, alamb.forrado y perlas a extremos"`.
Al no estar entrecomillada, el peso 28.5 aterriza tres columnas más allá, el precio queda
en el lugar del porcentaje, y así hasta el final de la fila.

**En el export de muestra, 49 de 101 filas de `almacen_articulo` están corridas** (48%),
más 3 de `clases_alhajas` (`"CHEVAL, ASA COLG C/PI, HUAY"`). Una fila más, `APM1`, está
partida en dos por un salto de línea.

Lo peor es que esto se corrompe **en silencio**: un parser CSV normal descarta los campos
de sobra sin avisar. Si se migra así, el catálogo queda con pesos y precios de otra columna
y nadie se da cuenta hasta meses después.

### Consecuencia

La migración definitiva **no se hace desde CSV**. Se lee directo de SQL Server con
[`021_export_from_sqlserver.js`](../db/migration/021_export_from_sqlserver.js),
que hace `SELECT` (solo lectura) y escribe CSV **entrecomillado y en UTF-8**. Ahí el
problema no existe, porque los valores llegan tipados desde la base.

El camino CSV sigue soportado para pruebas rápidas, con dos redes de seguridad:

1. [`020_prepare_csv.ps1`](../db/migration/020_prepare_csv.ps1) cuenta los campos
   de **cada registro** y aparta los que no cuadran en `*.RECHAZADAS.csv`.
2. En SQL, un detector de columnas corridas marca como error cualquier fila donde `PESO` no
   sea numérico, `ACTIVO` no sea `y`/`n`, `MONEDA` no sea una moneda o `PRECIO` traiga texto.

---

## 2. Cómo se corre

**Opción A — desde SQL Server (la definitiva):**

```bash
npm install && npm run check:legacy
```

```bash
npm run export:legacy
```

```powershell
$env:PGPASSWORD = "..."; cd db\migration; ./run.ps1 -SourceDir . -SkipPrepare -KeepDatabase
```

Necesita `ERP_SQL_SERVER`, `ERP_SQL_PORT`, `ERP_SQL_DATABASE`, `ERP_SQL_USER` y
`ERP_SQL_PASSWORD` en el entorno o en el `.env` de la raíz (ver `.env.example`).

> **Aparte, sobre seguridad — en el otro repositorio:** en `ppyecom/minittasoft`, las
> credenciales de este mismo SQL Server están **escritas en el código**, en
> `backend/src/services/erp-sync.service.ts` (líneas 23-27), como valores por defecto:
> usuario, contraseña, IP y base. Están en el repositorio, en su historial de git.
> Conviene moverlas a `.env` y **rotar la contraseña**. Este proyecto no las hardcodea: las
> exige del entorno, y `.env` está en `.gitignore`.

**Opción B — desde los CSV (para probar):**

```powershell
$env:PGPASSWORD = "..."; ./run.ps1 -SourceDir "C:\Users\piero\OneDrive\Desktop\productos"
```

Agregá `-KeepDatabase` para conservar la base y revisarla.

---

## 3. Qué hace cada paso

| Script | Qué hace |
|---|---|
| `010_staging.sql` | esquema `legacy` con **todo en text y sin constraints**: carga tal cual vino, sin fallar por un dato malo. Más `migration.exception` y los helpers de limpieza |
| `020_prepare_csv.ps1` | Windows-1252 → UTF-8, re-escribe con comillas, aparta filas rotas |
| `021_export_from_sqlserver.js` | alternativa recomendada: lee directo del ERP viejo (solo lectura) |
| `030_maps.sql` | mapea **cada letra y cada número**: material, categorías, piedras, colores, colores de metal, sedes, usuarios |
| `040_catalog.sql` | agrupa artículos en productos, crea variantes, extrae piedras y medidas del texto libre |
| `050_pricing.sql` | precios y costos, **sin modificar ningún monto** |
| `060_inventory.sql` | arma los conteos de apertura; **no crea stock** |
| `070_report.sql` | reporte de la corrida + CSVs para revisar |
| `998_test_agrupacion.sql` | test de la lógica de agrupación con las filas `ASD` bien formadas |

---

## 4. Las decisiones que toma el script

### Agrupar sin fusionar de más

Dos artículos del legacy se unen en un producto sólo si coinciden en **material + tipo +
clase + nombre base + descripción + precio**. El nombre base quita el `@` inicial y el
sufijo numérico: `RivierP2_01` → `rivierp2`.

Así `ASD1…ASD6` sí se unen (misma descripción, mismo precio 566), pero `Tiaraz` (S/ 70),
`Tiaraz1` (S/ 24) y `Tiaraz2` (S/ 24) **no**: sus descripciones dicen alturas distintas
(6.4 cm, 2.9 cm, 3.7 cm). Fusionarlos por nombre parecido habría sido un error.

Resultado verificado con `998_test_agrupacion.sql`:

```
code |    name     | variantes |            legacy
-----+-------------+-----------+-------------------------------
 ASD | RivierP2_01 |         6 | ASD1,ASD2,ASD3,ASD4,ASD5,ASD6
```

### El color de piedra es un eje de variante

Esto salió de la prueba: `ASD3` y `ASD6` son **los dos talla 14**, pero uno es rubí y el
otro cristalino. Son dos SKU distintos. Hubo que agregar `catalog.variant.stone_color` al
esquema y meterlo en la clave de unicidad; el detalle completo sigue en `variant_stone`.

```
legacy_code |    sku     | talla | stone_color
------------+------------+-------+-------------
 ASD3       | ASD-14-ROJ | 14    | rojo
 ASD6       | ASD-14-CRI | 14    | cristalino
```

### Artículos duplicados = piezas, no variantes

`CHI114` y `CHI115` son ambos "Cochola" de 30 cm, misma descripción y mismo precio, pero
pesan 250 g y 256.5 g. No son dos variantes: son **dos piezas** del mismo modelo.

Van a una sola variante, y los dos códigos quedan en `migration.variant_alias` con su peso
cada uno. Ningún código del legacy se pierde: la cobertura verificada es **100%**.

### Extracción de texto libre, con reglas explícitas

| Patrón en la descripción | A dónde va |
|---|---|
| `20 pi 2.5 mm` | `variant_stone.quantity = 20`, `size_mm = 2.50` |
| `19*19cm` | `product.width_mm` y `height_mm` (×10) |
| `alt 6.4cm` | `product.height_mm` |
| `MEDIDA` numérica 3–35 en sortijas/argollas | `variant.size_value_id` (talla) |
| `MEDIDA` cualquier otra cosa (`"5.5*4"`, `30`) | `variant.size_label` + se marca para revisión |

Lo que no entra en una regla clara **no se adivina**: queda en `legacy_flags` y sale en el
reporte.

### Cuarentena en vez de inventar datos

Las filas con datos imposibles entran como `status='draft'` (no vendibles) y salen listadas:

```
legacy_code |   sku   | raw_name | peso | precio |     motivos
------------+---------+----------+------+--------+------------------
 AWS25      | AWS-001 | Coronas  |  0.1 |   1632 | {peso_vs_precio}
 AWS26      | AWS-003 | Coronas1 |  0.1 |   1200 | {peso_vs_precio}
```

Reglas de cuarentena: `peso_vs_precio`, `peso_sospechoso_uniforme` (el caso `BWS1..BWS13`,
13 filas con peso exactamente 1), `sin_peso`, `sin_precio`, `fecha_futura`, `sin_material`,
`medida_sin_interpretar`, `columnas_corridas`.

### El stock no se migra

Por la decisión 5. Los saldos del legacy ya están en conflicto, y el script lo documenta
con números:

```
legacy_code | sede | stock_en_stocks | stock_en_articulo | discrepancia
------------+------+-----------------+-------------------+--------------
 BLX2       | T-1  |         132.000 |           125.000 |        7.000
```

En lugar de heredar el descuadre, se crea un `count_sheet` de apertura por sede, con una
línea por variante y el saldo legacy en `migration.count_reference` **como referencia, no
como verdad**. El último paso de `060_inventory.sql` falla a propósito si detecta que se
creó aunque sea un movimiento:

```
la migración no debe crear stock: hay N movimiento(s) y N unidad(es) en saldo
```

### Los precios no se tocan

Todos entran en `mode='manual'` con el monto exacto del legacy. Pasar a `by_weight` o
`by_margin` es una decisión posterior, producto por producto. El script sí deja las pistas:
qué variantes traen `PREC_GR` (candidatas a precio por peso) y cuáles son los márgenes más
frecuentes del legacy, para configurar `pricing.price_rule`.

---

## 5. Resultado de la última corrida (CSV de muestra)

Con las 52 filas sanas del export:

| | |
|---|---|
| productos creados | 50 |
| variantes creadas | 50 |
| códigos legacy cubiertos | 52 (incluye 2 alias) |
| precios creados | 101 |
| movimientos de stock | **0** (correcto) |
| **artículos del legacy no migrados** | **0** |
| variantes sin producto / sin categoría | 0 / 0 |
| códigos legacy duplicados | 0 |

Errores que requieren decisión de la empresa:

| Regla | Casos | Qué hace falta |
|---|---|---|
| `columnas_corridas` | 49 | re-exportar desde SQL Server |
| `clave_sin_descifrar` | 71 artículos | la tabla de equivalencias letra→dígito de `CLAVE`; sin ella no hay costo real |
| `peso_vs_precio` | 2 | pesar `AWS25` y `AWS26` |
| `saldo_en_conflicto` | 1+ | se resuelve contando |
| `sin_precio_publico` | 1 | ponerle precio o descontinuarlo |
| `ecommerce_sin_precios` | 1 | decidir si la lista copia el precio público o se migra del Postgres de la tienda |

---

## 6. Antes de la carga definitiva

1. Re-exportar desde SQL Server con `021_export_from_sqlserver.js` (no desde CSV).
2. Correr en seco y revisar `.report/excepciones.csv` y `.report/v_agrupacion.csv` **con la
   gente de tienda**. La agrupación es lo más importante: son ellos los que saben si dos
   códigos son el mismo modelo.
3. Conseguir la tabla de equivalencias de `CLAVE`, o aceptar arrancar sin costo histórico.
4. Poner las fechas reales de cierre de las sedes (`closed_at`), que hoy está en
   `2024-01-01` como marcador en el seed.
5. Subir las imágenes a Cloudinary y actualizar `storage_key`/`url`: hoy quedan como
   `pendiente/<archivo>.jpg` con la ruta vieja guardada en `legacy_path`.
6. Contar el inventario físico por sede y cerrar los `count_sheet` de apertura.

Recién después de eso, la carga en producción.

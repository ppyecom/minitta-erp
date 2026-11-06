# Minitta ERP

ERP de Minitta Joyería, hecho de nuevo. Esta primera etapa cubre **productos, variantes,
piedras, precios, costos, inventario y sedes**. Ventas, compras, caja y clientes vienen
después y se enganchan a este núcleo sin tocarlo.

Reemplaza al "Sistema Minitta" (SQL Server), cuyo modelo tenía el significado de los datos
incrustado en códigos de una letra, no distinguía producto de variante, guardaba el stock
en dos tablas que ya no coinciden, y no tenía historial de precios ni movimientos de
inventario. El diagnóstico completo, con ejemplos de las filas reales, está en
[docs/01-diagnostico-datos-legacy.md](docs/01-diagnostico-datos-legacy.md).

---

## Qué hay acá

```
db/                     esquema PostgreSQL (migraciones 001..007 + prueba de humo)
db/apply.ps1 .sh        aplica el esquema sobre una base
db/migration/           migración desde el ERP viejo (SQL Server)
docs/                   diagnóstico, modelo, decisiones, cobertura y plan de migración
CLAUDE.md               las reglas que el esquema impone y no hay que romper
```

Motor: **PostgreSQL 16+** (verificado en 18.1), UTF-8, cuatro esquemas:
`core` (sedes, usuarios, auditoría) · `catalog` (productos, variantes, piedras) ·
`pricing` (listas, precios, costos) · `inventory` (kardex, saldos, series).

56 tablas y 6 vistas.

---

## Arrancar

```bash
cp .env.example .env
```

Después, con la contraseña de Postgres en el entorno, un solo comando crea la base (si no
existe, con `ENCODING 'UTF8'`) y aplica `db/0*.sql` en orden, parando en el primer error.

En Windows con PowerShell:

```powershell
$env:PGPASSWORD = "..."; .\db\apply.ps1 minitta_erp -Port 5433
```

En Linux o macOS:

```bash
export PGPASSWORD=...; ./db/apply.sh minitta_erp
```

Las opciones son las mismas en los dos scripts, pero **`apply.ps1` las lleva con un guion y
`apply.sh` con dos** — mezclarlas no da un error obvio (PowerShell contesta «No se encuentra
ningún parámetro posicional»):

| `apply.ps1` | `apply.sh` | |
|---|---|---|
| `-SmokeTest` | `--smoke-test` | corre `db/999_smoke_test.sql` al final |
| `-Recreate` | `--recreate` | borra la base y la vuelve a crear desde cero |
| `-Drop` | `--drop` | la elimina al terminar (base de prueba desechable) |
| `-PgHost` `-Port` `-User` | `--host` `--port` `--user` | el servidor; por defecto toma `PGHOST`/`PGPORT`/`PGUSER` |

## Verificar que funciona

```powershell
.\db\apply.ps1 minitta_erp_test -Port 5433 -Recreate -SmokeTest -Drop
```

Eso crea una base limpia, aplica el esquema, corre `db/999_smoke_test.sql` y la borra.
Sobre una base que ya está aplicada, la prueba de humo sola:

```bash
psql -v ON_ERROR_STOP=1 -d minitta_erp -f db/999_smoke_test.sql
```

Cubre: un producto con 5 variantes y 100 piedras, precio manual vs. calculado por peso, dos
piezas serializadas con pesos reales distintos, una pieza que sale al taller, kardex con
saldo corrido, un apartado, un inventario físico de apertura, sugerencia de reposición,
reconstrucción del saldo desde cero, auditoría automática, y **6 reglas que deben
rechazarse** (vender más de lo que hay, mover 2 unidades de una pieza única, mover una
serializada sin indicar cuál, cargar stock en una oficina, y editar o borrar un movimiento
del kardex).

---

## Las 3 reglas que no se rompen

1. **El stock no se escribe.** `inventory.stock` es caché de `inventory.movement`.
   `inventory.rebuild_stock()` lo reconstruye y `inventory.v_stock_integrity` debe devolver
   **0 filas** siempre.
2. **El kardex es append-only.** Un error se corrige con un movimiento de ajuste, nunca con
   un `UPDATE`. Los triggers lo impiden.
3. **La app no inserta movimientos a mano.** Llama a `inventory.post_movement(...)` y a las
   funciones de transferencia y conteo, que validan y dejan rastro.

Contexto que la app debe setear en cada sesión:

```sql
SET LOCAL app.user_id = '42';
SET LOCAL app.client_info = 'caja-02 / T-1';
```

Sin `app.user_id`, los movimientos sin `created_by` explícito se rechazan y la auditoría
queda sin autor.

Las reglas completas, con las funciones que la app debe llamar y las convenciones del
esquema, están en [CLAUDE.md](CLAUDE.md).

---

## Migrar desde el ERP viejo

Guía completa en [docs/06-plan-de-migracion.md](docs/06-plan-de-migracion.md).

**No migrar desde los CSV que exporta el ERP viejo.** No entrecomillan los campos de texto,
así que cualquier descripción con una coma corre las columnas: en el export de muestra, 48%
de las filas de `almacen_articulo` estaban corridas, y en silencio. Hay que leer directo de
SQL Server:

```bash
npm install && npm run check:legacy
```

```bash
npm run export:legacy
```

```powershell
$env:PGPASSWORD = "..."; cd db\migration; ./run.ps1 -SourceDir . -SkipPrepare
```

La corrida es **en seco** por defecto: crea una base nueva, imprime el reporte en
`.report/` y la borra. `-KeepDatabase` la conserva para revisarla.

El reporte es lo que se revisa con la gente de tienda antes de cargar en producción:
agrupación de artículos, variantes en cuarentena, descuadres de stock y excepciones por
regla.

---

## Documentación

| | |
|---|---|
| [01 — Diagnóstico del legacy](docs/01-diagnostico-datos-legacy.md) | qué está mal en el modelo viejo, con las filas reales |
| [02 — Modelo de datos](docs/02-modelo-datos-productos-stock-sedes.md) | el esquema v2 explicado tabla por tabla |
| [03 — Verificación](docs/03-ejemplo-verificacion.md) | el modelo probado contra 4 casos reales |
| [04 — Decisiones](docs/04-decisiones-confirmadas.md) | listas de precio, serialización, arranque del stock, sedes cerradas |
| [05 — Cobertura de datos](docs/05-cobertura-de-datos.md) | las 50 columnas del legacy una por una, y los 40 datos que hoy no están en ninguna tabla |
| [06 — Plan de migración](docs/06-plan-de-migracion.md) | cómo correrla, qué decide el script, qué falta decidir |

---

## Pendientes antes de producción

1. Re-exportar desde SQL Server (no desde CSV) y correr la migración en seco.
2. Revisar la agrupación de artículos **con la gente de tienda**: son ellos los que saben si
   dos códigos son el mismo modelo.
3. Conseguir la tabla de equivalencias de `CLAVE` (el costo codificado en letras del
   legacy), o aceptar arrancar sin costo histórico.
4. Poner las fechas reales de cierre de las sedes (`closed_at`); en el seed están con
   `2024-01-01` como marcador.
5. Subir las imágenes a Cloudinary y actualizar `storage_key`/`url`: hoy quedan como
   `pendiente/<archivo>.jpg`, con la ruta vieja guardada en `legacy_path`.
6. Contar el inventario físico por sede y cerrar los `count_sheet` de apertura.

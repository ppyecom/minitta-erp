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

## Usar el ERP

Doble clic en **`Iniciar ERP.cmd`**: arranca PostgreSQL, compila si hace falta y abre
<http://localhost:3000>. Cerrar la ventana lo detiene. La primera vez pide crear el usuario
administrador.

Para trabajar en el código, con recarga en vivo al guardar:

```powershell
.\scripts\iniciar.ps1 -Dev        # interfaz en http://localhost:5173, API en :3000
.\scripts\iniciar.ps1 -Build      # uso diario, forzando recompilar tras un cambio
```

En esta PC Node.js y PostgreSQL son **portables**, en `D:\minitta-tools` (sin instalador ni
servicio de Windows). El `.env` apunta a ellos con `NODE_BIN`, `PG_BIN` y `PG_DATA`.
`npm run db:start` / `db:stop` / `db:status` manejan PostgreSQL; después de reiniciar la PC,
`Iniciar ERP.cmd` lo vuelve a levantar solo.

---

## Qué hay acá

```
apps/api/               API en NestJS: un módulo por dominio (core, catalog, pricing, inventory)
apps/web/               interfaz en React + Vite + Tailwind: las mismas carpetas por módulo
packages/shared/        enums con su etiqueta en español y validaciones (Zod) de API y web
db/                     esquema PostgreSQL (migraciones 001..008 + prueba de humo)
db/apply.ps1 .sh        aplica el esquema sobre una base
db/migration/           migración desde el ERP viejo (SQL Server)
docs/                   diagnóstico, modelo, decisiones, cobertura y plan de migración
scripts/                arranque del ERP y del PostgreSQL portable
uploads/                imágenes de productos (locales, fuera de git)
CLAUDE.md               las reglas que el esquema impone y no hay que romper
```

Motor: **PostgreSQL 16+** (verificado en 18.1 y 18.6), UTF-8, cuatro esquemas:
`core` (sedes, usuarios, auditoría) · `catalog` (productos, variantes, piedras) ·
`pricing` (listas, precios, costos) · `inventory` (kardex, saldos, series).

56 tablas y 6 vistas.

### La aplicación

- **API** (`apps/api`): NestJS con [Kysely](https://kysely.dev) (SQL tipado, sin ORM), para
  que la app llame a `post_movement()`, `resolve_price()` y las demás funciones del esquema
  en lugar de saltearlas con `INSERT` sueltos. Cada escritura abre una transacción y fija
  `app.user_id` (regla 4 de [CLAUDE.md](CLAUDE.md)). Los errores de la base (`saldo
  insuficiente…`) llegan a la pantalla tal cual, en español.
- **Interfaz** (`apps/web`): React 19, TanStack Query, Radix UI y Tailwind 4, con modo
  claro/oscuro. Cada pantalla se carga al abrirla: sumar módulos no hace más lento el arranque.
- **Imágenes**: se guardan en `uploads/` como WebP de 1600 px como máximo; la base guarda la
  ruta en `media.storage_key`, igual que guardaría el id de Cloudinary.
- **Usuarios**: todavía sin contraseña. Se elige quién usa la PC en la barra superior y eso
  firma la auditoría y el kardex. `can_see_cost` decide quién ve y edita costos.
- **Tipos de la base**: `npm run db:types` regenera `apps/api/src/db/db-types.ts` después de
  cada migración nueva.

Módulos nuevos (ventas, compras, caja, clientes, taller): una carpeta en
`apps/api/src/modules/` y otra en `apps/web/src/modules/`, más su entrada en `app.module.ts`
y en `App.tsx`. Se enganchan al inventario por `inventory.post_movement()` con su `doc_type`.

---

## Aplicar el esquema a mano

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

**Paso a paso para instalar en la PC de la red y migrar:
[docs/07-instalar-y-migrar.md](docs/07-instalar-y-migrar.md).** En resumen:

```powershell
.\scripts\migrar.ps1            # en seco: base temporal + reporte, repetible
.\scripts\migrar.ps1 -Final     # definitiva: borra y recrea la base del ERP
```

Qué decide el script y por qué: [docs/06-plan-de-migracion.md](docs/06-plan-de-migracion.md).
Lo de abajo es lo que `migrar.ps1` hace por dentro.

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
| [07 — Instalar y migrar](docs/07-instalar-y-migrar.md) | paso a paso en la PC que llega al servidor viejo |

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

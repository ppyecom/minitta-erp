# CLAUDE.md — reglas de trabajo en este repo

Este archivo no resume el proyecto (para eso están el [README](README.md) y `docs/01`..`docs/06`).
Fija las reglas que el esquema **ya impone** y que es fácil romper desde la aplicación.

Base: PostgreSQL 16+ (verificado en 18.1). Esquemas `core`, `catalog`, `pricing`, `inventory`.

---

## 1. El stock no se escribe

`inventory.stock` es **caché derivado** de `inventory.movement`. Nunca hacer
`INSERT`/`UPDATE`/`DELETE` sobre `inventory.stock`: el saldo lo mantienen los triggers de
`inventory.movement`.

- `inventory.rebuild_stock()` lo reconstruye desde cero a partir del kardex.
- `inventory.v_stock_integrity` **debe devolver 0 filas siempre**. Si devuelve algo, hay un
  bug (alguien escribió el caché a mano o lo salteó): reconstruir y buscar la causa, no
  parchear el saldo.

## 2. El kardex es append-only

`inventory.movement` tiene triggers que **bloquean `UPDATE` y `DELETE`**. No hay forma de
corregir un movimiento equivocado editándolo: se corrige con **otro movimiento de ajuste**,
que queda a la vista con su autor y su motivo. Esto es deliberado — el legacy no tenía
kardex y por eso el stock quedó descuadrado sin que nadie pueda reconstruir qué pasó.

## 3. La aplicación no inserta movimientos a mano

Siempre a través de las funciones, que validan y dejan rastro:

| Función | Para qué |
|---|---|
| `inventory.post_movement(variant, location, type, qty, user, ...)` | un movimiento cualquiera |
| `inventory.send_transfer(transfer_id, user_id)` | despachar una transferencia entre sedes |
| `inventory.receive_transfer(transfer_id, user_id)` | recibirla (acepta recepción parcial) |
| `inventory.open_count_sheet(location, user, is_opening, category)` | abrir un inventario físico |
| `inventory.apply_count_sheet(count_sheet_id, user_id)` | cerrarlo: cada diferencia se vuelve un movimiento |

Validan lo que un `INSERT` suelto no valida: que no se venda más de lo que hay, que una
pieza serializada indique **cuál** pieza, que una sede sin stock (la oficina) no reciba
mercadería, que una pieza única no mueva 2 unidades. La prueba de humo verifica esas 6
reglas; si agregás una función nueva, agregale su caso ahí.

Para precios, lo mismo: el precio lo resuelve `pricing.resolve_price()` (fijo, por peso del
metal, o por margen sobre el costo). No calcular precios en la aplicación.

## 4. Cada sesión de base de datos setea `app.user_id`

De ahí salen la auditoría (`core.audit_row()`) y el `created_by` de los movimientos:

```sql
SET LOCAL app.user_id = '42';
SET LOCAL app.client_info = 'caja-02 / T-1';
```

Sin `app.user_id`, los movimientos sin `created_by` explícito se rechazan y la auditoría
queda sin autor. El pool de conexiones tiene que setearlo al tomar la conexión, no una vez
al arrancar.

## 5. Convenciones del esquema

- **Nombres en inglés**, `snake_case`, tablas en singular (`product`, `variant`, `movement`).
  Los comentarios y la documentación van en español.
- **Enums declarados** (`CREATE TYPE`), nunca `'y'`/`'Si'`/`1`/`2` como booleano ni códigos de
  una letra con significado escondido. El legacy hacía eso y es la razón por la que se
  rehízo: ver [docs/01](docs/01-diagnostico-datos-legacy.md).
- **`timestamptz` en todo**, nunca `timestamp` ni `date` para instantes.
- **`bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`** como PK. El código de negocio
  (`code`, `sku`) es una columna aparte, con su `UNIQUE`.
- **`legacy_code`** es la columna para cruzar con el ERP viejo. Siempre visible y buscable;
  no se borra ni se reusa para otra cosa.
- Numéricos de dinero y peso: `numeric`, nunca `float`.

## 6. Migraciones

- Son **archivos numerados en `db/`** (`001_core.sql` .. `008_fix_receive_transfer.sql`).
- Se **agregan**: un archivo ya aplicado no se edita nunca. Un cambio al esquema es un
  `008_...sql` nuevo.
- Se aplican con [`db/apply.ps1`](db/apply.ps1) (Windows) o [`db/apply.sh`](db/apply.sh), no a
  mano. Ambos aplican `db/0*.sql` en orden con `ON_ERROR_STOP=1`.
- `db/999_smoke_test.sql` corre en una sola transacción y debe salir con **exit 0**: los casos
  1–8 (más el 6b, transferencia con faltante) OK y las 6 reglas de integridad en `RECHAZADO`.
- Los scripts de migración desde el legacy viven en **`db/migration/`** y son otra cosa:
  no forman parte del esquema y se corren una sola vez, con `db/migration/run.ps1`.

## 7. La aplicación (apps/api, apps/web)

- **Toda escritura pasa por `DbService.tx(user, fn)`**: abre la transacción y fija
  `app.user_id`/`app.client_info` con `set_config(..., true)`. No escribir con `dbs.db` directo.
- El usuario llega en la cabecera `x-user-id` (decorador `@CurrentUser()`). Cuando exista el
  login, se reemplaza ahí y en `apps/web/src/lib/session.tsx`, sin tocar los controladores.
- Las validaciones de entrada viven en `packages/shared/src/schemas.ts` y se aplican con
  `@Body(zod(schema))`. Los enums con su etiqueta en español, en `packages/shared/src/enums.ts`:
  si una migración agrega un valor a un `CREATE TYPE`, se agrega ahí también.
- `pg` devuelve `bigint` y `numeric` como `number` (ver `db.service.ts`); `npm run db:types`
  regenera los tipos y los ajusta a eso. Correrlo después de cada migración.
- Precios y costos **no se sobrescriben**: se cierra el vigente (`valid_to = now()`) y se
  inserta otro. El historial es parte del modelo.
- Un módulo nuevo es una carpeta en `apps/api/src/modules/<x>` y otra en
  `apps/web/src/modules/<x>`; no se mezclan dominios en el mismo controlador.

## 8. Nunca commitear

- `.env` (hay `.env.example` con las variables, sin valores).
- CSV, XLSX o `.bak` con datos del ERP viejo, ni exports, ni capturas de la base de
  producción. `.gitignore` ya los excluye — no agregar excepciones.
- El export CSV del ERP viejo además está corrupto (no entrecomilla los campos de texto,
  48% de las filas corridas): la migración real lee directo de SQL Server con
  `db/migration/021_export_from_sqlserver.js`. No volver a la vía CSV.

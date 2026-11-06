# ERP v2 — Instalar en una PC y migrar los datos del sistema viejo

La migración lee el SQL Server del sistema viejo, así que se hace en una PC **que llegue a ese
servidor por la red**. Todo lo que sigue se hace en esa PC.

---

## 1. Instalar los programas

Con sus instaladores oficiales (los tres piden permisos de administrador):

| Programa | De dónde | Nota |
|---|---|---|
| Git | <https://git-scm.com/download/win> | opciones por defecto |
| Node.js LTS | <https://nodejs.org> | opciones por defecto |
| PostgreSQL 18 | <https://www.postgresql.org/download/windows/> | anotar la contraseña del usuario `postgres`; puerto 5432 |

PostgreSQL queda como servicio de Windows: arranca solo con la PC. No hace falta nada de
`D:\minitta-tools` (eso es solo para la PC donde se instaló en modo portable).

## 2. Bajar el proyecto

En una terminal, en la carpeta donde vaya a vivir (por ejemplo `D:\`):

```bash
git clone https://github.com/ppyecom/minitta-erp
```
```bash
cd minitta-erp
```
```bash
npm install
```

## 3. Configurar el `.env`

Copiar `.env.example` a `.env` y completar:

| Variable | Valor |
|---|---|
| `PGHOST` | `127.0.0.1` |
| `PGPASSWORD` | la contraseña de `postgres` que se puso al instalar |
| `ERP_SQL_SERVER` | IP o nombre del servidor del sistema viejo |
| `ERP_SQL_DATABASE` | nombre de la base del sistema viejo |
| `ERP_SQL_USER` / `ERP_SQL_PASSWORD` | un usuario **de solo lectura** (pedirlo a quien maneja el servidor) |

`NODE_BIN`, `PG_BIN` y `PG_DATA` se dejan **vacíos**: son solo para la instalación portable.
El `.env` no se sube nunca a git.

## 4. Corrida en seco (todas las veces que haga falta)

```powershell
.\scripts\migrar.ps1
```

Prueba la conexión, exporta las tablas del sistema viejo (solo `SELECT`), migra a una base
**temporal** y la borra. No toca la base del ERP. Deja en `db/migration/.report/`:

| Archivo | Qué revisar con la gente de tienda |
|---|---|
| `reporte-*.txt` | el resumen: cuántos productos, variantes, precios; qué falló |
| `v_agrupacion.csv` | qué códigos viejos se juntaron como un mismo modelo |
| `v_cuarentena.csv` | artículos con datos imposibles (entran como borrador) |
| `v_descuadres_stock.csv` | dónde las dos tablas de stock del sistema viejo no coinciden |
| `excepciones.csv` | todo lo demás, regla por regla |

Si algo no cuadra, se corrige (en el sistema viejo o en `db/migration/030_maps.sql`) y se
vuelve a correr. Para no releer el servidor en cada prueba: `.\scripts\migrar.ps1 -SinExportar`.

## 5. Carga definitiva

Con el reporte revisado y **el ERP cerrado**:

```powershell
.\scripts\migrar.ps1 -Final
```

Pide escribir `MIGRAR`, **borra y vuelve a crear** la base del ERP y la llena con el
catálogo, las sedes y los precios del sistema viejo. Lo que se haya cargado a mano en el ERP
antes de este paso se pierde: hasta acá, usar el ERP solo para practicar.

## 6. Arrancar el stock

La migración **no trae saldos** (los del sistema viejo están descuadrados, ver
[06](06-plan-de-migracion.md)). Abrir el ERP con `Iniciar ERP.cmd` y, en
**Inventario físico**, abrir el conteo de apertura de cada sede: el saldo viejo aparece como
referencia y lo contado se vuelve el stock inicial, firmado por quien contó. Las piezas de oro
o con gemas se registran en **Piezas**, una por una, con su peso real.

## Antes de la migración

Para usar el ERP vacío (practicar, cargar a mano) hace falta crear la base una vez:

```powershell
$env:PGPASSWORD = "<la del .env>"; .\db\apply.ps1 minitta_erp -PgHost 127.0.0.1
```

Después, `Iniciar ERP.cmd` y listo.

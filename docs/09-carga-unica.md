# ERP v2 — La carga única: del ERP viejo al nuevo, una sola vez

Esta es la secuencia de la **carga definitiva**. No es una sincronización que se
repite: es un corte. Después de este día, el catálogo del sistema viejo deja de ser
la verdad y nadie lo vuelve a tocar.

La decisión de fondo: **entra lo que está bien formado como vendible, y lo dudoso entra
como borrador con el motivo a la vista.** Nada se descarta, nada se inventa, y lo que
falta queda en una lista de trabajo para el personal.

---

## 0. Antes de empezar: el freno que tiene el script

`run.ps1` **borra la base de destino** para armarla de cero. Si alguien ya cargó
productos, movió stock o completó pendientes en el ERP nuevo, volver a correr la
migración destruye todo eso.

Por eso el paso 2 ahora se corta solo:

```
La base 'minitta_erp' ya tiene datos (1 registros entre productos,
movimientos y usuarios). Correr la migracion la BORRA entera.
```

Para pisarla hay que pasar `-Force` a propósito. **Este es el orden correcto: primero
se carga, después el personal trabaja. Nunca al revés.**

---

## 1. Conseguir los datos del servidor viejo

El export en CSV **no sirve**: no entrecomilla los campos de texto y el 48% de las filas
quedan corridas (ver [docs/06](06-plan-de-migracion.md) §1). La carga definitiva lee
directo de SQL Server, en solo lectura.

En el `.env` de la raíz:

```
ERP_SQL_SERVER=
ERP_SQL_PORT=1433
ERP_SQL_DATABASE=
ERP_SQL_USER=
ERP_SQL_PASSWORD=
```

Pedir un usuario **de consulta**. Este proyecto nunca escribe en el ERP viejo.

```bash
npm run check:legacy
```

Muestra qué tablas encontró y qué columnas faltan, sin exportar nada. Si eso está bien:

```bash
npm run export:legacy
```

---

## 2. Correr en seco y revisar con la gente de tienda

```powershell
$env:PGPASSWORD = "..."; cd db\migration; ./run.ps1 -SourceDir . -SkipPrepare
```

Por defecto crea una base descartable, imprime el reporte y la borra. Deja los CSV en
`db/migration/.report/`:

| Archivo | Para qué |
|---|---|
| `v_agrupacion.csv` | **el más importante**: qué códigos viejos se unieron en un mismo producto. Solo la gente de tienda sabe si `ASD1` y `ASD4` son el mismo modelo |
| `v_cuarentena.csv` | qué entra como borrador y por qué |
| `excepciones.csv` | todo lo que el script no pudo resolver |
| `v_descuadres_stock.csv` | dónde el stock viejo se contradice a sí mismo |

Este paso se repite las veces que haga falta. No toca nada.

---

## 3. La carga de verdad

En la PC que llega al servidor viejo, con el ERP **cerrado**:

```powershell
.\scripts\migrar.ps1 -Final
```

Pide escribir `MIGRAR` con el aviso en rojo, verifica que el ERP no esté abierto (una
conexión abierta haría fallar el `DROP DATABASE` a mitad de camino) y recién ahí carga.
Es el camino recomendado: `run.ps1` directo sirve para las corridas en seco.

Qué queda después:

- Los productos y variantes bien formados, **activos y vendibles**.
- Los dudosos, **en borrador**, con su motivo.
- Los precios tal cual estaban, en modo `manual`. Ningún monto se modifica.
- **Cero movimientos de stock**: el saldo no se hereda (ver abajo).
- El esquema `migration` con el detalle de cada excepción, por si hay que auditar algo.

---

## 4. Los usuarios

Al abrir el ERP por primera vez pide crear el **usuario administrador**. Ese nombre firma
cada movimiento en la auditoría, así que tiene que ser una persona real, no "admin".

Después, en **Ajustes › Usuarios**, se cargan los de tienda y taller.

---

## 5. El personal completa lo que falta

**Catálogo › Pendientes** es la lista de trabajo. Muestra cada artículo con lo que le
falta —peso, precio, material, categoría, foto, la medida sin interpretar— y cuáles no se
pueden vender hasta que se completen.

Los contadores de arriba sirven para repartir: "faltan 71 precios" es un trabajo, "falta
la foto de 300" es otro.

No hay que marcar nada como resuelto: **la fila desaparece sola** cuando el dato se carga.
La lista se calcula sobre el estado de hoy, no sobre lo que pasó en la importación.

---

## 6. El stock se cuenta, no se migra

Los saldos del sistema viejo ya están en conflicto consigo mismos (`BLX2`: 132 en una
tabla, 125 en la otra). Heredar eso sería arrancar el sistema nuevo con el error viejo
adentro.

En su lugar, la migración deja un **conteo de apertura por sede**, con una línea por
variante y el saldo viejo como referencia. El stock real empieza a existir cuando cada
tienda cuenta y cierra su conteo en **Inventario › Inventario físico**.

Es el único momento del proyecto en que conviene parar la venta unas horas.

---

## 7. Lo que queda para después del corte

- **Las fotos**: hoy entran como `pendiente/<archivo>.jpg` con la ruta vieja guardada en
  `legacy_path`. Subirlas y actualizar `url`.
- **El costo histórico**: 71 artículos traen el costo cifrado en la columna `CLAVE` del
  sistema viejo. Sin la tabla de equivalencias letra→dígito no hay costo real. Se puede
  arrancar sin él: el precio de venta no depende del costo salvo en las listas por margen.
- **Las fechas de cierre de las sedes**, que hoy quedan en `2024-01-01` como marcador.
- **El e-commerce**: hoy `minittasoft` lee del ERP viejo. Cuando el v2 sea la verdad, la
  tienda tiene que leer de acá.

---

## 8. Seguridad, en el otro repositorio

En `ppyecom/minittasoft`, las credenciales de este mismo SQL Server están **escritas en el
código**, en `backend/src/services/erp-sync.service.ts` (líneas 23-27): usuario,
contraseña, IP y base, en el repositorio y en su historial de git. Conviene moverlas a
`.env` y **rotar la contraseña**. Este proyecto no las hardcodea.

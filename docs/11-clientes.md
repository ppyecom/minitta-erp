# ERP v2 — El cliente como entidad

Hasta la migración `012`, el cliente no existía. Había **texto libre en tres lugares que no
se hablaban**:

| Dónde | Qué guardaba |
|---|---|
| `ops.custody_item` | `customer_name`, `customer_phone`, `customer_document` (texto) |
| `inventory.reservation` | `customer_name`, `customer_phone` (texto) |
| `inventory.reservation.customer_id` | un `bigint` con el comentario *"FK futura a `sales.customer`"*, apuntando a una tabla que no existía |

La señora que dejó un anillo en custodia, tiene un apartado y mañana compra eran **tres
registros sin ninguna relación**, cada uno con su propia versión del nombre. Nadie podía
responder "¿qué tiene esta persona con nosotros?" sin buscar a mano en tres pantallas y
confiar en que el nombre estuviera escrito igual las tres veces.

Esta migración (`013_customer.sql`) los junta en `core.customer` y **deja de guardar el
texto**.

---

## 1. Por qué en `core` y no en `sales`

El comentario de `005` decía `sales.customer`. Se cambió a propósito:

- El cliente lo necesitan **hoy** custodia y apartados, antes de que exista ventas. Si
  viviera en `sales`, el esquema `ops` dependería de un módulo que todavía no está, y el
  núcleo no puede depender de lo que se engancha después.
- `core.supplier` ya está ahí. El cliente es su simétrico: la otra punta del mostrador.

Cuando llegue ventas, `sales.invoice.customer_id` apunta acá y no hay nada que mover.

## 2. La decisión que importa: se normalizó, no se duplicó

Se podía dejar el texto como "foto del nombre al momento de recibir la pieza". Se eligió
**borrarlo**, y es la decisión central de esta etapa:

- Si el nombre está mal escrito, se corrige en la ficha del cliente y queda corregido en
  **toda su historia**: la custodia de hace dos años, el apartado de la semana pasada y la
  venta de mañana. Con la foto del nombre habría que corregir cada documento, y nadie lo
  haría.
- Dos fuentes de verdad para el mismo dato es exactamente lo que este ERP se rehízo para
  evitar (ver [docs/01](01-diagnostico-datos-legacy.md): el stock estaba en dos tablas que
  ya no coincidían).

Se pudo hacer sin riesgo porque la base estaba **vacía** (0 productos, 0 movimientos, 0
custodias): es preproducción. La migración igual trae el *backfill* —pasa el texto que
hubiera a clientes de verdad antes de exigir la FK— así que es correcta si se corre sobre
una base con datos; lo que no haya podido resolver va al cliente de vitrina en lugar de
quedar en `NULL`.

**`delivered_to` se quedó, y no es el cliente.** Es quién retiró físicamente la pieza en el
mostrador, que puede ser el marido, la hija o un cadete. Son dos datos distintos y por eso
uno es una FK y el otro sigue siendo texto.

## 3. El documento identifica, y sin documento no se deduplica

Documentos del Perú, con el formato validado en la base:

| Tipo | Formato |
|---|---|
| `dni` | 8 dígitos |
| `ruc` | 11 dígitos, y **obliga** a que el cliente sea `company` |
| `ce` | 8 a 12 alfanuméricos (carné de extranjería) |
| `passport` | 6 a 20 alfanuméricos |
| `none` | sin documento |

```sql
CREATE UNIQUE INDEX customer_document_once
  ON core.customer (document_type, document_number)
  WHERE document_type <> 'none';
```

El índice es **parcial** a propósito. `none` es el cliente de vitrina: compra un par de
aretes y se va, y no se le va a pedir el DNI. Si se lo forzara, alguien escribiría
`00000000` y arruinaría la deduplicación para todos. Dos señoras distintas sin documento
pueden llamarse igual, y mezclarlas sería peor que tenerlas separadas.

Validar el formato no es cosmético: **un DNI mal cargado es un cliente duplicado mañana**,
y el duplicado es justo lo que esta migración vino a eliminar.

Existe `CLI-000000`, *Cliente de vitrina*, para las operaciones sin cliente identificado:
así "no sé quién es" no obliga ni a inventar un cliente ni a dejar la referencia en `NULL`.

## 4. `core.v_customer_360`

La vista que justifica todo el trabajo: una fila por cliente con **todo lo que tiene con
nosotros**.

```sql
SELECT code, name, custody_open, layaway_active, layaway_paid, open_items
  FROM core.v_customer_360 WHERE document_number = '40123456';
```

`open_items` (custodias abiertas + apartados activos) es el dato operativo: si es mayor que
cero, **el cliente no se puede desactivar**, y eso lo impone un trigger. Tiene sentido —
hay una pieza suya en nuestra caja fuerte, o una nuestra reservada para él.

Es lo primero que se mira cuando alguien entra a la tienda, y por eso el listado ordena por
`open_items` antes que por nombre.

## 5. El cumpleaños

`birth_date`, con un índice por mes y día:

```sql
CREATE INDEX customer_birthday_idx
  ON core.customer (EXTRACT(MONTH FROM birth_date), EXTRACT(DAY FROM birth_date))
  WHERE birth_date IS NOT NULL AND is_active;
```

No es un adorno: en una joyería la mitad de las ventas son regalos, y saber que el
cumpleaños de la esposa de un cliente es la semana que viene es información que hoy vive en
la memoria de la vendedora. `GET /customers/birthdays?month=3` y la pantalla de clientes lo
muestra arriba.

## 6. Permisos

Dos permisos nuevos (ahora son 24 en total):

| Permiso | Quién lo tiene |
|---|---|
| `customers.read` | vendedor, taller, almacén, contabilidad, gerencia |
| `customers.write` | **vendedor**, gerencia |

Que el vendedor pueda **crear** un cliente es deliberado: atiende a alguien que nunca vino,
y si crear un cliente costara pedirle permiso a un supervisor, volveríamos al texto libre en
una semana. Por eso el selector de cliente de la interfaz crea uno sin salir del formulario
de custodia.

El taller sólo lee: necesita saber de quién es la pieza que tiene en el banco, no corregir
sus datos.

## 7. Qué se probó

`db/995_smoke_customer.sql` (corre con `-SmokeTest`, termina en `ROLLBACK`):

- el código se genera solo (`CLI-000001`)
- la misma persona en custodia **y** en un apartado es un solo cliente, y
  `v_customer_360` lo cuenta bien
- las cuatro vistas de `ops` que leían el nombre siguen mostrándolo, ahora desde
  `core.customer`
- se busca por nombre a medias, por teléfono y por mes de cumpleaños
- dos clientes sin documento con el mismo nombre conviven
- **7 reglas que deben rechazarse**: DNI duplicado, DNI de 7 dígitos, RUC en una persona,
  tipo de documento sin número, número sin tipo, nombre en blanco, y desactivar a un
  cliente con cosas abiertas

`npm run test:e2e` agrega 23 chequeos contra la API corriendo, incluido el que demuestra el
punto de todo esto: **se corrige el nombre del cliente una vez y la custodia ya lo muestra
corregido**. También que la validación de entrada corte antes de llegar a la base (un DNI de
7 dígitos da 400, no 500) y que el taller reciba 403 al intentar crear un cliente.

## 8. Lo que todavía falta

- **Deduplicar los que ya están.** Si dos fichas sin documento resultan ser la misma
  persona, hoy no hay una función para fusionarlas (mover custodias y apartados a una y
  desactivar la otra). Hace falta cuando se migre la cartera del ERP viejo.
- **Validar el dígito verificador** del RUC y consultar RENIEC/SUNAT para traer el nombre
  desde el documento. Hoy el nombre se escribe a mano.
- **Más de una dirección** por cliente (facturación vs. envío). Hoy hay una sola; cuando
  llegue e-commerce va a hacer falta.
- **La cartera del ERP viejo.** `legacy_code` ya está para cruzarla, pero el export todavía
  no se tocó: ver [docs/06](06-plan-de-migracion.md).
- **Consentimiento de datos personales.** Se guardan teléfono, correo, dirección y fecha de
  nacimiento. En Perú eso cae bajo la Ley 29733: falta decidir qué se le informa al cliente
  y guardar que lo aceptó.

# ERP v2 — Procesos: custodia, taller, consignación, apartados

Esquema `ops`, archivos [`db/009_ops_procesos.sql`](../db/009_ops_procesos.sql) (tablas y
reglas) y [`db/010_ops_logic.sql`](../db/010_ops_logic.sql) (funciones y vistas).

---

## 1. Por qué existe este esquema

El ERP viejo tenía **un solo circuito**: todo lo que entraba era stock. Cuando llegaba el
anillo de un cliente para soldar, o cuando salían diez piezas a una feria, el sistema no
tenía dónde ponerlo y la gente lo resolvía por fuera: un cuaderno, un WhatsApp, la memoria
de quien atendió. **Lo que se maneja por fuera del sistema es exactamente lo que se pierde.**

`ops` agrega los dos circuitos que faltaban:

| | Pieza nuestra | Pieza del cliente |
|---|---|---|
| Dónde vive | `catalog.variant` + `inventory.stock` | `ops.custody_item` |
| ¿Mueve stock? | sí | **nunca** |
| Cómo sale | con una orden (taller, consignación, exhibición) | con un evento de custodia |
| Cómo vuelve | pesada, con responsable | pesada, firmada por quien la retira |

La separación no es cosmética: `ops.custody_item` **no tiene `variant_id`**. Una pieza en
custodia no puede aparecer en `inventory.movement` porque no hay columna donde ponerla.
La regla la impone el modelo, no la disciplina del usuario.

---

## 2. La regla dura: los gramos cuadran

En una orden de taller:

```
gramos que entran = gramos que salen + merma declarada
```

Validado en `ops.close_work_order()`. Si no cuadra dentro de la tolerancia de balanza
(`ops.weight_tolerance_g()`, 0.05 g por defecto, configurable en `core.app_setting`), la
orden **no cierra** y el mensaje dice cuántos gramos faltan.

### Recuperado no es merma

Un recorte de aro que vuelve a la caja fuerte **cuadra el peso pero no es pérdida**:
`ops.work_order_loss.is_recovered = true`. El estándar de merma se mide solo contra lo que
realmente se perdió. Esto salió de la prueba: un ajuste de talla que devolvía el recorte
daba 6.3 % de merma y la orden no cerraba, cuando la pérdida real era 1.95 %.

```
code    | input_g | output_g | recovered_g | loss_g | diff_g | loss_pct | max_loss_pct
--------+---------+----------+-------------+--------+--------+----------+--------------
OT-0001 |  20.500 |   19.200 |       0.900 |  0.400 |  0.000 |    1.951 |        2.000
```

### El estándar de merma

`ops.loss_standard` fija cuánto se acepta por tipo de trabajo (fundición 5 %, talla 2 %,
grabado 0.3 %…). Por encima de eso, la orden exige que **un segundo usuario firme**
(`approved_by`). No bloquea el trabajo: obliga a que alguien se haga cargo.

---

## 3. Las tablas

| Tabla | Qué guarda |
|---|---|
| `ops.custody_item` | la pieza del cliente: quién la trajo, qué pidió, **cuánto pesaba**, en qué estado llegó, cuándo se prometió |
| `ops.custody_event` | la cadena de custodia, **append-only**: cada mano que tocó la pieza, con su peso en ese momento |
| `ops.work_order` | la orden de taller (propia o de cliente), su taller, su responsable, su fecha prometida |
| `ops.work_order_input` / `_output` | qué entró y qué salió, siempre con gramos |
| `ops.work_order_loss` | la merma, separando recuperado de perdido, con su aprobación |
| `ops.loss_standard` | cuánta merma se acepta sin firma |
| `ops.consignment` / `_line` / `_settlement` | el acuerdo con el tercero, qué tiene, y la liquidación con comisión |
| `ops.layaway_payment` | las cuotas de un apartado, **append-only** |

Más dos columnas en `inventory.transfer`: `due_back_on` y `responsible_user_id`, para que
una exhibición tenga fecha de retorno y alguien que responda por ella.

---

## 4. Las funciones

La aplicación **no inserta movimientos a mano** (CLAUDE.md §3). Para estos procesos:

| Función | Qué hace |
|---|---|
| `ops.move_custody(item, sede, user, tipo, peso, nota, orden)` | mueve la pieza del cliente y escribe el eslabón |
| `ops.deliver_custody(item, a_quién, peso, user)` | la entrega; registra la diferencia de peso si la hay |
| `ops.start_work_order(id, user)` | manda las piezas al taller (movimientos) y marca la custodia |
| `ops.close_work_order(id, user)` | **valida los gramos**, devuelve lo que salió, actualiza el peso real de la pieza |
| `ops.send_consignment(id, user)` | entrega la mercadería al tercero |
| `ops.report_consignment_sale(línea, cant, user)` | el tercero vendió; no puede vender lo que no tiene |
| `ops.return_consignment(línea, cant, user)` | devuelve lo no vendido a la sede |
| `ops.settle_consignment(id, desde, hasta, user)` | liquida el período con su comisión |
| `ops.register_layaway_payment(...)` | registra una cuota y devuelve el total pagado |
| `ops.expire_layaways()` | caduca los apartados vencidos y libera la pieza |

---

## 5. Las vistas de control

| Vista | Para qué |
|---|---|
| `ops.v_pieces_out` | **todo lo que ahora mismo no está en una sede**: custodia, taller, consignación, tránsito. Con días afuera y responsable |
| `ops.v_overdue` | lo que ya debería haber vuelto, apartados vencidos incluidos |
| `ops.v_work_order_balance` | el cuadre de gramos de cada orden |
| `ops.v_custody_ledger` | la cadena completa de una pieza, con la evolución del peso |
| `ops.v_layaway_balance` | cuánto pagó el cliente y cuánto falta |
| `ops.v_loss_summary` | cuánto oro se pierde por tipo de trabajo, contra el estándar |

`v_pieces_out` es la respuesta a la pregunta que el ERP viejo no podía contestar:
*¿dónde está todo?*

---

## 6. Qué verifica la prueba de humo

[`db/998_smoke_ops.sql`](../db/998_smoke_ops.sql), 8 casos. Los 7 últimos **deben ser
rechazados**:

```
RECHAZADO 1/7 cadena de custodia append-only
RECHAZADO 2/7 faltan gramos sin declarar
RECHAZADO 3/7 merma sobre el estándar sin aprobar
OK        la misma orden cierra una vez que la merma está aprobada
RECHAZADO 4/7 la pieza del cliente no se vuelve stock
RECHAZADO 5/7 el tercero vende más de lo que tiene
RECHAZADO 6/7 orden de taller en una tienda
RECHAZADO 7/7 entrega con orden de taller abierta
```

Termina en `ROLLBACK`: no deja datos. Corre junto con `999_smoke_test.sql` desde
`db/apply.sh --smoke-test` (o `apply.ps1 -SmokeTest`), que ahora aplica todos los `99*.sql`.

---

## 7. Lo que todavía falta

- ~~**El login**~~ **Hecho** (migración `012`, ver [docs/10](10-login-y-permisos.md)). El
  "quién" ya no es la cabecera `x-user-id` que cualquiera podía escribir: sale de la sesión
  autenticada. Esa discusión por gramos faltantes ahora se puede tener.
- ~~**Que la merma la firme otro**~~ **Hecho**, y de forma estructural: la restricción
  `wo_loss_approver_is_someone_else` impide aprobarse la propia merma desde cualquier lado,
  y hace falta el permiso `ops.loss.approve`, que `vendedor` y `taller` no tienen.
- **La firma del cliente en papel**. `delivered_to` guarda el nombre; falta adjuntar la
  foto de la boleta firmada.

---

## 8. La interfaz

| Pantalla | Ruta | Qué hace |
|---|---|---|
| Dónde está todo | `/procesos/afuera` | `v_pieces_out` con tarjetas por tipo y filtro de vencidos |
| Custodia | `/procesos/custodia` | recibir, mover y entregar piezas de clientes; el detalle muestra la cadena con el peso de cada paso |
| Taller | `/procesos/taller` | el detalle abre con el **cuadre de gramos**: entró, salió, recuperado, merma y el % contra el estándar |
| Consignaciones | `/procesos/consignaciones` | entregar, registrar ventas y devoluciones del tercero, liquidar con comisión |
| Apartados | `/procesos/apartados` | cuotas de cada apartado y liberación de los vencidos |

API en `apps/api/src/modules/ops/`: `ops.controller.ts` (transversales y apartados),
`custody.controller.ts`, `work-orders.controller.ts`, `consignments.controller.ts`.
Todas las escrituras llaman a las funciones del esquema, nunca a `inventory.movement`
directo.

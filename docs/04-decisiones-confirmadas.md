# ERP v2 — Decisiones confirmadas

## 1. SKU generado por el sistema ✔ confirmado

`sku` se genera como `{producto}-{talla}-{color}` (ej. `RIV-P2-16-CRI`), es editable, y
`legacy_code` (`ASD1`) queda visible en pantalla y buscable para que la gente de tienda
siga reconociendo sus códigos de siempre. Se puede buscar por cualquiera de los dos.

## 2. Listas de precio — sugerencia: 4, no 3

Las 3 del legacy (público, comerciante, mayorista) están bien, pero **falta una cuarta**:
el e-commerce. Hoy el Postgres del e-commerce tiene sus propios precios, separados del ERP
— eso ya es data escapándose. Mejor que sea una lista más del ERP y que la tienda online
lea de ahí.

| code | nombre | moneda | incluye IGV |
|---|---|---|---|
| `publico` | Precio público | PEN | sí |
| `comerciante` | Comerciante | PEN | sí |
| `mayorista` | Mayorista | PEN | sí |
| `ecommerce` | Tienda online | PEN | sí |

Y agregué algo que el legacy no puede hacer: **una lista puede estar restringida a ciertas
sedes** (`pricing.price_list_location`). Si Jockey Plaza vende más caro que el Centro, eso
hoy no se puede expresar sin duplicar artículos.

## 3. Precio fijo **y** calculado ✔ los dos

`pricing.price.mode` decide cómo se resuelve cada precio:

| mode | significado | qué se guarda |
|---|---|---|
| `manual` | lo escribe una persona | `amount` |
| `by_weight` | peso × precio del gramo + piedras + mano de obra | `amount` se recalcula |
| `by_margin` | costo × (1 + margen de la lista) | `amount` se recalcula |

La función `pricing.resolve_price(variant_id, price_list_id, fecha)` devuelve siempre el
precio efectivo, sin importar el modo. Los modos calculados guardan además `amount` como
caché con `recalculated_at`, para que un reporte histórico no cambie de cifra sola.

Esto cubre lo que ya pasa en tus datos: filas con `PREC_GR` lleno (oro al peso) y filas sin
él (fantasía a precio puesto) conviven sin pelearse.

## 4. Serializar — qué significa exactamente

**Serializar = darle a cada pieza física su propio registro e identidad**, en vez de contar
"tengo 3 de este modelo".

Hoy el sistema dice: *"del anillo `ASD1` hay 2 en la tienda 1"*. No sabe cuáles 2.

Con serialización dice: *"del anillo `RIV-P2-16-CRI` hay 2: la pieza `P-000418`, que pesa
4.12 g real y está en la vitrina de T-1, y la pieza `P-000419`, que pesa 3.98 g y está
prestada a Jockey Plaza para exhibición"*.

Para qué sirve en joyería concretamente:

- **Peso real por pieza.** Dos anillos del mismo modelo nunca pesan igual. El peso nominal
  es 4 g; el real es 4.12 y 3.98. Si vendes oro al peso, esa diferencia **es dinero**.
  Hoy se pierde: `PESO` es uno solo para el modelo.
- **Certificado de gema** pegado a la pieza, no al modelo.
- **Saber dónde está cada pieza.** Vitrina, caja fuerte, taller (en reparación), prestada a
  otra sede, en consignación. Hoy una pieza que se fue al taller sigue contada como stock.
- **Trazabilidad de la pieza cara.** Qué proveedor la trajo, a qué costo, cuándo se vendió
  y a quién. Con cantidades eso es imposible.
- **Etiqueta/QR por pieza**, que es lo que ya se hace a mano con el código escrito.

No todo se serializa. Por eso `variant.tracking_mode`:

| tracking_mode | para qué | ejemplo tuyo |
|---|---|---|
| `quantity` | artículos repetidos e intercambiables | `BLX1` llavero (160 unidades), estuches, bolsas |
| `serial` | pieza única o valiosa | anillos de oro con gema, `AWS27` corona de S/ 675 |

La regla la impone la base de datos: si `tracking_mode='serial'`, **todo movimiento tiene
que traer la pieza** (`serial_id`) y mover exactamente 1. No se puede equivocar.

## 5. Stock arranca con inventario físico por sede ✔ confirmado

No se migra el saldo actual (ya está en conflicto: `BLX1` dice 160 y 89 a la vez). Se abre
un `count_sheet` por sede, se cuenta, y al cerrarlo se generan los movimientos `opening`.
El kardex nace cuadrado y firmado por quien contó.

Mientras se cuenta, la sede puede seguir vendiendo: el conteo guarda `system_qty` al abrir,
así que la diferencia se calcula contra ese corte y no contra un saldo que se movió.

## 6. Sedes cerradas — qué quise decir

Tienes sedes que ya no operan: `T-2`, `T-3`, `A-5`, `A-9 (T2-Ex Stock)`, `A-20`, `A-3`.

Hay dos formas de tratarlas y la diferencia importa:

- **Borrarlas** → cuando después migres las ventas históricas, las ventas de T-2 quedan
  apuntando a una sede que no existe. Se rompe el reporte histórico. (Esto es exactamente
  lo que pasa hoy con `USUARIO_REGISTRO='DIANAM'`: la persona ya no está, el texto quedó
  huérfano y no se puede cruzar con nada.)
- **Migrarlas con `is_active=false`** → la sede existe en la base, el histórico cruza bien,
  pero **no aparece** en ningún combo ni se le puede cargar stock nuevo.

Propongo la segunda. Las 2 filas realmente vacías (`num_tienda` 20 y 21, sin nombre) sí se
descartan, porque no son sedes: son basura del legacy.

Además agregué `closed_at` para saber **cuándo** cerró cada una, que es un dato que hoy no
existe en ninguna parte.

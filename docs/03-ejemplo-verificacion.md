# ERP v2 — Verificación con datos reales

Prueba del modelo contra filas que existen hoy en `almacen_articulo`. Si el modelo no
puede representar estas 4 filas sin perder información, el modelo está mal.

---

## Caso 1 — `ASD1 … ASD6`: 6 artículos que son 1 producto

### Hoy (6 filas en `almacen_articulo`)

| CODIGO_ARTICULO | NOMBRE | MEDIDA | CODIGO_COLOR | PRECIO | STOCK |
|---|---|---|---|---|---|
| ASD1 | RivierP2_01 | 16 | 01 | 566 | 2 |
| ASD2 | RivierP2_01 | 15 | 01 | 566 | 1 |
| ASD3 | RivierP2_02 | 14 | 02 | 566 | 1 |
| ASD4 | RivierP2_01 | 17 | 01 | 566 | 1 |
| ASD5 | RivierP2_04 | 11 | 04 | 566 | 1 |
| ASD6 | RivierP2_01 | 14 | 01 | 566 | 1 |

Descripción repetida 6 veces: *"@cruzado aro con 20 pi 2.5 mm espesor 2mm, y aro pulido
2.5 mm espesor 1.5mm"*. El precio 566 está escrito 6 veces. Si sube, hay que editar 6 filas.

### En v2

**1 fila en `catalog.product`**

```
id=4001  code='RIV-P2'  name='Riviera cruzada P2'  kind='jewelry'
material_id=(ORO 18K)   nominal_weight_g=4.000     thickness_mm=2.00
long_desc='Aro cruzado con piedras de 2.5 mm, espesor 2 mm; aro pulido 2.5 mm, espesor 1.5 mm.'
status='active'  legacy_code='ASD'
```

**6 filas en `catalog.variant`** — y la talla por fin es un dato:

| id | sku | ring_size | legacy_code |
|---|---|---|---|
| 9001 | RIV-P2-11-CRI | 11.0 | ASD5 |
| 9002 | RIV-P2-14-CRI | 14.0 | ASD6 |
| 9003 | RIV-P2-14-RUB | 14.0 | ASD3 |
| 9004 | RIV-P2-15-CRI | 15.0 | ASD2 |
| 9005 | RIV-P2-16-CRI | 16.0 | ASD1 |
| 9006 | RIV-P2-17-CRI | 17.0 | ASD4 |

> Ojo: `ASD3` (color 02 = RUBI) y `ASD5` (color 04 = ZAFIRO AZUL) **sí** varían en color de
> piedra, pero el legacy les cambió el `NOMBRE` (`RivierP2_02`, `_04`) en vez de guardar el
> color como atributo. En v2 el nombre es del producto y el color es de la piedra.

**`catalog.variant_stone`** — acá entra lo que hoy vive en texto libre:

```
variant_id=9005  stone_id=(ZIRCON)  color_code='cristalino'
cut_code='redonda'  quantity=20  size_mm=2.50  is_center=false
```

Las 20 piedras ahora son contables: se puede valorizar el engaste, pedir reposición de
zircón de 2.5 mm, y saber cuántas piedras hay comprometidas en stock.

**`pricing.price`** — un precio, una vez, con vigencia:

```
price_list='publico'  variant_id=9005  amount=566.00  valid_from='2026-01-01'  valid_to=NULL
```

**`inventory.movement`** — el stock se explica:

```
variant_id=9005  location_id=1  type='opening'  quantity=+2  occurred_at='<corte migracion>'
```

→ `inventory.stock` queda en `on_hand=2` para la sede 1, **derivado**, no escrito a mano.

---

## Caso 2 — `BLX2` "Llavero Tumi": el stock que ya no cuadra

### Hoy

```
almacen_articulo.BLX2 → STOCK = 132
STOCKS (num_tienda=1, BLX2) → stock = 132
almacen_articulo.BLX1 → STOCK = 160
STOCKS (num_tienda=1, BLX1) → stock = 89      ← difieren en 71 unidades
```

Nadie puede decir si faltan 71 llaveros o si una de las dos tablas no se actualizó. **No hay
forma de averiguarlo**, porque no existe historia.

### En v2

El saldo sólo existe en un lugar y siempre es la suma de sus movimientos:

```sql
SELECT type, quantity, occurred_at, u.username
FROM inventory.movement m JOIN core.app_user u ON u.id = m.created_by
WHERE variant_id = (SELECT id FROM catalog.variant WHERE sku='LLAV-TUMI-6')
  AND location_id = 1
ORDER BY occurred_at;
```

```
opening   +160  2026-11-06  migracion
sale       -40  2026-11-10  spimentel
sale       -25  2026-11-14  yarely
count       -6  2026-11-30  spimentel   ← diferencia de inventario físico, con responsable
                                          ────
                                     on_hand = 89
```

Esa última línea es lo que hoy no existe: la diferencia de 71 queda **explicada y firmada**,
no silenciada.

---

## Caso 3 — `AWS25` "Coronas": datos basura detectados

### Hoy

```
PESO = 0.1        (una corona de fantasía de 45 cm de diámetro)
PRECIO = 1632     PRECIO_PRODUCTO = 960     PREC_GR = 9600
PORCENTAJE = 70   PORC_MAYOR = 120
```

Un peso de 0.1 g con precio por gramo de 9600 es imposible: ni los números cuadran entre sí
ni con el producto. Y el legacy lo acepta sin chistar.

### En v2

- `variant.weight_g` tiene `CHECK (weight_g > 0)` pero eso no detecta un 0.1 plausible-pero-falso.
- Por eso el **script de migración** marca la fila: el costeo (`metal_cost` desde
  `metal_rate × weight_g`) da un resultado absurdo frente al `PRECIO` registrado.
- La variante entra con `status='draft'` y aparece en el reporte de excepciones:

```
LLAM-ATENCION  AWS25  peso 0.1 g vs precio S/ 1632 → revisar peso real
LLAM-ATENCION  BWS1..BWS13  peso = 1.000 en las 13 filas → peso nominal no capturado
LLAM-ATENCION  BLX1   STOCK(160) != STOCKS(89) → definir saldo de arranque
```

No se inventa un peso. Se pesa la pieza y se corrige. Mientras tanto no se puede vender
porque está en `draft`.

---

## Caso 4 — `tiendas`: lo que es sede y lo que no

### Hoy (21 filas, todas con `anulada='Si'` salvo una)

| num_tienda | nombre | area | anulada |
|---|---|---|---|
| 4 | T | E | No |
| 1 | T-1 | V | Si |
| 8 | OFICINA | O | Si |
| 9 | AREA PRODUCION | P | Si |
| 13 | AREA COMPRAS | O | Si |
| 20 | *(vacío)* | | Si |

Imposible saber qué está abierto. `anulada='Si'` en la tienda 1, que es la que tiene stock
en `STOCKS`.

### En v2

| code | name | kind | sells | holds_stock | is_active |
|---|---|---|---|---|---|
| T-1 | Tienda 1 | store | ✓ | ✓ | ✓ |
| T-JOCKEY | Jockey Plaza | store | ✓ | ✓ | ✓ |
| OFI-T1 | Oficina T1 | office | — | — | ✓ |
| PROD | Área de producción | workshop | — | ✓ | ✓ |
| COMPRAS | Área de compras | purchasing | — | — | ✓ |

Las 2 filas vacías no se migran. El taller **sí** tiene stock (obra en proceso), la oficina
no. Eso hoy no se puede expresar.

---

## Preguntas abiertas para confirmar antes de escribir el DDL final

1. **¿`sku` lo genera el sistema o lo escribe la gente?** Propongo generado
   (`{producto}-{talla}-{color}`) con opción de editar, y el `legacy_code` siempre visible
   para que la gente de tienda siga reconociendo sus códigos viejos.
2. **¿Cuántas listas de precio hay realmente?** El legacy sugiere 3 (público, comerciante,
   mayor). ¿El e-commerce usa el precio público o tiene el suyo?
3. **¿El precio se fija a mano o se calcula desde el peso × precio del gramo?** Hay filas con
   `PREC_GR` y filas sin él — parece que conviven las dos formas. Eso cambia si `pricing.price`
   es dato o vista.
4. **¿Qué productos son piezas únicas?** Si las piezas de oro con gema se venden una por una,
   conviene serializarlas desde el día uno (`serial_item`) y no sólo contar cantidades.
5. **¿El stock arranca en cero y se carga por inventario físico, o se migra el saldo actual?**
   Recomiendo inventario físico por sede: es la única forma de que el kardex nazca cuadrado,
   y los datos actuales ya están en conflicto (caso 2).
6. **¿Las sedes cerradas se migran?** Propongo sí, con `is_active=false`, para no perder el
   histórico de movimientos cuando se migren las ventas.

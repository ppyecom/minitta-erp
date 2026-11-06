# ERP v2 — Cobertura de datos: nada se escapa

Dos listas. La primera verifica que **las 50 columnas** de `almacen_articulo` tengan
destino. La segunda es lo que hoy **no está en ninguna tabla** y pasa a tenerlo.

---

## A. `almacen_articulo` — las 50 columnas, una por una

| # | Columna legacy | Destino en v2 | Nota |
|---|---|---|---|
| 1 | `CODIGO_ARTICULO` | `catalog.variant.legacy_code` + `sku` nuevo | se conserva y queda buscable |
| 2 | `ID_TIPO` | — | siempre 1 en todo el export: sin información |
| 3 | `CODIGO` (material) | `catalog.material` **o** `product.kind` | 7 letras no eran material |
| 4 | `CODIGO_ALA` | `catalog.category` nivel 1 | `legacy_ala` guarda la letra |
| 5 | `CODIGO_CLA_ALHAJAS` | `catalog.category` nivel 2 | `legacy_cla` guarda la letra |
| 6 | `CODIGO_TIPO_PIEDRA` | `catalog.stone.origin` + `is_gem` | `legacy_tipo` guarda el número |
| 7 | `CODIGO_CLASE_PIEDRA` | `catalog.stone` | `legacy_clase` guarda el número |
| 8 | `CODIGO_COLOR` | `catalog.color` **o** `catalog.stone` | 4 códigos eran material, no color |
| 9 | `COD_PROVEEDOR` | `catalog.product.supplier_id` | vacío al 100%: queda NULL |
| 10 | `ID_COLOR_METAL` | `variant.metal_color` + `secondary_metal_color` | el `N+A+B` se descompone |
| 11 | `ID_TIPO_MONEDA` | `pricing.price_list.currency_code` | la moneda es de la lista |
| 12 | `NOMBRE` | `catalog.product.name` | agrupa variantes; el `@` inicial → `legacy_flags` |
| 13 | `DESCRIPCION` | `product.long_desc` + extracción | medidas, mm y nº de piedras salen a columnas |
| 14 | `IMAGEN` | `catalog.media` | ruta vieja en `media.legacy_path` |
| 15 | `PESO` | `variant.weight_g` / `product.nominal_weight_g` | unidad explícita en gramos |
| 16 | `MEDIDA` | `variant.size_value_id` (11–17) **o** `product.width_mm`/`height_mm` ("5.5*4") | se separan los dos usos |
| 17 | `PRECIO_PIEDRA` | `catalog.variant_stone.unit_cost` | 0 en todas las filas hoy |
| 18 | `PRECIO_PRODUCTO` | `pricing.variant_cost` | es costo, no precio |
| 19 | `PORCENTAJE_COMERCIANTE` | `pricing.price_rule.margin_pct` | regla, no columna por artículo |
| 20 | `PRECIO_COMERCIANTE` | `pricing.price` (lista `comerciante`) | |
| 21 | `PORC_MAYOR` | `pricing.price_rule.margin_pct` | |
| 22 | `PRECIO_MAYOR` | `pricing.price` (lista `mayorista`) | |
| 23 | `PORCENTEJE` *(sic)* | `pricing.price_list.default_margin_pct` | |
| 24 | `PRECIO` | `pricing.price` (lista `publico`) | |
| 25 | `PREC_GR` | `pricing.price.price_per_gram` + `pricing.metal_rate` | habilita `mode='by_weight'` |
| 26 | `CLAVE` (costo en letras) | `pricing.variant_cost` + `app_user.can_see_cost` | se descifra y se protege por rol |
| 27 | `STOCK` | `inventory.movement` tipo `opening` → `inventory.stock.on_hand` | derivado, nunca escrito |
| 28 | `STOCK_MINIMO` | `inventory.stock.min_quantity` | ahora **por sede** |
| 29 | `ACTIVO` (`'y'`) | `product.status` / `variant.status` | enum, no letra |
| 30 | `NUMERO` | — | consecutivo redundante con el código |
| 31 | `MONEDA` (texto `'Soles'`) | — | duplicado de `ID_TIPO_MONEDA` |
| 32 | `INICIAL` | `legacy_flags` | significado desconocido; se preserva por si acaso |
| 33 | `FECHA_INGRESO` | `product.launched_on` | fechas en 2026 van al reporte de excepciones |
| 34 | `ID` | `legacy_flags` | FK a una tabla que no vino en el export |
| 35 | `TIP_PIED` | `catalog.variant_stone` | vacío en todo el export |
| 36 | `MEDIDA_PIEDRA` | `variant_stone.size_mm` | vacío en todo el export |
| 37 | `PID_MED` | `legacy_flags` | vacío en todo el export |
| 38 | `DEJAR_USAR` | `product.status='discontinued'` | |
| 39 | `FAVORITO` | `catalog.product_tag` (tag `favorito`) | |
| 40 | `IND_PRODUCTO` | `legacy_flags` | 1/2 sin diccionario |
| 41 | `IND_ESTADO` | `variant.status` | |
| 42 | `IND_REGISTRO` | `legacy_flags` | |
| 43 | `PC_REGISTRO` | `core.audit_log.client_info` | |
| 44 | `USUARIO_REGISTRO` | `product.created_by` → `core.app_user` | texto libre pasa a FK real |
| 45 | `FECHA_REGISTRO` | `product.created_at` | `timestamptz` |
| 46 | `PC_MODIFICO` | `core.audit_log.client_info` | |
| 47 | `USUARIO_MODIFICO` | `core.audit_log.changed_by` | con historia completa |
| 48 | `FECHA_MODIFICO` | `core.audit_log.changed_at` | |
| 49 | `USUARIO_ANULACION` | `core.audit_log` (acción `update` a `archived`) | |
| 50 | `FECHA_ANULACION` | `core.audit_log.changed_at` | |

**Se descartan 4 columnas** (`ID_TIPO`, `NUMERO`, `MONEDA`, y la parte redundante de
`MEDIDA`), todas por ser duplicados o constantes. Las 6 de significado desconocido
(`INICIAL`, `ID`, `PID_MED`, `IND_PRODUCTO`, `IND_REGISTRO`, y el `@` del nombre) **no se
botan**: van completas a `product.legacy_flags` (jsonb), para poder recuperarlas si alguien
de la empresa recuerda qué significaban.

### Las otras tablas

| Tabla legacy | Destino |
|---|---|
| `material` (27) | `catalog.material` (20) + `product.kind` (7 que no eran material) |
| `tipo_alhajas` (26) | `catalog.category` nivel 1 |
| `clases_alhajas` (26) | `catalog.category` nivel 2 |
| `Tipo_piedra` (7) | `catalog.stone.origin` / `is_gem` |
| `clase_piedra` (47) | `catalog.stone` (46; la clase 19 "NINGUNO" no se migra) |
| `color_piedra` (45) | `catalog.color` (34) + `catalog.stone` (4 que eran material) + 7 combinaciones "CRISTAL-x" |
| `Color_metal_articulo` (19) | `catalog.metal_color` (7 atómicos); la fila `20,0,0,0` → NULL |
| `STOCKS` | `inventory.movement` (`opening`) → `inventory.stock` |
| `tiendas` (21) | `core.location` (20) + `core.app_setting`; 2 filas vacías descartadas |
| `TIPO_MONEDA` (3) | `core.currency` |

---

## B. Lo que hoy NO está en ninguna tabla

Esto es lo que se apunta en cuadernos, se recuerda de memoria o se deduce leyendo
descripciones. Cada fila ya tiene su lugar en el DDL.

| Dato que hoy se pierde | Dónde queda en v2 |
|---|---|
| **Peso real de cada pieza** (dos anillos del mismo modelo no pesan igual) | `inventory.serial_item.actual_weight_g` |
| **Dónde está físicamente cada pieza** (vitrina, taller, prestada) | `serial_item.status` + `location_id` |
| **Certificados de gema** (papeles en un cajón) | `inventory.certification` |
| **Cuántas piedras tiene la pieza** ("20 pi 2.5 mm" en el texto) | `variant_stone.quantity` + `size_mm` |
| **Forma y engaste de la piedra** | `catalog.stone_cut`, `catalog.setting_type` |
| **Piedra central vs. acompañantes** | `variant_stone.is_center` |
| **Quilates** | `variant_stone.carat_each` / `carat_total` |
| **Apartados de clientes** (el papelito en la vitrina) | `inventory.reservation` + `stock.reserved` |
| **Adelanto que dejó el cliente** | `reservation.deposit_amount` |
| **Mercadería en consignación** | `location.kind='consignment'` + `is_third_party` |
| **Piezas prestadas a otra sede para exhibición** | `movement.type='loan_out'` + `transfer.purpose='exhibition'` |
| **Piezas en el taller** (hoy siguen contadas como stock vendible) | `movement.type='production_out'` + `serial_status='in_workshop'` |
| **Merma, rotura, robo, fundición** | `movement.type='scrap'` + `movement_reason` |
| **Quién contó el inventario y qué encontró** | `count_sheet.counted_by` + `count_line` |
| **Precio del gramo del día** | `pricing.metal_rate` |
| **Tipo de cambio del día** | `pricing.exchange_rate` |
| **Mano de obra del taller** | `pricing.labor_rate` |
| **Costo desagregado** (metal / piedras / mano de obra / baño) | `pricing.variant_cost` |
| **Historia de precios** (hoy se sobrescribe) | `pricing.price.valid_from` / `valid_to` |
| **IGV y afectación SUNAT** | `core.tax_category` |
| **Código de barras y código de etiqueta** | `variant.barcode`, `variant.label_code` |
| **Varias fotos y video por producto** | `catalog.media` |
| **Que los aretes se venden por par** | `product.sale_unit_code='par'` |
| **Materiales secundarios** ("c/mostacilla", "alambre forrado", "sama plateado") | `catalog.product_material` |
| **Espesor del baño en micrones** | `product_material.thickness_micron` |
| **Acabado** ("todo pul", satinado, diamantado) | `catalog.finish` |
| **Tema y ocasión** (tumi, chavín, incaico, bodas de oro, logia) | `catalog.tag` |
| **Colección y temporada** | `catalog.collection` |
| **Género** (dama, varón, niño) | `product.gender` |
| **Componentes de un juego** | `catalog.variant_component` |
| **Qué modelo reemplaza a qué** | `catalog.product_relation` |
| **Grabado: fuente, técnica, texto grabado, costo** | `catalog.engraving_*` + `serial_item.engraving_text` |
| **Equivalencia de tallas** (aro peruano ↔ mm ↔ US) | `catalog.size_value` |
| **Garantía** | `product.warranty_months` |
| **Proveedor, costo de compra y plazo de entrega** | `core.supplier` + `movement.unit_cost` |
| **Responsable de cada sede** | `location.manager_user_id` |
| **Cuándo cerró cada sede** | `location.closed_at` |
| **Stock mínimo y máximo por sede** | `stock.min_quantity` / `max_quantity` |
| **Stock en tránsito entre sedes** | `stock.in_transit` |
| **Código de molde del taller** | atributo `molde_taller` |
| **Tiempo de producción** | atributo `tiempo_produccion` |
| **Cualquier dato nuevo que aparezca** | `catalog.attribute` + `attribute_option` (sin alterar tablas) |

---

## C. Lo que queda fuera de este alcance (a propósito)

Esto **no** está en el DDL porque pertenece a los módulos siguientes. Lo anoto para que
no se confunda con un olvido:

- **Ventas**: comprobantes, series, caja, formas de pago, facturación electrónica.
- **Compras**: órdenes de compra, recepciones, cuentas por pagar.
- **Clientes**: `reservation.customer_id` ya está reservado como FK futura.
- **Órdenes de taller**: el movimiento `production_out` deja la pieza en el taller, pero la
  orden de trabajo (quién la hace, qué se le pide, cuánto cobra) es su propio módulo.
- **Usuarios y permisos completos**: `core.app_user` tiene lo mínimo (`can_see_cost`) para
  que el costo no quede expuesto desde el día uno.

El punto es que el inventario y el catálogo **no van a necesitar cambios de esquema**
cuando esos módulos lleguen: `movement.doc_type` / `doc_id` ya los recibe sin tocar nada.

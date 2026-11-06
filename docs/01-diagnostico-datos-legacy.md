# ERP v2 — Diagnóstico del modelo legacy (productos, piedras, stock, sedes)

Fuente analizada: export CSV de la BD actual (SQL Server del "Sistema Minitta"):
`almacen-articulo`, `material`, `tipo_alhajas`, `clases_alhajas`, `Tipo_piedra`,
`clase_piedra`, `color_piedra`, `Color_metal_articulo`, `STOCKS`, `tiendas`, `TIPO_MONEDA`.

## 1. El problema de fondo

`almacen_articulo` es **una sola tabla que hace de producto, variante, ficha técnica,
lista de precios, costo, inventario, galería de imágenes y log de auditoría a la vez**.
Todo lo demás son tablas de códigos de 1 letra cuyo significado está incrustado en el
propio código del artículo.

El código `AKM1` no es un identificador: es un registro comprimido.

```
A    K    M    1
│    │    │    └── consecutivo dentro del grupo (= columna NUMERO, redundante)
│    │    └────── clase_alhajas  (M = "MATRIM/MARROQUIN/EMBUTID")
│    └─────────── tipo_alhajas   (K = "SOLAP.-PRENDED.")
└──────────────── material       (A = "FANTASIA")
```

Consecuencias reales que ya se ven en los datos:

- El espacio de códigos **ya se agotó**: `clases_alhajas` y `tipo_alhajas` usan la letra
  `Ñ` como código, y los nombres son 3–4 conceptos pegados con `/`
  (`"SRTA/ E.SANT/SOLOS/ESCA/SALA"`, `"ARO ESPEC/ACRIL/MEDIAN"`, `"CINTILL/XTO/CORB/CORRELOJ"`).
  Eso no es una taxonomía, es una lista de cajones llenos.
- Cambiar la categoría de un producto obliga a cambiarle el código → se rompe el histórico
  de ventas y de stock.
- No se puede tener un producto en dos categorías, ni una jerarquía de más de 3 niveles,
  ni filtrar por "anillos de plata con zircón" sin parsear strings.

## 2. Falta el nivel "variante" (el error más caro)

`ASD1 … ASD6` son **el mismo anillo** (`RivierP2_01`, misma descripción, mismo precio 566)
en tallas 16, 15, 14, 17, 11, 14. Hoy son 6 productos distintos, sin nada que los una.

Lo mismo ocurre con color de piedra: `ASD3` es `RivierP2_02` sólo porque cambia
`CODIGO_COLOR` de `01` a `02`.

Efecto: el catálogo está inflado, no hay forma de mostrar "este anillo en 6 tallas",
no se puede reponer por producto, y el reporte de ventas por modelo es imposible.

**Se necesita: `product` (el modelo) → `variant` (el SKU vendible: talla + color metal + color piedra).**

## 3. Taxonomías que mezclan dominios

| Tabla | Problema |
|---|---|
| `material` | Mezcla material real (ORO 18K, PLATA, BRONCE, ACERO) con **tipo de ítem** (ESTUCHES, SERV, REGALO, CATALOGO, HERRAMIENTAS DE ATENCION, COMERCIAL). El parche es la columna `IND_TIPO_VENTA`. |
| `clase_piedra` | Confunde tipo y clase: `ZIRCON` es tipo (5) **y** clase (15). `CRISTAL`, `VIDRIO`, `ACRILICO`, `DIAMANTE LABORATORIO` están bajo "PIEDRA ARTIFICIAL" pero son materiales distintos. |
| `color_piedra` | Mitad son colores (ROJO, VERDE, LAVANDA) y mitad son **materiales**: NACAR, CORAL, PERLA, OJO DE TIGRE, HEMATITE. Códigos texto inconsistentes: `01`, `010`, `0M`, `0N`. |
| `Color_metal_articulo` | La columna `codigo` (O/M/P) es en realidad el **material** (oro/plata), duplicando `material`. El color es un string concatenado `N+A+B+R` (negro+amarillo+blanco+rosa) → imposible de consultar. Y existe la fila basura `20, 0, 0, 0` que usan **todos** los artículos del export. |
| `tiendas` | Mezcla tienda de venta, oficina, área de producción, área de compras, área de distribución. Incluye 2 filas totalmente vacías (20 y 21) y columnas de configuración de la app (`XML1`, `XML2`, `VISOR`, `RUTA_INSTALACION`, `RUTA_PROF`, `SISTEMA`, `REPORTE`, `RECIBOS`, `ETIQUETA`). `anulada` es texto `"Si"/"No"` y está en `"Si"` en casi todas las filas activas → la semántica se perdió. |

Además hay **filas mágicas** para decir "nada": tipo piedra `4 = SIN PIEDRA`,
clase `19 = NINGUNO`, color `0N = NINGUNO`. Eso debería ser simplemente ausencia de fila.

## 4. Piedras: una sola, y aplastada en columnas

Hoy un artículo tiene exactamente **una** piedra, expresada en 6 columnas sueltas
(`CODIGO_TIPO_PIEDRA`, `CODIGO_CLASE_PIEDRA`, `CODIGO_COLOR`, `TIP_PIED`,
`MEDIDA_PIEDRA`, `PID_MED` — las tres últimas vacías en todo el export).

Pero la descripción real dice: *"@cruzado aro con 20 pi 2.5 mm espesor 2mm"*.
Son **20 piedras de 2.5 mm** — información que vive en texto libre, no en datos.

Falta por completo: cantidad de piedras, medida/mm, quilates, forma (redonda, princesa,
marquesa), tipo de engaste, calidad/claridad, y precio unitario de la piedra
(`PRECIO_PIEDRA` está en 0 en todas las filas).

## 5. Precios y costos sin estructura ni historia

Una sola fila lleva: `PRECIO_PRODUCTO`, `PORCENTAJE_COMERCIANTE`, `PRECIO_COMERCIANTE`,
`PORC_MAYOR`, `PRECIO_MAYOR`, `PORCENTEJE` (sic), `PRECIO`, `PREC_GR`, `PRECIO_PIEDRA`,
`CLAVE` (el costo **codificado en letras**: `N.YB`, `EDN.BB`, `HI.AB`), `MONEDA` (texto
`'Soles'`) **y** `ID_TIPO_MONEDA` (FK) — la moneda guardada dos veces.

Problemas:
- **Cero historial**: si sube el oro, se sobrescribe el precio y se pierde el anterior.
- Porcentajes y precios calculados conviven con el precio base → se desincronizan
  (hay filas con `PORCENTAJE_COMERCIANTE = 0` y `PRECIO_COMERCIANTE = 0` pero `PRECIO` lleno).
- El costo real no existe: no hay precio del gramo de metal por fecha, ni mano de obra,
  ni costo de piedras. `PREC_GR` está vacío en la mayoría.
- `TIPO_MONEDA` existe pero **no hay tabla de tipo de cambio** → nada se puede consolidar.
- La "clave" codificada es seguridad por oscuridad: debe ser un campo de costo normal con
  permisos por rol.

## 6. Stock sin kardex y duplicado

- `almacen_articulo.STOCK` y `STOCKS.stock` guardan lo mismo. En el export `almacen_articulo.STOCK`
  dice 0 para `BLX2` mientras `STOCKS` dice 132. **Ya están desincronizados.**
- `STOCKS.cantida` (sic) está vacía en todas las filas.
- **No hay tabla de movimientos.** Sin kardex no se puede responder "por qué hay 1 y no 2",
  ni hacer transferencias entre sedes, ni cuadrar un inventario físico, ni valorizar.
- `STOCKS.Estado = 'L'` sin diccionario; `ModificadoPorUsuario = 'sa'` (la cuenta admin de
  SQL Server, no una persona).
- En joyería muchas piezas son **únicas**; no hay forma de serializar una pieza
  (código de pieza, peso real, certificado).

## 7. Integridad, tipos y auditoría

- **Encoding roto**: `LAPIS?AZULI`, `NI?A`, `BA?O`, `DISE?O`, `D?LARES` — Windows-1252
  mal convertido. La v2 va en UTF-8 desde el día cero.
- **Fechas imposibles**: `FECHA_REGISTRO = 2026-09-28`, `2026-02-06` (reloj del servidor
  adelantado) y `FECHA_INGRESO` guardada como texto sin zona horaria.
- **Booleanos en 5 dialectos**: `ACTIVO = 'y'`, `DEJAR_USAR = 'N'`, `FAVORITO = 'N'`,
  `anulada = 'Si'`, `IND_ESTADO = 1`, `IND_REGISTRO = 1`, `IND_PRODUCTO = 2`,
  `nulo = 1` en `clase_piedra`. Ninguno documentado.
- **Auditoría ad-hoc y no confiable**: `PC_REGISTRO`, `USUARIO_REGISTRO` (texto libre:
  `DIANAM`, `GRECIA`, `SUSAN` — no FK a usuario), `USUARIO_MODIFICO`, `USUARIO_ANULACION`,
  `EstacionTrabajo`. Y registra sólo el último cambio, no la historia.
- **Imágenes como rutas locales**: `C:\Sistema Minitta\imagen\Escudoz.jpg`,
  `\\SERVERHP\Sistema Minitta\color metal\n.jpg`. Una sola imagen por artículo.
- **Unidades implícitas**: `PESO` sin unidad (y `BWS1…BWS13` todos con peso exactamente 1,
  y una corona de S/ 960 con peso 0.1 → datos basura). `MEDIDA` es numérico en unas filas
  y texto en otras (`"5.5*4"`, `"15x21"`), y mezcla **talla de aro** con **dimensiones físicas**.
- **Descripciones con comas y saltos de línea** sin escapar: el propio export tiene filas
  partidas en dos (`APM1`), y datos de medida metidos en la descripción.
- `COD_PROVEEDOR` existe y está **vacío en el 100%** de las filas → no hay trazabilidad de compra.

## 8. Lo que falta por completo

Código de barras / QR · unidad de medida · impuestos (IGV) y afectación SUNAT ·
colección y temporada · género · ciclo de vida (borrador / activo / descontinuado) ·
certificados de gema · personalización y grabado (ya existe `engraving-fonts` en el
backend, sin modelo en el ERP) · composición de kits y juegos · merma y reproceso de taller ·
múltiples imágenes y video · slug/SEO para el e-commerce · reserva de stock (carrito, apartado) ·
stock en tránsito entre sedes · stock mínimo **por sede** (hoy `STOCK_MINIMO = 1` global).

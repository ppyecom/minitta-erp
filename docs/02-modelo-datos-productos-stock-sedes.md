# ERP v2 — Modelo de datos: productos, variantes, piedras, stock y sedes

Alcance de este documento: **sólo** catálogo, atributos, piedras, precios/costos,
inventario y sedes. Ventas, compras, caja, clientes y taller vienen después y se
enganchan a este núcleo sin tocarlo.

Motor: **PostgreSQL 16**, UTF-8, `timestamptz` en todo, un esquema por dominio.

---

## 0. Principios de diseño (las reglas que no se rompen)

1. **El identificador no significa nada.** `id bigint` interno + `sku`/`code` público
   editable. El código inteligente (`AKM1`) se conserva sólo como `legacy_code` para migrar.
2. **Producto ≠ variante.** El precio y el stock viven en la variante; la ficha, categoría
   y fotos viven en el producto.
3. **Un dato, un lugar.** El stock no se guarda en dos tablas: se *deriva* de movimientos.
4. **Nada se sobrescribe.** Precios y costos tienen vigencia; el inventario es append-only.
5. **Sin filas mágicas.** "Sin piedra" = no hay filas en `product_stone`.
6. **Booleanos reales y enums declarados.** Nunca `'y'`, `'Si'`, `1/2`.
7. **Todo lo que es texto libre hoy y debería ser dato, se vuelve columna.**
8. **Auditoría genérica**, no columnas `PC_REGISTRO` repetidas en cada tabla.

---

## 1. Esquemas

```sql
CREATE SCHEMA core;      -- organización, sedes, usuarios, auditoría
CREATE SCHEMA catalog;   -- productos, variantes, atributos, piedras, media
CREATE SCHEMA pricing;   -- listas de precio, costos, metales, tipo de cambio
CREATE SCHEMA inventory; -- movimientos, saldos, series, inventarios físicos
```

---

## 2. `core` — sedes y referencias

Reemplaza `tiendas` separando **qué es el lugar** de **qué hace el lugar**.

```sql
CREATE TYPE core.location_kind AS ENUM
  ('store','warehouse','workshop','office','purchasing','distribution','virtual');

CREATE TABLE core.location (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code            text NOT NULL UNIQUE,              -- 'T-1', 'TJ1', 'ALM-CENTRAL'
  name            text NOT NULL,
  kind            core.location_kind NOT NULL,
  -- capacidades, en vez de inferirlas del 'area' V/O/P del legacy
  sells           boolean NOT NULL DEFAULT false,     -- puede facturar
  holds_stock     boolean NOT NULL DEFAULT true,      -- participa del inventario
  parent_id       bigint REFERENCES core.location(id),-- 'OFICINA en T1'
  address_line    text,
  district        text,
  city            text,
  phone           text,
  mobile          text,
  email           text,
  is_active       boolean NOT NULL DEFAULT true,
  opened_at       date,
  closed_at       date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

> Las columnas `XML1`, `VISOR`, `RUTA_INSTALACION`, `ETIQUETA`… **no van aquí**.
> Son configuración de la aplicación → `core.app_setting (location_id, key, value jsonb)`.

```sql
CREATE TABLE core.currency (
  code        char(3) PRIMARY KEY,        -- ISO: PEN, USD, EUR
  sunat_code  text,
  name        text NOT NULL,
  symbol      text NOT NULL,
  decimals    smallint NOT NULL DEFAULT 2
);

CREATE TABLE core.unit (                   -- faltaba por completo
  code  text PRIMARY KEY,                  -- 'g','ct','mm','und','par','cm'
  name  text NOT NULL,
  kind  text NOT NULL                      -- mass | length | count
);

CREATE TABLE core.app_user (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username   text NOT NULL UNIQUE,         -- reemplaza USUARIO_REGISTRO de texto libre
  full_name  text NOT NULL,
  email      text,
  is_active  boolean NOT NULL DEFAULT true
);
```

**Auditoría única para todo el ERP** (reemplaza las 8 columnas `*_REGISTRO` /
`*_MODIFICO` / `*_ANULACION` repetidas en cada tabla):

```sql
CREATE TABLE core.audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity      text   NOT NULL,             -- 'catalog.variant'
  entity_id   bigint NOT NULL,
  action      text   NOT NULL,             -- insert | update | delete
  changed_by  bigint REFERENCES core.app_user(id),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  diff        jsonb  NOT NULL              -- {campo: [antes, despues]}
);
CREATE INDEX ON core.audit_log (entity, entity_id, changed_at DESC);
```

---

## 3. `catalog` — taxonomía limpia

### 3.1 Categoría jerárquica (reemplaza `tipo_alhajas` + `clases_alhajas`)

Las dos tablas de letras se vuelven **un árbol** con niveles reales
(`Joyería > Anillos > Sortijas de dama`), sin tocar el código del producto.

```sql
CREATE TABLE catalog.category (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id  bigint REFERENCES catalog.category(id),
  slug       text NOT NULL UNIQUE,
  name       text NOT NULL,
  path       ltree NOT NULL,               -- 'joyeria.anillos.sortija_dama'
  sort_order int  NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true
);
CREATE INDEX ON catalog.category USING gist (path);
```

Un producto puede estar en varias categorías (una primaria):

```sql
CREATE TABLE catalog.product_category (
  product_id  bigint NOT NULL REFERENCES catalog.product(id) ON DELETE CASCADE,
  category_id bigint NOT NULL REFERENCES catalog.category(id),
  is_primary  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (product_id, category_id)
);
CREATE UNIQUE INDEX ON catalog.product_category (product_id) WHERE is_primary;
```

### 3.2 Material y metal (desenreda `material` + `Color_metal_articulo`)

```sql
CREATE TYPE catalog.material_family AS ENUM
  ('gold','silver','platinum','steel','bronze','copper','brass','nickel',
   'marble','costume','plated','other');

CREATE TABLE catalog.material (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text NOT NULL UNIQUE,      -- 'AU18','AU21','AG925','ACERO'
  name          text NOT NULL,             -- 'Oro 18K'
  family        catalog.material_family NOT NULL,
  purity_millis int,                       -- 750, 925, 585  (NULL si no aplica)
  density_g_cm3 numeric(6,3),
  is_precious   boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true
);

CREATE TABLE catalog.metal_color (          -- colores atómicos, no 'N+A+B+R'
  code  text PRIMARY KEY,                   -- 'amarillo','blanco','rosa','negro','plata'
  name  text NOT NULL,
  hex   char(7)
);
```

> Lo que hoy es `material = 'ESTUCHES' | 'SERV' | 'REGALO' | 'CATALOGO' | 'HERRAMIENTAS'`
> **no es material**: pasa a `product.kind`.

```sql
CREATE TYPE catalog.product_kind AS ENUM
  ('jewelry','handicraft','packaging','supply','service','gift','tool','marketing','other');
```

### 3.3 Piedras (reemplaza `Tipo_piedra` + `clase_piedra` + `color_piedra`)

Tres tablas con **una sola responsabilidad cada una**:

```sql
CREATE TYPE catalog.stone_origin AS ENUM ('natural','synthetic','lab_grown','imitation','organic');

CREATE TABLE catalog.stone (                -- la especie: Zafiro, Zircón, Nácar, Perla
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  origin      catalog.stone_origin NOT NULL,
  is_gem      boolean NOT NULL DEFAULT false,   -- gema fina vs. decorativa
  mohs_min    numeric(3,1),
  is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE catalog.stone_cut (             -- forma/talla: faltaba
  code text PRIMARY KEY,                     -- 'redonda','princesa','marquesa','cabujon','briolette'
  name text NOT NULL
);

CREATE TABLE catalog.color (                 -- SOLO color; nada de 'NACAR' ni 'PERLA'
  code text PRIMARY KEY,                     -- 'cristalino','rojo','verde','lavanda'
  name text NOT NULL,
  hex  char(7)
);
```

Lo que en `color_piedra` era material (NACAR, CORAL, PERLA, OJO DE TIGRE, HEMATITE)
migra a `catalog.stone`; lo que era color se queda en `catalog.color`.

### 3.4 Producto y variante

```sql
CREATE TYPE catalog.product_status AS ENUM ('draft','active','discontinued','archived');

CREATE TABLE catalog.product (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code           text NOT NULL UNIQUE,          -- código de modelo legible, editable
  slug           text NOT NULL UNIQUE,          -- para el e-commerce
  name           text NOT NULL,                 -- 'Riviera Cruzada'
  kind           catalog.product_kind NOT NULL,
  status         catalog.product_status NOT NULL DEFAULT 'draft',

  short_desc     text,
  long_desc      text,
  care_notes     text,

  material_id    bigint REFERENCES catalog.material(id),
  collection_id  bigint REFERENCES catalog.collection(id),
  gender         text CHECK (gender IN ('women','men','unisex','kids')),
  supplier_id    bigint REFERENCES core.supplier(id),

  -- ficha técnica, antes enterrada en la descripción
  nominal_weight_g numeric(10,3) CHECK (nominal_weight_g >= 0),
  width_mm         numeric(8,2),
  height_mm        numeric(8,2),
  depth_mm         numeric(8,2),
  thickness_mm     numeric(8,2),

  is_made_to_order boolean NOT NULL DEFAULT false,
  is_engravable    boolean NOT NULL DEFAULT false,   -- conecta con engraving-fonts
  is_unique_piece  boolean NOT NULL DEFAULT false,   -- obliga a serializar en inventario
  tax_category     text NOT NULL DEFAULT 'igv_18',

  specs          jsonb NOT NULL DEFAULT '{}',        -- atributos raros, sin ensuciar el esquema
  legacy_code    text,                               -- 'ASD' (raíz del código viejo)
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     bigint REFERENCES core.app_user(id)
);
```

La **variante es la unidad vendible y almacenable**. Es la que hoy falta y hace que
`ASD1…ASD6` sean 6 productos.

```sql
CREATE TABLE catalog.variant (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id      bigint NOT NULL REFERENCES catalog.product(id) ON DELETE RESTRICT,
  sku             text NOT NULL UNIQUE,
  barcode         text UNIQUE,                       -- EAN/UPC, faltaba

  -- los ejes de variación
  ring_size       numeric(4,1),                      -- talla de aro: 11, 14, 16.5
  size_label      text,                              -- 'S','M','45cm' para no-anillos
  metal_color     text REFERENCES catalog.metal_color(code),
  secondary_metal_color text REFERENCES catalog.metal_color(code),  -- bicolor explícito
  plating_material_id  bigint REFERENCES catalog.material(id),      -- baño/enchape

  weight_g        numeric(10,3) CHECK (weight_g > 0), -- peso real de ESTA variante
  length_cm       numeric(8,2),

  status          catalog.product_status NOT NULL DEFAULT 'active',
  is_default      boolean NOT NULL DEFAULT false,
  legacy_code     text UNIQUE,                        -- 'ASD1'  ← puente de migración
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON catalog.variant (product_id) WHERE is_default;
CREATE INDEX ON catalog.variant (product_id, status);
```

### 3.5 Piedras del producto: N:M con todo lo que falta

```sql
CREATE TABLE catalog.variant_stone (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id    bigint NOT NULL REFERENCES catalog.variant(id) ON DELETE CASCADE,
  stone_id      bigint NOT NULL REFERENCES catalog.stone(id),
  color_code    text REFERENCES catalog.color(code),
  cut_code      text REFERENCES catalog.stone_cut(code),

  quantity      int    NOT NULL DEFAULT 1 CHECK (quantity > 0),  -- "20 pi de 2.5mm"
  size_mm       numeric(6,2),
  carat_each    numeric(8,3),
  clarity       text,
  quality_grade text,
  setting_type  text,                       -- engaste: garra, carril, pavé, cerrado
  is_center     boolean NOT NULL DEFAULT false,
  unit_cost     numeric(12,4),
  cost_currency char(3) REFERENCES core.currency(code),
  notes         text
);
CREATE INDEX ON catalog.variant_stone (variant_id);
CREATE INDEX ON catalog.variant_stone (stone_id);
```

> Sin piedra = sin filas. Se eliminan `SIN PIEDRA / NINGUNO / 0N`.

### 3.6 Media, colecciones, kits, proveedor

```sql
CREATE TABLE catalog.media (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  bigint REFERENCES catalog.product(id) ON DELETE CASCADE,
  variant_id  bigint REFERENCES catalog.variant(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'image',   -- image | video | certificate | cad
  storage_key text NOT NULL,                   -- Cloudinary public_id, NO 'C:\...\x.jpg'
  url         text NOT NULL,
  alt_text    text,
  sort_order  int  NOT NULL DEFAULT 0,
  is_primary  boolean NOT NULL DEFAULT false,
  CHECK (product_id IS NOT NULL OR variant_id IS NOT NULL)
);

CREATE TABLE catalog.collection (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code      text NOT NULL UNIQUE,
  name      text NOT NULL,
  season    text,
  year      smallint,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE catalog.variant_component (        -- juegos y kits (arete + dije + cadena)
  parent_variant_id bigint NOT NULL REFERENCES catalog.variant(id) ON DELETE CASCADE,
  child_variant_id  bigint NOT NULL REFERENCES catalog.variant(id),
  quantity          numeric(10,3) NOT NULL DEFAULT 1,
  PRIMARY KEY (parent_variant_id, child_variant_id),
  CHECK (parent_variant_id <> child_variant_id)
);

CREATE TABLE core.supplier (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code       text NOT NULL UNIQUE,
  ruc        text,
  name       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true
);
```

---

## 4. `pricing` — precios con vigencia y costo real

### 4.1 Listas de precio por canal (reemplaza las 9 columnas de precio)

```sql
CREATE TABLE pricing.price_list (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text NOT NULL UNIQUE,     -- 'publico','comerciante','mayorista','ecommerce'
  name          text NOT NULL,
  currency_code char(3) NOT NULL REFERENCES core.currency(code),
  includes_tax  boolean NOT NULL DEFAULT true,
  is_active     boolean NOT NULL DEFAULT true
);

CREATE TABLE pricing.price (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  price_list_id bigint NOT NULL REFERENCES pricing.price_list(id),
  variant_id    bigint NOT NULL REFERENCES catalog.variant(id) ON DELETE CASCADE,
  amount        numeric(14,4) NOT NULL CHECK (amount >= 0),
  price_per_gram numeric(14,4),            -- el PREC_GR, pero opcional y explícito
  min_quantity  numeric(10,3) NOT NULL DEFAULT 1,
  valid_from    timestamptz NOT NULL DEFAULT now(),
  valid_to      timestamptz,               -- NULL = vigente
  created_by    bigint REFERENCES core.app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
-- un solo precio vigente por lista/variante/escala
CREATE UNIQUE INDEX ON pricing.price (price_list_id, variant_id, min_quantity)
  WHERE valid_to IS NULL;
CREATE INDEX ON pricing.price (variant_id, valid_from DESC);
```

Nada de `PORCENTAJE_*` guardado junto al resultado: el margen se **calcula** desde el costo,
o se define como regla en la lista de precios.

### 4.2 Costo (lo que el legacy esconde en `CLAVE`)

```sql
CREATE TABLE pricing.metal_rate (            -- precio del gramo por fecha: faltaba
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  material_id   bigint NOT NULL REFERENCES catalog.material(id),
  price_per_gram numeric(14,4) NOT NULL,
  currency_code char(3) NOT NULL REFERENCES core.currency(code),
  valid_from    date NOT NULL,
  UNIQUE (material_id, currency_code, valid_from)
);

CREATE TABLE pricing.exchange_rate (         -- faltaba; sin esto no se consolida nada
  currency_code char(3) NOT NULL REFERENCES core.currency(code),
  rate_date     date NOT NULL,
  buy           numeric(12,6) NOT NULL,
  sell          numeric(12,6) NOT NULL,
  PRIMARY KEY (currency_code, rate_date)
);

CREATE TABLE pricing.variant_cost (          -- costeo desagregado y con historia
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id     bigint NOT NULL REFERENCES catalog.variant(id) ON DELETE CASCADE,
  metal_cost     numeric(14,4) NOT NULL DEFAULT 0,
  stone_cost     numeric(14,4) NOT NULL DEFAULT 0,
  labor_cost     numeric(14,4) NOT NULL DEFAULT 0,
  plating_cost   numeric(14,4) NOT NULL DEFAULT 0,
  other_cost     numeric(14,4) NOT NULL DEFAULT 0,
  total_cost     numeric(14,4) GENERATED ALWAYS AS
                   (metal_cost+stone_cost+labor_cost+plating_cost+other_cost) STORED,
  currency_code  char(3) NOT NULL REFERENCES core.currency(code),
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_to       timestamptz,
  source         text NOT NULL DEFAULT 'manual'  -- manual | calculado | compra
);
CREATE UNIQUE INDEX ON pricing.variant_cost (variant_id) WHERE valid_to IS NULL;
```

El costo es una columna normal; se protege con **permisos por rol**, no codificándolo en letras.

---

## 5. `inventory` — kardex, saldos y piezas únicas

### 5.1 Movimientos: la única fuente de verdad (append-only)

```sql
CREATE TYPE inventory.movement_type AS ENUM
  ('opening','purchase','sale','sale_return','transfer_out','transfer_in',
   'adjustment','count','production_in','production_out','scrap','reservation_release');

CREATE TABLE inventory.movement (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id    bigint NOT NULL REFERENCES catalog.variant(id),
  location_id   bigint NOT NULL REFERENCES core.location(id),
  serial_id     bigint REFERENCES inventory.serial_item(id),
  type          inventory.movement_type NOT NULL,
  quantity      numeric(14,3) NOT NULL CHECK (quantity <> 0),  -- + entra, - sale
  unit_cost     numeric(14,4),
  currency_code char(3) REFERENCES core.currency(code),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  -- documento origen, sin FK rígida a módulos que aún no existen
  doc_type      text,                       -- 'sale','purchase','transfer','count'
  doc_id        bigint,
  transfer_id   bigint REFERENCES inventory.transfer(id),
  notes         text,
  created_by    bigint NOT NULL REFERENCES core.app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON inventory.movement (variant_id, location_id, occurred_at);
CREATE INDEX ON inventory.movement (doc_type, doc_id);
```

**Nunca se hace UPDATE ni DELETE** sobre esta tabla: un error se corrige con un
movimiento de ajuste. Eso es lo que hoy no existe y por lo que nadie puede explicar un saldo.

### 5.2 Saldo (caché derivado, no dato maestro)

```sql
CREATE TABLE inventory.stock (
  variant_id    bigint NOT NULL REFERENCES catalog.variant(id) ON DELETE CASCADE,
  location_id   bigint NOT NULL REFERENCES core.location(id),
  on_hand       numeric(14,3) NOT NULL DEFAULT 0,
  reserved      numeric(14,3) NOT NULL DEFAULT 0,   -- carrito / apartado
  in_transit    numeric(14,3) NOT NULL DEFAULT 0,
  available     numeric(14,3) GENERATED ALWAYS AS (on_hand - reserved) STORED,
  min_quantity  numeric(14,3) NOT NULL DEFAULT 0,   -- stock mínimo POR SEDE
  max_quantity  numeric(14,3),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (variant_id, location_id),
  CHECK (on_hand >= 0 AND reserved >= 0)
);
```

Lo mantiene un trigger `AFTER INSERT` sobre `inventory.movement`, y se puede
**reconstruir desde cero** en cualquier momento:

```sql
CREATE OR REPLACE VIEW inventory.stock_rebuild AS
SELECT variant_id, location_id, SUM(quantity) AS on_hand
FROM inventory.movement GROUP BY 1,2;
```

### 5.3 Piezas únicas (joyería real)

```sql
CREATE TYPE inventory.serial_status AS ENUM
  ('in_stock','reserved','sold','in_workshop','in_transit','lost','scrapped');

CREATE TABLE inventory.serial_item (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id    bigint NOT NULL REFERENCES catalog.variant(id),
  serial_code   text NOT NULL UNIQUE,       -- etiqueta física / QR de la pieza
  location_id   bigint REFERENCES core.location(id),
  status        inventory.serial_status NOT NULL DEFAULT 'in_stock',
  actual_weight_g numeric(10,3),            -- peso real pesado, no el nominal
  acquisition_cost numeric(14,4),
  certificate_no  text,
  certificate_media_id bigint REFERENCES catalog.media(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

### 5.4 Transferencias entre sedes e inventario físico

```sql
CREATE TYPE inventory.transfer_status AS ENUM ('draft','sent','received','cancelled');

CREATE TABLE inventory.transfer (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  from_location_id bigint NOT NULL REFERENCES core.location(id),
  to_location_id   bigint NOT NULL REFERENCES core.location(id),
  status          inventory.transfer_status NOT NULL DEFAULT 'draft',
  sent_at         timestamptz,
  received_at     timestamptz,
  sent_by         bigint REFERENCES core.app_user(id),
  received_by     bigint REFERENCES core.app_user(id),
  CHECK (from_location_id <> to_location_id)
);

CREATE TABLE inventory.transfer_line (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transfer_id  bigint NOT NULL REFERENCES inventory.transfer(id) ON DELETE CASCADE,
  variant_id   bigint NOT NULL REFERENCES catalog.variant(id),
  serial_id    bigint REFERENCES inventory.serial_item(id),
  quantity_sent     numeric(14,3) NOT NULL CHECK (quantity_sent > 0),
  quantity_received numeric(14,3)
);

CREATE TABLE inventory.count_sheet (          -- toma de inventario
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id bigint NOT NULL REFERENCES core.location(id),
  status      text NOT NULL DEFAULT 'open',   -- open | closed | applied
  started_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz,
  created_by  bigint REFERENCES core.app_user(id)
);

CREATE TABLE inventory.count_line (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  count_sheet_id bigint NOT NULL REFERENCES inventory.count_sheet(id) ON DELETE CASCADE,
  variant_id     bigint NOT NULL REFERENCES catalog.variant(id),
  system_qty     numeric(14,3) NOT NULL,     -- foto del saldo al abrir
  counted_qty    numeric(14,3),
  difference     numeric(14,3) GENERATED ALWAYS AS (counted_qty - system_qty) STORED,
  UNIQUE (count_sheet_id, variant_id)
);
```

Al cerrar una toma, cada diferencia genera un `movement` de tipo `count`. **Nunca** se
edita el saldo a mano.

---

## 6. Mapeo legacy → v2 (guía de migración)

| Legacy | v2 |
|---|---|
| `almacen_articulo.CODIGO_ARTICULO` | `catalog.variant.legacy_code` (+ `sku` nuevo) |
| `CODIGO` (material, 1 letra) | `catalog.material` **o** `product.kind` según la fila |
| `CODIGO_ALA` + `CODIGO_CLA_ALHAJAS` | `catalog.category` (árbol) |
| `NOMBRE` | `product.name` (agrupa las variantes: `RivierP2_01` → 1 producto) |
| `DESCRIPCION` | `product.long_desc` + se **extraen** medidas, mm y nº de piedras a columnas |
| `MEDIDA` numérica (11–17) | `variant.ring_size` |
| `MEDIDA` texto (`"5.5*4"`, `"15x21"`) | `product.width_mm` / `height_mm` |
| `PESO` | `variant.weight_g` (unidad explícita) |
| `ID_COLOR_METAL` (`N+A+B`) | `variant.metal_color` + `secondary_metal_color` |
| `CODIGO_TIPO_PIEDRA` / `CODIGO_CLASE_PIEDRA` | `catalog.stone` (una tabla, con `origin`) |
| `CODIGO_COLOR` | `catalog.color` **o** `catalog.stone` (los que eran material) |
| `PRECIO`, `PRECIO_COMERCIANTE`, `PRECIO_MAYOR` | 3 filas en `pricing.price` (3 listas) |
| `PORCENTAJE*`, `CLAVE`, `PREC_GR` | `pricing.variant_cost` + regla de margen |
| `MONEDA` (texto) + `ID_TIPO_MONEDA` | `core.currency.code` (una sola vez) |
| `STOCK`, `STOCKS.stock` | `inventory.stock.on_hand`, derivado de `movement` (`opening`) |
| `STOCK_MINIMO` | `inventory.stock.min_quantity` (por sede) |
| `IMAGEN` (ruta local) | `catalog.media` (Cloudinary) |
| `ACTIVO='y'`, `DEJAR_USAR`, `IND_ESTADO` | `product.status` / `variant.status` / `is_active` |
| `USUARIO_REGISTRO`, `PC_REGISTRO`, `FECHA_MODIFICO` | `core.audit_log` + `created_by` |
| `tiendas` (21 filas mezcladas) | `core.location` con `kind` + `sells` + `holds_stock` |
| `tiendas.XML1/VISOR/RUTA_*` | `core.app_setting` |
| `NUMERO`, `INICIAL`, `ID`, `TIP_PIED`, `PID_MED`, `FAVORITO` | **se descartan** |

### Reglas de deduplicación al migrar

1. Agrupar variantes por `(CODIGO[1], CODIGO_ALA, CODIGO_CLA_ALHAJAS, NOMBRE_normalizado)`
   → un `product`.
2. Cada `CODIGO_ARTICULO` del grupo → un `variant`, con `ring_size` desde `MEDIDA`.
3. `STOCK` inicial → un `movement` de tipo `opening` fechado al corte de migración,
   con `created_by` = usuario de migración. Así el kardex arranca cuadrado.
4. Filas con datos imposibles (peso 0.1 en una corona de S/ 960, `BWS*` todos con peso 1,
   fechas en 2026) se migran con `status='draft'` y se marcan en un reporte de excepciones
   para revisión manual. **No se inventan valores.**
5. `color_metal` id 20 (la fila `0,0,0`) → `NULL`, no se migra.

---

## 7. Orden de implementación sugerido

1. `core`: currency, unit, app_user, location, supplier, audit_log.
2. `catalog` taxonomía: category, material, metal_color, stone, stone_cut, color, collection.
3. `catalog` núcleo: product, variant, product_category, variant_stone, media.
4. Script de migración + **reporte de excepciones** (sin tocar la BD vieja, sólo leer).
5. `pricing`: price_list, price, metal_rate, exchange_rate, variant_cost.
6. `inventory`: movement, stock + trigger, serial_item, transfer, count_sheet.
7. ABM de productos/variantes y de sedes en el frontend; recién después ventas y compras.

El paso 4 es el que decide si el proyecto sale bien: conviene correrlo **muchas veces en
seco** sobre una copia, revisar el reporte de excepciones con la gente de tienda, y sólo
después cargar en producción.

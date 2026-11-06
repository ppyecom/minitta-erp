-- =============================================================================
-- ERP v2 — 003 catalog (núcleo): producto, variante, piedras, media, componentes
-- =============================================================================

CREATE TYPE catalog.product_kind AS ENUM (
  'jewelry',      -- joyería (oro, plata, acero)
  'handicraft',   -- artesanía, platos, campanas, cuadros
  'packaging',    -- estuches, bolsas, cajas
  'supply',       -- herramientas, útiles de oficina, insumos
  'service',      -- grabado, reparación, "venta con tarjeta"
  'gift',         -- regalo / promocional
  'marketing',    -- catálogo, exhibición, material publicitario
  'other'
);

CREATE TYPE catalog.product_status AS ENUM ('draft','active','discontinued','archived');
CREATE TYPE catalog.gender AS ENUM ('women','men','unisex','kids','baby');

-- cómo se controla el stock de la variante: por cantidad o pieza por pieza
CREATE TYPE catalog.tracking_mode AS ENUM ('quantity','serial');

-- -----------------------------------------------------------------------------
-- producto = el modelo
-- -----------------------------------------------------------------------------
CREATE TABLE catalog.product (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text NOT NULL UNIQUE,                -- 'RIV-P2'  (legible, editable)
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  kind          catalog.product_kind NOT NULL DEFAULT 'jewelry',
  status        catalog.product_status NOT NULL DEFAULT 'draft',

  short_desc    text,
  long_desc     text,
  care_notes    text,                                -- cuidado de la pieza
  internal_notes text,                               -- lo que hoy se apunta en el cuaderno

  -- composición
  material_id   bigint REFERENCES catalog.material(id),
  finish_code   text REFERENCES catalog.finish(code),
  collection_id bigint REFERENCES catalog.collection(id),
  supplier_id   bigint REFERENCES core.supplier(id),
  gender        catalog.gender,

  -- ficha técnica: hoy enterrada en DESCRIPCION ("alt 6.4cm", "19*19cm", "45 diametro")
  nominal_weight_g numeric(12,3) CHECK (nominal_weight_g >= 0),
  width_mm      numeric(10,2) CHECK (width_mm > 0),
  height_mm     numeric(10,2) CHECK (height_mm > 0),
  depth_mm      numeric(10,2) CHECK (depth_mm > 0),
  diameter_mm   numeric(10,2) CHECK (diameter_mm > 0),
  thickness_mm  numeric(10,2) CHECK (thickness_mm > 0),

  -- en qué escala se tallan sus variantes (NULL = no se talla)
  size_scale_id bigint REFERENCES catalog.size_scale(id),

  -- comportamiento
  is_made_to_order boolean NOT NULL DEFAULT false,
  is_engravable    boolean NOT NULL DEFAULT false,
  is_repairable    boolean NOT NULL DEFAULT true,
  default_tracking_mode catalog.tracking_mode NOT NULL DEFAULT 'quantity',
  tax_category_code text NOT NULL DEFAULT 'igv_18' REFERENCES core.tax_category(code),
  sale_unit_code    text NOT NULL DEFAULT 'und' REFERENCES core.unit(code),
  -- aretes: se venden por par, no por unidad. El legacy no lo distingue.
  units_per_sale_unit numeric(10,3) NOT NULL DEFAULT 1 CHECK (units_per_sale_unit > 0),

  warranty_months int CHECK (warranty_months >= 0),
  launched_on     date,
  discontinued_on date,

  specs         jsonb NOT NULL DEFAULT '{}',         -- atributos sueltos no modelados
  legacy_code   text,                                -- raíz del código viejo: 'ASD'
  legacy_flags  jsonb NOT NULL DEFAULT '{}',         -- DEJAR_USAR, FAVORITO, IND_*, '@' del nombre

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    bigint REFERENCES core.app_user(id),

  CONSTRAINT product_discontinued_dates CHECK (
    discontinued_on IS NULL OR launched_on IS NULL OR discontinued_on >= launched_on),
  CONSTRAINT product_discontinued_status CHECK (
    discontinued_on IS NULL OR status IN ('discontinued','archived'))
);
CREATE INDEX product_status_idx   ON catalog.product (status, kind);
CREATE INDEX product_material_idx ON catalog.product (material_id);
CREATE INDEX product_legacy_idx   ON catalog.product (legacy_code);
CREATE INDEX product_name_trgm    ON catalog.product USING gin (name gin_trgm_ops);
CREATE TRIGGER trg_product_touch BEFORE UPDATE ON catalog.product
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER trg_product_audit AFTER INSERT OR UPDATE OR DELETE ON catalog.product
  FOR EACH ROW EXECUTE FUNCTION core.audit_row();

-- categorías del producto (varias, una primaria)
CREATE TABLE catalog.product_category (
  product_id  bigint NOT NULL REFERENCES catalog.product(id) ON DELETE CASCADE,
  category_id bigint NOT NULL REFERENCES catalog.category(id) ON DELETE RESTRICT,
  is_primary  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (product_id, category_id)
);
CREATE UNIQUE INDEX product_one_primary_category
  ON catalog.product_category (product_id) WHERE is_primary;
CREATE INDEX product_category_cat_idx ON catalog.product_category (category_id);

CREATE TABLE catalog.product_tag (
  product_id bigint NOT NULL REFERENCES catalog.product(id) ON DELETE CASCADE,
  tag_id     bigint NOT NULL REFERENCES catalog.tag(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, tag_id)
);

-- materiales secundarios: "c/mostacilla", "alambre forrado", "sama plateado",
-- "enchapado en plata" — hoy todo en texto libre
CREATE TABLE catalog.product_material (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  bigint NOT NULL REFERENCES catalog.product(id) ON DELETE CASCADE,
  material_id bigint NOT NULL REFERENCES catalog.material(id),
  role        text NOT NULL DEFAULT 'secondary'
                CHECK (role IN ('primary','secondary','plating','accent','component')),
  weight_g    numeric(12,3) CHECK (weight_g >= 0),
  thickness_micron numeric(8,2) CHECK (thickness_micron > 0),   -- espesor del baño
  notes       text,
  UNIQUE (product_id, material_id, role)
);

-- relaciones entre modelos: "este reemplaza al otro", "va con", "se parece a"
CREATE TYPE catalog.product_relation_kind AS ENUM ('replaces','variant_of','goes_with','similar','upsell');

CREATE TABLE catalog.product_relation (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  bigint NOT NULL REFERENCES catalog.product(id) ON DELETE CASCADE,
  related_id  bigint NOT NULL REFERENCES catalog.product(id) ON DELETE CASCADE,
  kind        catalog.product_relation_kind NOT NULL,
  UNIQUE (product_id, related_id, kind),
  CONSTRAINT product_relation_not_self CHECK (product_id <> related_id)
);

-- valores de atributos extensibles
CREATE TABLE catalog.product_attribute_value (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id   bigint NOT NULL REFERENCES catalog.product(id) ON DELETE CASCADE,
  attribute_id bigint NOT NULL REFERENCES catalog.attribute(id) ON DELETE RESTRICT,
  value_text   text,
  value_number numeric(18,6),
  value_bool   boolean,
  value_date   date,
  option_id    bigint REFERENCES catalog.attribute_option(id),
  UNIQUE (product_id, attribute_id),
  CONSTRAINT product_attr_one_value CHECK (
    (value_text IS NOT NULL)::int + (value_number IS NOT NULL)::int +
    (value_bool IS NOT NULL)::int + (value_date IS NOT NULL)::int +
    (option_id IS NOT NULL)::int = 1)
);

-- grabado habilitado por producto
CREATE TABLE catalog.product_engraving_option (
  product_id          bigint NOT NULL REFERENCES catalog.product(id) ON DELETE CASCADE,
  engraving_option_id bigint NOT NULL REFERENCES catalog.engraving_option(id),
  max_chars           int CHECK (max_chars > 0),
  extra_cost          numeric(14,4) CHECK (extra_cost >= 0),
  PRIMARY KEY (product_id, engraving_option_id)
);

-- -----------------------------------------------------------------------------
-- variante = la unidad vendible y almacenable  (lo que falta hoy)
-- -----------------------------------------------------------------------------
CREATE TABLE catalog.variant (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id    bigint NOT NULL REFERENCES catalog.product(id) ON DELETE RESTRICT,
  sku           text NOT NULL UNIQUE,                -- 'RIV-P2-16-CRI' (generado, editable)
  barcode       text UNIQUE,                         -- EAN/UPC
  label_code    text,                                -- lo que se imprime en la etiqueta física

  -- ejes de variación
  size_value_id bigint REFERENCES catalog.size_value(id),
  size_label    text,                                -- 'S','45cm' cuando no hay escala
  metal_color   text REFERENCES catalog.metal_color(code),
  secondary_metal_color text REFERENCES catalog.metal_color(code),
  plating_material_id   bigint REFERENCES catalog.material(id),
  finish_code   text REFERENCES catalog.finish(code),
  -- el color de la piedra principal TAMBIÉN es un eje de variación: el mismo
  -- anillo talla 14 en rubí y en cristalino son dos SKU distintos. El detalle
  -- completo de las piedras vive en catalog.variant_stone; esto es el eje.
  stone_color   text REFERENCES catalog.color(code),

  -- medidas propias de esta variante (anulan las del producto si están)
  weight_g      numeric(12,3) CHECK (weight_g > 0),
  length_cm     numeric(10,2) CHECK (length_cm > 0),

  tracking_mode catalog.tracking_mode NOT NULL DEFAULT 'quantity',
  status        catalog.product_status NOT NULL DEFAULT 'active',
  is_default    boolean NOT NULL DEFAULT false,

  legacy_code   text UNIQUE,                         -- 'ASD1'  ← puente de migración
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    bigint REFERENCES core.app_user(id),

  CONSTRAINT variant_colors_differ CHECK (
    secondary_metal_color IS NULL OR secondary_metal_color <> metal_color)
);
CREATE UNIQUE INDEX variant_one_default ON catalog.variant (product_id) WHERE is_default;
CREATE INDEX variant_product_idx ON catalog.variant (product_id, status);
CREATE INDEX variant_sku_trgm    ON catalog.variant USING gin (sku gin_trgm_ops);
CREATE INDEX variant_legacy_idx  ON catalog.variant (legacy_code);
CREATE TRIGGER trg_variant_touch BEFORE UPDATE ON catalog.variant
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER trg_variant_audit AFTER INSERT OR UPDATE OR DELETE ON catalog.variant
  FOR EACH ROW EXECUTE FUNCTION core.audit_row();

-- una variante no puede tener dos veces la misma combinación talla+color
CREATE UNIQUE INDEX variant_unique_combo ON catalog.variant
  (product_id,
   COALESCE(size_value_id, -1),
   COALESCE(size_label, ''),
   COALESCE(metal_color, ''),
   COALESCE(stone_color, ''),
   COALESCE(finish_code, ''));

CREATE TABLE catalog.variant_attribute_value (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id   bigint NOT NULL REFERENCES catalog.variant(id) ON DELETE CASCADE,
  attribute_id bigint NOT NULL REFERENCES catalog.attribute(id) ON DELETE RESTRICT,
  value_text   text,
  value_number numeric(18,6),
  value_bool   boolean,
  value_date   date,
  option_id    bigint REFERENCES catalog.attribute_option(id),
  UNIQUE (variant_id, attribute_id),
  CONSTRAINT variant_attr_one_value CHECK (
    (value_text IS NOT NULL)::int + (value_number IS NOT NULL)::int +
    (value_bool IS NOT NULL)::int + (value_date IS NOT NULL)::int +
    (option_id IS NOT NULL)::int = 1)
);

-- -----------------------------------------------------------------------------
-- piedras de la variante: N:M con cantidad, medida, quilates, engaste
-- "@cruzado aro con 20 pi 2.5 mm" deja de ser texto y pasa a ser dato
-- -----------------------------------------------------------------------------
CREATE TABLE catalog.variant_stone (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id     bigint NOT NULL REFERENCES catalog.variant(id) ON DELETE CASCADE,
  stone_id       bigint NOT NULL REFERENCES catalog.stone(id) ON DELETE RESTRICT,
  color_code     text REFERENCES catalog.color(code),
  cut_code       text REFERENCES catalog.stone_cut(code),
  setting_code   text REFERENCES catalog.setting_type(code),

  quantity       int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  size_mm        numeric(8,2) CHECK (size_mm > 0),
  width_mm       numeric(8,2) CHECK (width_mm > 0),
  carat_each     numeric(10,3) CHECK (carat_each > 0),
  carat_total    numeric(12,3) GENERATED ALWAYS AS (carat_each * quantity) STORED,

  clarity        text,                               -- VS1, SI2...
  quality_grade  text,                               -- AAA, AA, A
  is_center      boolean NOT NULL DEFAULT false,     -- piedra central vs. acompañantes

  unit_cost      numeric(14,4) CHECK (unit_cost >= 0),
  cost_currency  char(3) REFERENCES core.currency(code),
  notes          text,

  CONSTRAINT variant_stone_cost_currency CHECK (
    (unit_cost IS NULL) = (cost_currency IS NULL))
);
CREATE INDEX variant_stone_variant_idx ON catalog.variant_stone (variant_id);
CREATE INDEX variant_stone_stone_idx   ON catalog.variant_stone (stone_id);
-- una sola piedra central por variante
CREATE UNIQUE INDEX variant_stone_one_center
  ON catalog.variant_stone (variant_id) WHERE is_center;

-- -----------------------------------------------------------------------------
-- juegos y kits: "juego de arete + dije + cadena"
-- -----------------------------------------------------------------------------
CREATE TABLE catalog.variant_component (
  parent_variant_id bigint NOT NULL REFERENCES catalog.variant(id) ON DELETE CASCADE,
  child_variant_id  bigint NOT NULL REFERENCES catalog.variant(id) ON DELETE RESTRICT,
  quantity          numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  is_optional       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (parent_variant_id, child_variant_id),
  CONSTRAINT variant_component_not_self CHECK (parent_variant_id <> child_variant_id)
);

-- -----------------------------------------------------------------------------
-- media: reemplaza IMAGEN con ruta local 'C:\Sistema Minitta\imagen\x.jpg'
-- -----------------------------------------------------------------------------
CREATE TYPE catalog.media_kind AS ENUM ('image','video','certificate','cad','document');

CREATE TABLE catalog.media (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  bigint REFERENCES catalog.product(id) ON DELETE CASCADE,
  variant_id  bigint REFERENCES catalog.variant(id) ON DELETE CASCADE,
  kind        catalog.media_kind NOT NULL DEFAULT 'image',
  storage_key text NOT NULL,                         -- Cloudinary public_id
  url         text NOT NULL,
  mime_type   text,
  width_px    int CHECK (width_px > 0),
  height_px   int CHECK (height_px > 0),
  bytes       bigint CHECK (bytes > 0),
  alt_text    text,
  sort_order  int NOT NULL DEFAULT 0,
  is_primary  boolean NOT NULL DEFAULT false,
  legacy_path text,                                  -- la ruta vieja, por trazabilidad
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_owner CHECK (product_id IS NOT NULL OR variant_id IS NOT NULL)
);
CREATE UNIQUE INDEX media_one_primary_product
  ON catalog.media (product_id) WHERE is_primary AND product_id IS NOT NULL;
CREATE UNIQUE INDEX media_one_primary_variant
  ON catalog.media (variant_id) WHERE is_primary AND variant_id IS NOT NULL;
CREATE INDEX media_product_idx ON catalog.media (product_id, sort_order);
CREATE INDEX media_variant_idx ON catalog.media (variant_id, sort_order);

-- -----------------------------------------------------------------------------
-- generador de SKU  (decisión 1: generado por el sistema, editable)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION catalog.build_sku(p_variant_id bigint) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT upper(concat_ws('-',
           p.code,
           COALESCE(sv.label, v.size_label),
           left(upper(v.metal_color), 3),
           left(upper(c.code), 3)))
  FROM catalog.variant v
  JOIN catalog.product p ON p.id = v.product_id
  LEFT JOIN catalog.size_value sv ON sv.id = v.size_value_id
  LEFT JOIN LATERAL (
    SELECT col.code
    FROM catalog.variant_stone vs
    JOIN catalog.color col ON col.code = vs.color_code
    WHERE vs.variant_id = v.id
    ORDER BY vs.is_center DESC, vs.id
    LIMIT 1
  ) c ON true
  WHERE v.id = p_variant_id;
$$;

-- =============================================================================
-- ERP v2 — 002 catalog (taxonomía): categorías, materiales, acabados, piedras,
--                                    colores, tallas, colecciones, atributos
-- =============================================================================

-- -----------------------------------------------------------------------------
-- categorías jerárquicas (reemplaza tipo_alhajas + clases_alhajas)
-- -----------------------------------------------------------------------------
CREATE TABLE catalog.category (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id   bigint REFERENCES catalog.category(id) ON DELETE RESTRICT,
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  path        ltree NOT NULL UNIQUE,                 -- 'joyeria.anillos.sortija_dama'
  level       int GENERATED ALWAYS AS (nlevel(path)) STORED,
  description text,
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  legacy_ala  char(1),                               -- tipo_alhajas.codigo_ala
  legacy_cla  char(1),                               -- clases_alhajas.codigo_cla_alhajas
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT category_not_own_parent CHECK (parent_id IS DISTINCT FROM id)
);
CREATE INDEX category_path_gist ON catalog.category USING gist (path);
CREATE INDEX category_parent_idx ON catalog.category (parent_id, sort_order);
CREATE TRIGGER trg_category_touch BEFORE UPDATE ON catalog.category
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- -----------------------------------------------------------------------------
-- materiales  (reemplaza `material`, SIN mezclar tipo de ítem)
-- -----------------------------------------------------------------------------
CREATE TYPE catalog.material_family AS ENUM (
  'gold','silver','platinum','palladium','steel','bronze','copper','brass',
  'nickel','alpaca','marble','wood','leather','textile','resin','costume','other'
);

CREATE TABLE catalog.material (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text NOT NULL UNIQUE,                -- 'AU18','AU21','AU14','AG925','ACERO'
  name          text NOT NULL,                       -- 'Oro 18K'
  family        catalog.material_family NOT NULL,
  purity_millis int CHECK (purity_millis BETWEEN 1 AND 1000),   -- 750, 925, 585
  karat         numeric(4,1) CHECK (karat BETWEEN 0 AND 24),
  density_g_cm3 numeric(8,3) CHECK (density_g_cm3 > 0),
  is_precious   boolean NOT NULL DEFAULT false,
  -- si se cotiza al peso, su precio por gramo vive en pricing.metal_rate
  is_priced_by_weight boolean NOT NULL DEFAULT false,
  hallmark      text,                                -- contraste / sello
  is_active     boolean NOT NULL DEFAULT true,
  legacy_code   char(1),                             -- material.codigo
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_material_touch BEFORE UPDATE ON catalog.material
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- colores de metal atómicos: reemplaza el string 'N+A+B+R' de Color_metal_articulo
CREATE TABLE catalog.metal_color (
  code       text PRIMARY KEY,                       -- 'amarillo','blanco','rosa','negro'
  name       text NOT NULL,
  hex        char(7),
  legacy_code text,                                  -- 'N','A','B','R','S','P/N','PQ'
  is_active  boolean NOT NULL DEFAULT true
);

-- acabados: hoy viven en texto libre ("todo pul", "satinado", "diamantado")
CREATE TABLE catalog.finish (
  code      text PRIMARY KEY,                        -- 'pulido','satinado','diamantado','envejecido'
  name      text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

-- -----------------------------------------------------------------------------
-- piedras  (reemplaza Tipo_piedra + clase_piedra, y limpia color_piedra)
-- -----------------------------------------------------------------------------
CREATE TYPE catalog.stone_origin AS ENUM (
  'natural',      -- piedra natural / gema fina
  'lab_grown',    -- diamante o gema de laboratorio
  'synthetic',    -- zircón, cristal
  'imitation',    -- vidrio, acrílico, strass
  'organic'       -- perla, nácar, coral, spondylus, semilla, hoja de coca
);

CREATE TABLE catalog.stone (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,                          -- 'Zafiro', 'Zircón', 'Nácar', 'Spondylus'
  origin     catalog.stone_origin NOT NULL,
  is_gem     boolean NOT NULL DEFAULT false,         -- gema fina (afecta costo y certificado)
  mohs_min   numeric(3,1) CHECK (mohs_min BETWEEN 1 AND 10),
  mohs_max   numeric(3,1) CHECK (mohs_max BETWEEN 1 AND 10),
  -- precio referencial, el real por pieza va en catalog.variant_stone
  default_unit text REFERENCES core.unit(code),      -- 'ct' para gemas, 'und' para mostacilla
  is_active  boolean NOT NULL DEFAULT true,
  legacy_tipo  int,                                  -- Tipo_piedra.cod_tipopiedra
  legacy_clase int,                                  -- clase_piedra.cod_clasepiedra
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stone_mohs_order CHECK (mohs_max IS NULL OR mohs_min IS NULL OR mohs_max >= mohs_min)
);
CREATE TRIGGER trg_stone_touch BEFORE UPDATE ON catalog.stone
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- forma/talla de la piedra: no existía
CREATE TABLE catalog.stone_cut (
  code      text PRIMARY KEY,                        -- 'redonda','princesa','marquesa','cabujon'
  name      text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

-- tipo de engaste: hoy en la descripción ("@cruzado", "con garra")
CREATE TABLE catalog.setting_type (
  code      text PRIMARY KEY,                        -- 'garra','carril','pave','cerrado','pegado'
  name      text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

-- SOLO color. Lo que en color_piedra era material (NACAR, CORAL, PERLA,
-- OJO DE TIGRE, HEMATITE) se migra a catalog.stone, no acá.
CREATE TABLE catalog.color (
  code        text PRIMARY KEY,                      -- 'cristalino','rojo','verde','lavanda'
  name        text NOT NULL,
  hex         char(7),
  legacy_code text,                                  -- color_piedra.cod_colorpiedra
  is_active   boolean NOT NULL DEFAULT true
);

-- -----------------------------------------------------------------------------
-- tallas: el legacy guarda 11..17 en la misma columna que "5.5*4"
-- -----------------------------------------------------------------------------
CREATE TABLE catalog.size_scale (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code      text NOT NULL UNIQUE,                    -- 'aro_pe','collar_cm','pulsera_cm'
  name      text NOT NULL,
  unit_code text REFERENCES core.unit(code),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE catalog.size_value (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  size_scale_id  bigint NOT NULL REFERENCES catalog.size_scale(id) ON DELETE CASCADE,
  value          numeric(8,2) NOT NULL,              -- 16.0
  label          text NOT NULL,                      -- '16'
  diameter_mm    numeric(6,2),                       -- equivalencia física
  us_equivalent  text,                               -- para el e-commerce / exportación
  sort_order     int NOT NULL DEFAULT 0,
  UNIQUE (size_scale_id, value)
);

-- -----------------------------------------------------------------------------
-- colecciones, temas y ocasiones
-- (hoy todo esto está dentro de DESCRIPCION: "tumi", "chavin", "bodas de oro")
-- -----------------------------------------------------------------------------
CREATE TABLE catalog.collection (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code      text NOT NULL UNIQUE,
  name      text NOT NULL,
  season    text,
  year      smallint CHECK (year BETWEEN 1990 AND 2100),
  starts_on date,
  ends_on   date,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT collection_dates CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE TYPE catalog.tag_kind AS ENUM ('theme','occasion','style','campaign','other');

CREATE TABLE catalog.tag (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug      text NOT NULL UNIQUE,                    -- 'tumi','incaico','bodas-de-oro','logia'
  name      text NOT NULL,
  kind      catalog.tag_kind NOT NULL DEFAULT 'theme',
  is_active boolean NOT NULL DEFAULT true
);

-- -----------------------------------------------------------------------------
-- atributos extensibles controlados
-- para que NADA de lo que hoy se apunta en un cuaderno quede sin lugar,
-- sin tener que alterar la tabla cada vez
-- -----------------------------------------------------------------------------
CREATE TYPE catalog.attribute_type AS ENUM ('text','number','boolean','option','date');

CREATE TABLE catalog.attribute (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE,                  -- 'tipo_cierre','largo_cadena','genero_logia'
  name        text NOT NULL,
  type        catalog.attribute_type NOT NULL,
  unit_code   text REFERENCES core.unit(code),
  -- si aplica al modelo o a la pieza vendible
  scope       text NOT NULL DEFAULT 'product' CHECK (scope IN ('product','variant')),
  is_required boolean NOT NULL DEFAULT false,
  is_filterable boolean NOT NULL DEFAULT false,      -- aparece como filtro en el e-commerce
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE catalog.attribute_option (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attribute_id bigint NOT NULL REFERENCES catalog.attribute(id) ON DELETE CASCADE,
  code         text NOT NULL,
  name         text NOT NULL,
  sort_order   int NOT NULL DEFAULT 0,
  UNIQUE (attribute_id, code)
);

-- qué atributos exige cada categoría (una sortija pide talla, un plato no)
CREATE TABLE catalog.category_attribute (
  category_id  bigint NOT NULL REFERENCES catalog.category(id) ON DELETE CASCADE,
  attribute_id bigint NOT NULL REFERENCES catalog.attribute(id) ON DELETE CASCADE,
  is_required  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (category_id, attribute_id)
);

-- -----------------------------------------------------------------------------
-- opciones de grabado  (ya existe engraving-fonts en el backend, sin modelo)
-- -----------------------------------------------------------------------------
CREATE TABLE catalog.engraving_font (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  font_file   text,
  preview_url text,
  max_chars   int CHECK (max_chars > 0),
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0
);

CREATE TYPE catalog.engraving_technique AS ENUM ('laser','manual','diamond_tip','stamped');

CREATE TABLE catalog.engraving_option (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  technique     catalog.engraving_technique NOT NULL,
  max_chars     int CHECK (max_chars > 0),
  lead_time_days int CHECK (lead_time_days >= 0),
  is_active     boolean NOT NULL DEFAULT true
);

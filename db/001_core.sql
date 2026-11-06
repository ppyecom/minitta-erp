-- =============================================================================
-- ERP v2 — 001 core: organización, sedes, usuarios, referencias, auditoría
-- PostgreSQL 16 · UTF-8
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- búsqueda por nombre/código parcial

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS pricing;
CREATE SCHEMA IF NOT EXISTS inventory;

-- -----------------------------------------------------------------------------
-- utilidades comunes
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- slug seguro para URLs y códigos generados
CREATE OR REPLACE FUNCTION core.slugify(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(both '-' from
    regexp_replace(
      lower(translate(p_text,
        'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
        'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')),
      '[^a-z0-9]+', '-', 'g')
  );
$$;

-- -----------------------------------------------------------------------------
-- monedas y unidades
-- -----------------------------------------------------------------------------
CREATE TABLE core.currency (
  code        char(3)  PRIMARY KEY,                 -- ISO 4217: PEN, USD, EUR
  sunat_code  text,
  name        text     NOT NULL,
  short_name  text     NOT NULL,
  symbol      text     NOT NULL,
  decimals    smallint NOT NULL DEFAULT 2 CHECK (decimals BETWEEN 0 AND 6),
  is_base     boolean  NOT NULL DEFAULT false,       -- moneda de la contabilidad
  is_active   boolean  NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX currency_one_base ON core.currency (is_base) WHERE is_base;

CREATE TYPE core.unit_kind AS ENUM ('mass','length','count','time');

CREATE TABLE core.unit (
  code  text PRIMARY KEY,                            -- g, ct, mm, cm, und, par, docena
  name  text NOT NULL,
  kind  core.unit_kind NOT NULL,
  -- factor hacia la unidad base de su tipo (g para masa, mm para longitud, und para conteo)
  factor_to_base numeric(18,9) NOT NULL DEFAULT 1 CHECK (factor_to_base > 0)
);

-- -----------------------------------------------------------------------------
-- usuarios y permisos mínimos (el módulo completo de auth va aparte)
-- -----------------------------------------------------------------------------
CREATE TABLE core.app_user (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username    citext NOT NULL UNIQUE,
  full_name   text   NOT NULL,
  email       citext UNIQUE,
  document_id text,                                  -- DNI, para firmar conteos
  -- quién puede ver el costo: reemplaza la "CLAVE" codificada en letras del legacy
  can_see_cost boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  is_system   boolean NOT NULL DEFAULT false,        -- 'migracion', 'ecommerce', 'cron'
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_app_user_touch BEFORE UPDATE ON core.app_user
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- -----------------------------------------------------------------------------
-- sedes  (reemplaza `tiendas`)
-- -----------------------------------------------------------------------------
CREATE TYPE core.location_kind AS ENUM (
  'store',          -- tienda de venta al público
  'warehouse',      -- almacén
  'workshop',       -- taller / área de producción
  'office',         -- oficina administrativa
  'purchasing',     -- área de compras
  'distribution',   -- área de distribución
  'consignment',    -- mercadería en poder de un tercero
  'virtual'         -- e-commerce, ferias, stock en tránsito
);

CREATE TABLE core.location (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code            text NOT NULL UNIQUE,              -- 'T-1', 'T-JOCKEY', 'ALM-CENTRAL'
  name            text NOT NULL,
  kind            core.location_kind NOT NULL,

  -- capacidades explícitas, en lugar de deducirlas del campo `area` V/O/P del legacy
  sells           boolean NOT NULL DEFAULT false,    -- puede emitir comprobantes
  holds_stock     boolean NOT NULL DEFAULT true,     -- participa del inventario
  is_third_party  boolean NOT NULL DEFAULT false,    -- consignación: no es nuestra
  allows_negative_stock boolean NOT NULL DEFAULT false,

  parent_id       bigint REFERENCES core.location(id),
  manager_user_id bigint REFERENCES core.app_user(id),

  address_line    text,
  district        text,
  city            text,
  country         char(2) NOT NULL DEFAULT 'PE',
  phone           text,
  mobile          text,
  email           citext,

  is_active       boolean NOT NULL DEFAULT true,
  opened_at       date,
  closed_at       date,

  legacy_num      int UNIQUE,                        -- tiendas.num_tienda
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT location_closed_after_open CHECK (closed_at IS NULL OR opened_at IS NULL OR closed_at >= opened_at),
  CONSTRAINT location_closed_is_inactive CHECK (closed_at IS NULL OR is_active = false),
  CONSTRAINT location_not_own_parent     CHECK (parent_id IS DISTINCT FROM id)
);
CREATE INDEX location_active_idx ON core.location (kind) WHERE is_active;
CREATE INDEX location_parent_idx ON core.location (parent_id);
CREATE TRIGGER trg_location_touch BEFORE UPDATE ON core.location
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- configuración de la app por sede: saca XML1, VISOR, RUTA_INSTALACION,
-- ETIQUETA, REPORTE, RECIBOS... de la tabla maestra de sedes
CREATE TABLE core.app_setting (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id bigint REFERENCES core.location(id) ON DELETE CASCADE,
  key         text NOT NULL,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (location_id, key)       -- location_id NULL = global
);

-- -----------------------------------------------------------------------------
-- proveedores
-- -----------------------------------------------------------------------------
CREATE TABLE core.supplier (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  legal_name   text,
  tax_id       text,                                 -- RUC
  contact_name text,
  phone        text,
  email        citext,
  address_line text,
  lead_time_days int CHECK (lead_time_days >= 0),
  currency_code char(3) REFERENCES core.currency(code),
  notes        text,
  is_active    boolean NOT NULL DEFAULT true,
  legacy_code  text,                                 -- almacen_articulo.COD_PROVEEDOR
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_supplier_touch BEFORE UPDATE ON core.supplier
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- -----------------------------------------------------------------------------
-- impuestos  (no existía en el legacy)
-- -----------------------------------------------------------------------------
CREATE TABLE core.tax_category (
  code             text PRIMARY KEY,                 -- 'igv_18', 'exonerado', 'inafecto'
  name             text NOT NULL,
  rate             numeric(6,4) NOT NULL CHECK (rate >= 0),
  sunat_afectacion text,                             -- catálogo 07 SUNAT: '10','20','30'
  is_active        boolean NOT NULL DEFAULT true
);

-- -----------------------------------------------------------------------------
-- auditoría única para todo el ERP
-- reemplaza PC_REGISTRO / USUARIO_REGISTRO / FECHA_MODIFICO / USUARIO_ANULACION
-- repetidas en cada tabla, y guarda TODA la historia, no sólo el último cambio
-- -----------------------------------------------------------------------------
CREATE TABLE core.audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity      text   NOT NULL,                       -- 'catalog.variant'
  entity_id   bigint NOT NULL,
  action      text   NOT NULL CHECK (action IN ('insert','update','delete')),
  changed_by  bigint REFERENCES core.app_user(id),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  client_info text,                                  -- reemplaza PC_REGISTRO / EstacionTrabajo
  diff        jsonb  NOT NULL                        -- {"campo": [antes, despues]}
);
CREATE INDEX audit_entity_idx ON core.audit_log (entity, entity_id, changed_at DESC);
CREATE INDEX audit_user_idx   ON core.audit_log (changed_by, changed_at DESC);

-- el usuario de la sesión lo setea la app: SET LOCAL app.user_id = '42';
CREATE OR REPLACE FUNCTION core.current_user_id() RETURNS bigint
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN nullif(current_setting('app.user_id', true), '')::bigint;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION core.audit_row() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  v_diff jsonb := '{}'::jsonb;
  v_key text;
  v_id bigint;
BEGIN
  FOR v_key IN
    SELECT k FROM (SELECT jsonb_object_keys(v_old) AS k
                   UNION
                   SELECT jsonb_object_keys(v_new)) s
  LOOP
    IF v_key NOT IN ('updated_at') AND (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
      v_diff := v_diff || jsonb_build_object(v_key,
                 jsonb_build_array(v_old -> v_key, v_new -> v_key));
    END IF;
  END LOOP;

  IF v_diff = '{}'::jsonb THEN
    RETURN NULL;
  END IF;

  v_id := COALESCE((v_new ->> 'id')::bigint, (v_old ->> 'id')::bigint);

  INSERT INTO core.audit_log (entity, entity_id, action, changed_by, client_info, diff)
  VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, v_id, lower(TG_OP),
          core.current_user_id(),
          nullif(current_setting('app.client_info', true), ''),
          v_diff);
  RETURN NULL;
END $$;

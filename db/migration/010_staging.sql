-- =============================================================================
-- ERP v2 — migración 010: staging crudo del legacy
-- TODO en text y sin constraints: el objetivo es cargar tal cual vino,
-- sin perder nada ni fallar por un dato malo. La limpieza viene después.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS legacy;
CREATE SCHEMA IF NOT EXISTS migration;

DROP TABLE IF EXISTS legacy.almacen_articulo;
CREATE TABLE legacy.almacen_articulo (
  codigo_articulo        text,
  id_tipo                text,
  codigo                 text,
  codigo_ala             text,
  codigo_cla_alhajas     text,
  codigo_tipo_piedra     text,
  codigo_clase_piedra    text,
  codigo_color           text,
  cod_proveedor          text,
  id_color_metal         text,
  id_tipo_moneda         text,
  nombre                 text,
  descripcion            text,
  imagen                 text,
  peso                   text,
  medida                 text,
  precio_piedra          text,
  precio_producto        text,
  porcentaje_comerciante text,
  precio_comerciante     text,
  porc_mayor             text,
  precio_mayor           text,
  porcenteje             text,
  precio                 text,
  prec_gr                text,
  clave                  text,
  stock                  text,
  stock_minimo           text,
  activo                 text,
  numero                 text,
  moneda                 text,
  inicial                text,
  fecha_ingreso          text,
  id                     text,
  tip_pied               text,
  medida_piedra          text,
  pid_med                text,
  dejar_usar             text,
  favorito               text,
  ind_producto           text,
  ind_estado             text,
  ind_registro           text,
  pc_registro            text,
  usuario_registro       text,
  fecha_registro         text,
  pc_modifico            text,
  usuario_modifico       text,
  fecha_modifico         text,
  usuario_anulacion      text,
  fecha_anulacion        text
);

DROP TABLE IF EXISTS legacy.material;
CREATE TABLE legacy.material (
  codigo text, nombre text, prefijo text, ind_tipo_venta text
);

DROP TABLE IF EXISTS legacy.tipo_alhajas;
CREATE TABLE legacy.tipo_alhajas (
  codigo_ala text, nombre text, prejifo text
);

DROP TABLE IF EXISTS legacy.clases_alhajas;
CREATE TABLE legacy.clases_alhajas (
  codigo_cla_alhajas text, nombre text, prefijo text
);

DROP TABLE IF EXISTS legacy.tipo_piedra;
CREATE TABLE legacy.tipo_piedra (
  cod_tipopiedra text, nombre_piedra text
);

DROP TABLE IF EXISTS legacy.clase_piedra;
CREATE TABLE legacy.clase_piedra (
  cod_clasepiedra text, cod_tipopiedra text, nombre_clasepiedra text, nulo text
);

DROP TABLE IF EXISTS legacy.color_piedra;
CREATE TABLE legacy.color_piedra (
  cod_colorpiedra text, nombre_color text
);

DROP TABLE IF EXISTS legacy.color_metal_articulo;
CREATE TABLE legacy.color_metal_articulo (
  id_color_metal text, codigo text, color text, imagen text
);

DROP TABLE IF EXISTS legacy.stocks;
CREATE TABLE legacy.stocks (
  num_tienda text, codigo_articulo text, cantida text, stock text,
  estado text, modificado_por_usuario text, aplicacion_origen text, estacion_trabajo text
);

DROP TABLE IF EXISTS legacy.tiendas;
CREATE TABLE legacy.tiendas (
  num_tienda text, nombre text, anulada text, ubicacion text, area text, caja text,
  telefono text, celular text, email text, web text, imagen text, visor text,
  xml1 text, xml2 text, ruta_instalacion text, tienda text, ruta_prof text,
  sistema text, reporte text, recibos text, etiqueta text
);

DROP TABLE IF EXISTS legacy.tipo_moneda;
CREATE TABLE legacy.tipo_moneda (
  id_tipo_moneda text, codigo_sunat text, descripcion text, nombre_corto text,
  abreviacion text, simbolo text, alias text, ind_estado text,
  usuario_registro text, fecha_registro text, usuario_modifico text,
  fecha_modifico text, codigo_iso text
);

-- -----------------------------------------------------------------------------
-- bitácora de la corrida y reporte de excepciones
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS migration.run CASCADE;
CREATE TABLE migration.run (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  is_dry_run  boolean NOT NULL DEFAULT true,
  notes       text
);

DROP TABLE IF EXISTS migration.exception CASCADE;
CREATE TABLE migration.exception (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  severity      text NOT NULL CHECK (severity IN ('error','warning','info')),
  stage         text NOT NULL,          -- 'catalog','pricing','inventory','load'
  rule          text NOT NULL,          -- identificador corto de la regla
  legacy_key    text,                   -- CODIGO_ARTICULO u otra clave
  message       text NOT NULL,
  detail        jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exception_stage_idx ON migration.exception (stage, severity, rule);

CREATE OR REPLACE FUNCTION migration.log_exception(
  p_severity text, p_stage text, p_rule text,
  p_legacy_key text, p_message text, p_detail jsonb DEFAULT '{}')
RETURNS void LANGUAGE sql AS $$
  INSERT INTO migration.exception (severity, stage, rule, legacy_key, message, detail)
  VALUES (p_severity, p_stage, p_rule, p_legacy_key, p_message, p_detail);
$$;

-- -----------------------------------------------------------------------------
-- helpers de limpieza
-- -----------------------------------------------------------------------------

-- texto vacío, '-', '0' y espacios → NULL
CREATE OR REPLACE FUNCTION migration.clean_text(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(nullif(btrim(regexp_replace(COALESCE(p,''), '\s+', ' ', 'g')), ''), '-');
$$;

-- numérico tolerante: devuelve NULL en vez de reventar
CREATE OR REPLACE FUNCTION migration.to_numeric(p text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN nullif(btrim(COALESCE(p,'')), '')::numeric;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION migration.to_int(p text) RETURNS int
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN nullif(btrim(COALESCE(p,'')), '')::int;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION migration.to_timestamp(p text) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN nullif(btrim(COALESCE(p,'')), '')::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

-- 'y'/'Y'/'1'/'Si' → true ; 'n'/'N'/'0'/'No' → false
CREATE OR REPLACE FUNCTION migration.to_bool(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(btrim(COALESCE(p,'')))
           WHEN 'y' THEN true  WHEN 'yes' THEN true WHEN 'si' THEN true
           WHEN 'sí' THEN true WHEN '1' THEN true   WHEN 't' THEN true
           WHEN 'n' THEN false WHEN 'no' THEN false WHEN '0' THEN false
           WHEN 'f' THEN false
           ELSE NULL
         END;
$$;

-- nombre de modelo normalizado: quita el '@' inicial y los sufijos numéricos
-- 'RivierP2_01' → 'rivierp2'   ·   '@Solaper' → 'solaper'   ·   'Tiaraz2' → 'tiaraz'
CREATE OR REPLACE FUNCTION migration.model_base_name(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(
    regexp_replace(
      regexp_replace(
        lower(btrim(regexp_replace(COALESCE(p,''), '^\s*@+', ''))),
        '[_\-\s]*[0-9]+\s*$', ''),            -- sufijo numérico final
      '\s+', ' ', 'g'),
    '');
$$;

-- descripción normalizada, para decidir si dos filas son el mismo modelo
CREATE OR REPLACE FUNCTION migration.desc_fingerprint(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(btrim(regexp_replace(
           regexp_replace(COALESCE(p,''), '^\s*@+', ''),
           '\s+', ' ', 'g')));
$$;

-- nombre de archivo suelto desde la ruta de Windows del legacy
-- 'C:\Sistema Minitta\imagen\Escudoz.jpg' → 'Escudoz.jpg'
CREATE OR REPLACE FUNCTION migration.image_basename(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(regexp_replace(COALESCE(p,''), '^.*[\\/]', ''), '');
$$;

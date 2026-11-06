-- =============================================================================
-- ERP v2 — migración 030: mapas de códigos legacy → v2
-- Cada letra y cada número del ERP viejo queda explícitamente mapeado.
-- Lo que no se puede mapear NO se adivina: se reporta en migration.exception.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- material (1 letra) → material real  O  tipo de producto
-- Las 7 letras que no eran material se vuelven product.kind.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS migration.map_material CASCADE;
CREATE TABLE migration.map_material (
  legacy_code  char(1) PRIMARY KEY,
  legacy_name  text,
  material_id  bigint REFERENCES catalog.material(id),
  product_kind catalog.product_kind NOT NULL,
  category_root text NOT NULL        -- raíz de categoría por defecto
);

INSERT INTO migration.map_material (legacy_code, legacy_name, material_id, product_kind, category_root)
SELECT d.code, m.nombre,
       (SELECT id FROM catalog.material WHERE code = d.mat_code),
       d.kind::catalog.product_kind,
       d.root
FROM (VALUES
  ('A','FANTASIA',       'FANTASIA',     'jewelry',   'joyeria'),
  ('B','BRONCES',        'BRONCE',       'handicraft','artesania'),
  ('C','COBRE',          'COBRE',        'handicraft','artesania'),
  ('D','DIAMANTE',       'DIAMANTADO',   'jewelry',   'joyeria'),
  ('E','ESTUCHES',        NULL,          'packaging', 'insumos'),
  ('F','COMERCIAL',       NULL,          'other',     'insumos'),
  ('G','GOLFIE',         'GOLD-FILLED',  'jewelry',   'joyeria'),
  ('H','HERRAMIENTAS',    NULL,          'supply',    'insumos'),
  ('I','IMAGEN-DISENO',   NULL,          'marketing', 'insumos'),
  ('J','PLATA GEMAS',    'AG-GEM',       'jewelry',   'joyeria'),
  ('K','CRISTAL',        'CRISTAL-MAT',  'jewelry',   'joyeria'),
  ('L','ORO 21K',        'AU21',         'jewelry',   'joyeria'),
  ('M','PLATA/18K',      'AG-AU18',      'jewelry',   'joyeria'),
  ('N','NIQUEL',         'NIQUEL',       'jewelry',   'joyeria'),
  ('O','ORO 18K',        'AU18',         'jewelry',   'joyeria'),
  ('P','PLATA',          'AG925',        'jewelry',   'joyeria'),
  ('Q','PLAQUET',        'PLAQUE',       'handicraft','artesania'),
  ('R','REGALO',          NULL,          'gift',      'insumos'),
  ('S','SERV',            NULL,          'service',   'servicios'),
  ('T','PLATINO',        'PT',           'jewelry',   'joyeria'),
  ('U','ACERO',          'ACERO',        'jewelry',   'joyeria'),
  ('V','VARIOS',         'VARIOS',       'other',     'insumos'),
  ('W','CATALOGO',        NULL,          'marketing', 'insumos'),
  ('X','BANADOS',        'BANADO',       'jewelry',   'joyeria'),
  ('Y','MARMOL',         'MARMOL',       'handicraft','artesania'),
  ('Z','ORO 14K',        'AU14',         'jewelry',   'joyeria')
) AS d(code, nom, mat_code, kind, root)
LEFT JOIN legacy.material m ON btrim(m.codigo) = d.code;

-- letras de material usadas por artículos pero que no están en el mapa
SELECT migration.log_exception('error','maps','material_sin_mapa',
         a.codigo_articulo,
         format('la letra de material "%s" no está mapeada', a.codigo),
         jsonb_build_object('codigo', a.codigo))
FROM legacy.almacen_articulo a
LEFT JOIN migration.map_material mm ON mm.legacy_code = btrim(a.codigo)
WHERE mm.legacy_code IS NULL AND migration.clean_text(a.codigo) IS NOT NULL;

-- -----------------------------------------------------------------------------
-- categorías: nivel 1 ya viene del seed (legacy_ala).
-- El nivel 2 se crea para cada combinación (ala, cla) que REALMENTE exista.
-- -----------------------------------------------------------------------------
INSERT INTO catalog.category (parent_id, slug, name, path, legacy_ala, legacy_cla, sort_order)
SELECT p.id,
       p.slug || '-' || lower(core.slugify(COALESCE(cl.nombre, 'cla-' || combo.cla))),
       COALESCE(cl.nombre, 'Clase ' || combo.cla),
       (p.path::text || '.' ||
        regexp_replace(core.slugify(COALESCE(cl.nombre, 'cla_' || combo.cla)), '-', '_', 'g'))::ltree,
       combo.ala, combo.cla,
       row_number() OVER (PARTITION BY p.id ORDER BY combo.cla)
FROM (
  SELECT DISTINCT btrim(a.codigo_ala) AS ala, btrim(a.codigo_cla_alhajas) AS cla
  FROM legacy.almacen_articulo a
  WHERE migration.clean_text(a.codigo_ala) IS NOT NULL
    AND migration.clean_text(a.codigo_cla_alhajas) IS NOT NULL
) combo
JOIN catalog.category p ON p.legacy_ala = combo.ala AND p.legacy_cla IS NULL
LEFT JOIN legacy.clases_alhajas cl ON btrim(cl.codigo_cla_alhajas) = combo.cla
ON CONFLICT (path) DO NOTHING;

DROP TABLE IF EXISTS migration.map_category CASCADE;
CREATE TABLE migration.map_category (
  legacy_ala  char(1) NOT NULL,
  legacy_cla  char(1) NOT NULL,
  category_id bigint NOT NULL REFERENCES catalog.category(id),
  PRIMARY KEY (legacy_ala, legacy_cla)
);

INSERT INTO migration.map_category (legacy_ala, legacy_cla, category_id)
SELECT c.legacy_ala, c.legacy_cla, c.id
FROM catalog.category c
WHERE c.legacy_ala IS NOT NULL AND c.legacy_cla IS NOT NULL;

-- artículos cuyo tipo de alhaja no existe en el árbol
SELECT migration.log_exception('warning','maps','categoria_sin_mapa',
         a.codigo_articulo,
         format('tipo/clase de alhaja (%s,%s) sin categoría: queda en la raíz',
                a.codigo_ala, a.codigo_cla_alhajas),
         jsonb_build_object('ala', a.codigo_ala, 'cla', a.codigo_cla_alhajas))
FROM legacy.almacen_articulo a
LEFT JOIN migration.map_category mc
       ON mc.legacy_ala = btrim(a.codigo_ala) AND mc.legacy_cla = btrim(a.codigo_cla_alhajas)
WHERE mc.category_id IS NULL;

-- -----------------------------------------------------------------------------
-- piedras: clase_piedra → catalog.stone (por legacy_clase del seed)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS migration.map_stone CASCADE;
CREATE TABLE migration.map_stone (
  legacy_clase int PRIMARY KEY,
  legacy_name  text,
  stone_id     bigint REFERENCES catalog.stone(id)
);

INSERT INTO migration.map_stone (legacy_clase, legacy_name, stone_id)
SELECT migration.to_int(cp.cod_clasepiedra), cp.nombre_clasepiedra, s.id
FROM legacy.clase_piedra cp
LEFT JOIN catalog.stone s ON s.legacy_clase = migration.to_int(cp.cod_clasepiedra)
WHERE migration.to_int(cp.cod_clasepiedra) IS NOT NULL
ON CONFLICT (legacy_clase) DO NOTHING;

-- la clase 19 = NINGUNO no se mapea a propósito: sin piedra = sin fila
UPDATE migration.map_stone SET stone_id = NULL WHERE legacy_clase = 19;

SELECT migration.log_exception('warning','maps','piedra_sin_mapa', NULL,
         format('la clase de piedra %s ("%s") no tiene equivalente en catalog.stone',
                legacy_clase, legacy_name),
         jsonb_build_object('legacy_clase', legacy_clase))
FROM migration.map_stone
WHERE stone_id IS NULL AND legacy_clase <> 19;

-- -----------------------------------------------------------------------------
-- color de piedra: unos son color, otros eran material (y van a stone)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS migration.map_color CASCADE;
CREATE TABLE migration.map_color (
  legacy_code text PRIMARY KEY,
  legacy_name text,
  color_code  text REFERENCES catalog.color(code),
  stone_id    bigint REFERENCES catalog.stone(id),   -- cuando el "color" era piedra
  is_none     boolean NOT NULL DEFAULT false
);

-- 1) los que sí son color: por legacy_code del seed
INSERT INTO migration.map_color (legacy_code, legacy_name, color_code)
SELECT btrim(cp.cod_colorpiedra), cp.nombre_color, c.code
FROM legacy.color_piedra cp
JOIN catalog.color c ON c.legacy_code = btrim(cp.cod_colorpiedra)
ON CONFLICT (legacy_code) DO NOTHING;

-- 2) los que eran material, no color
INSERT INTO migration.map_color (legacy_code, legacy_name, stone_id)
SELECT d.code, d.nom, (SELECT id FROM catalog.stone WHERE code = d.stone)
FROM (VALUES
  ('010','OJO DE TIGRE','OJO_TIGRE'),
  ('012','NACAR',       'NACAR'),
  ('013','CORAL',       'CORAL'),
  ('044','PERLA',       'PERLA_ART')
) AS d(code, nom, stone)
ON CONFLICT (legacy_code) DO NOTHING;

-- 3) los CRISTAL-x: la piedra es cristal y el color va aparte
INSERT INTO migration.map_color (legacy_code, legacy_name, color_code, stone_id)
SELECT d.code, d.nom, d.color, (SELECT id FROM catalog.stone WHERE code = 'CRISTAL')
FROM (VALUES
  ('041','CRISTAL - NEGRO',        'negro'),
  ('042','CRISTAL - AMATISTA',     'morado'),
  ('043','CRISTAL-ROSA FRANCIA',   'rosa_francia'),
  ('046','CRISTAL - RUBI',         'rojo'),
  ('047','CRISTAL - ESMERALDA',    'verde'),
  ('048','CRISTAL ZAFIRO',         'azul_zafiro')
) AS d(code, nom, color)
ON CONFLICT (legacy_code) DO NOTHING;

-- 4) "NINGUNO": no se migra
INSERT INTO migration.map_color (legacy_code, legacy_name, is_none)
VALUES ('0N','NINGUNO', true)
ON CONFLICT (legacy_code) DO NOTHING;

SELECT migration.log_exception('warning','maps','color_sin_mapa', NULL,
         format('el color de piedra "%s" ("%s") no está mapeado',
                cp.cod_colorpiedra, cp.nombre_color),
         jsonb_build_object('legacy_code', cp.cod_colorpiedra))
FROM legacy.color_piedra cp
LEFT JOIN migration.map_color mc ON mc.legacy_code = btrim(cp.cod_colorpiedra)
WHERE mc.legacy_code IS NULL;

-- -----------------------------------------------------------------------------
-- color de metal: 'N+A+B' → color primario + secundario (+ resto a atributo)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS migration.map_metal_color CASCADE;
CREATE TABLE migration.map_metal_color (
  legacy_id      int PRIMARY KEY,
  legacy_color   text,
  primary_code   text REFERENCES catalog.metal_color(code),
  secondary_code text REFERENCES catalog.metal_color(code),
  extra_codes    text[],              -- 3er color en adelante
  is_junk        boolean NOT NULL DEFAULT false
);

INSERT INTO migration.map_metal_color (legacy_id, legacy_color, primary_code, secondary_code, extra_codes, is_junk)
SELECT migration.to_int(cm.id_color_metal),
       cm.color,
       parts.codes[1],
       parts.codes[2],
       CASE WHEN array_length(parts.codes, 1) > 2
            THEN parts.codes[3:array_length(parts.codes,1)] END,
       -- la fila 20 del legacy es '0,0,0': basura que usan casi todos los artículos
       (btrim(COALESCE(cm.color,'')) IN ('', '0'))
FROM legacy.color_metal_articulo cm
CROSS JOIN LATERAL (
  SELECT array_remove(array_agg(mc.code ORDER BY ord), NULL) AS codes
  FROM unnest(string_to_array(upper(btrim(COALESCE(cm.color,''))), '+')) WITH ORDINALITY AS t(tok, ord)
  LEFT JOIN catalog.metal_color mc ON upper(mc.legacy_code) = btrim(t.tok)
) parts
WHERE migration.to_int(cm.id_color_metal) IS NOT NULL
ON CONFLICT (legacy_id) DO NOTHING;

SELECT migration.log_exception('info','maps','color_metal_basura', NULL,
         format('el id_color_metal %s ("%s") es la fila basura del legacy: se migra como NULL',
                legacy_id, legacy_color),
         jsonb_build_object('legacy_id', legacy_id))
FROM migration.map_metal_color WHERE is_junk;

-- -----------------------------------------------------------------------------
-- sedes: num_tienda → core.location (por legacy_num del seed)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS migration.map_location CASCADE;
CREATE TABLE migration.map_location (
  legacy_num  int PRIMARY KEY,
  legacy_name text,
  location_id bigint REFERENCES core.location(id)
);

INSERT INTO migration.map_location (legacy_num, legacy_name, location_id)
SELECT migration.to_int(t.num_tienda), t.nombre, l.id
FROM legacy.tiendas t
LEFT JOIN core.location l ON l.legacy_num = migration.to_int(t.num_tienda)
WHERE migration.to_int(t.num_tienda) IS NOT NULL
ON CONFLICT (legacy_num) DO NOTHING;

SELECT migration.log_exception('warning','maps','sede_sin_mapa', NULL,
         format('la tienda %s ("%s") no tiene sede en v2',
                legacy_num, COALESCE(legacy_name,'(sin nombre)')),
         jsonb_build_object('legacy_num', legacy_num))
FROM migration.map_location
WHERE location_id IS NULL;

-- -----------------------------------------------------------------------------
-- usuarios: el texto libre USUARIO_REGISTRO pasa a ser FK real
-- -----------------------------------------------------------------------------
INSERT INTO core.app_user (username, full_name, is_active, is_system)
SELECT DISTINCT lower(btrim(u.usuario)), upper(btrim(u.usuario)), false, false
FROM (
  SELECT usuario_registro AS usuario FROM legacy.almacen_articulo
  UNION
  SELECT usuario_modifico FROM legacy.almacen_articulo
  UNION
  SELECT modificado_por_usuario FROM legacy.stocks
) u
WHERE migration.clean_text(u.usuario) IS NOT NULL
  AND lower(btrim(u.usuario)) NOT IN (SELECT lower(username::text) FROM core.app_user)
ON CONFLICT (username) DO NOTHING;

-- quedan inactivos: son nombres heredados, no cuentas vigentes
SELECT migration.log_exception('info','maps','usuarios_heredados', NULL,
         format('%s usuario(s) creados desde texto libre del legacy, inactivos hasta revisión',
                count(*)), '{}')
FROM core.app_user WHERE NOT is_active AND NOT is_system;

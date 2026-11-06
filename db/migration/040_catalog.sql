-- =============================================================================
-- ERP v2 — migración 040: catálogo
-- Agrupa artículos en productos, crea las variantes, extrae las piedras y
-- las medidas que hoy viven en texto libre. No inventa ningún valor.
-- =============================================================================

BEGIN;

SET LOCAL app.user_id = '1';            -- usuario 'migracion'
SET LOCAL app.client_info = 'migracion legacy->v2';

-- -----------------------------------------------------------------------------
-- 1. staging tipado: una fila por artículo, con todo lo derivado ya calculado
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS migration.article_stage CASCADE;
CREATE TABLE migration.article_stage AS
WITH base AS (
  SELECT
    btrim(a.codigo_articulo)                        AS legacy_code,
    btrim(a.codigo)                                 AS mat_letter,
    btrim(a.codigo_ala)                             AS ala,
    btrim(a.codigo_cla_alhajas)                     AS cla,
    migration.clean_text(a.nombre)                  AS raw_name,
    migration.model_base_name(a.nombre)             AS base_name,
    migration.clean_text(a.descripcion)             AS raw_desc,
    migration.desc_fingerprint(a.descripcion)       AS desc_fp,
    migration.to_numeric(a.peso)                    AS peso,
    migration.clean_text(a.medida)                  AS medida_raw,
    migration.to_numeric(a.medida)                  AS medida_num,
    migration.to_int(a.codigo_clase_piedra)         AS clase_piedra,
    migration.to_int(a.codigo_tipo_piedra)          AS tipo_piedra,
    btrim(a.codigo_color)                           AS color_code,
    migration.to_int(a.id_color_metal)              AS color_metal_id,
    migration.to_numeric(a.medida_piedra)           AS medida_piedra,
    migration.clean_text(a.imagen)                  AS imagen,
    migration.to_numeric(a.precio)                  AS precio,
    migration.to_numeric(a.precio_comerciante)      AS precio_comerciante,
    migration.to_numeric(a.precio_mayor)            AS precio_mayor,
    migration.to_numeric(a.precio_producto)         AS precio_producto,
    migration.to_numeric(a.precio_piedra)           AS precio_piedra,
    migration.to_numeric(a.prec_gr)                 AS prec_gr,
    migration.clean_text(a.clave)                   AS clave,
    migration.to_numeric(a.stock)                   AS stock,
    migration.to_numeric(a.stock_minimo)            AS stock_minimo,
    migration.to_bool(a.activo)                     AS activo,
    migration.to_bool(a.dejar_usar)                 AS dejar_usar,
    migration.to_bool(a.favorito)                   AS favorito,
    migration.to_timestamp(a.fecha_ingreso)         AS fecha_ingreso,
    migration.to_timestamp(a.fecha_registro)        AS fecha_registro,
    lower(migration.clean_text(a.usuario_registro)) AS usuario_registro,
    migration.clean_text(a.cod_proveedor)           AS cod_proveedor,
    -- banderas sin significado documentado: se preservan completas
    jsonb_strip_nulls(jsonb_build_object(
      'id_tipo',      migration.clean_text(a.id_tipo),
      'numero',       migration.clean_text(a.numero),
      'inicial',      migration.clean_text(a.inicial),
      'legacy_id',    migration.clean_text(a.id),
      'tip_pied',     migration.clean_text(a.tip_pied),
      'pid_med',      migration.clean_text(a.pid_med),
      'ind_producto', migration.clean_text(a.ind_producto),
      'ind_estado',   migration.clean_text(a.ind_estado),
      'ind_registro', migration.clean_text(a.ind_registro),
      'moneda_texto', migration.clean_text(a.moneda),
      'clave_costo',  migration.clean_text(a.clave),
      'pc_registro',  migration.clean_text(a.pc_registro),
      'arroba_en_nombre',
        CASE WHEN a.nombre ~ '^\s*@' OR a.descripcion ~ '^\s*@' THEN 'si' END
    ))                                              AS legacy_flags
  FROM legacy.almacen_articulo a
  WHERE migration.clean_text(a.codigo_articulo) IS NOT NULL
)
SELECT b.*,
       mm.material_id,
       mm.product_kind,
       mm.category_root,
       mc.category_id,
       -- MEDIDA es talla de aro sólo en sortijas (S) y argollas (G)
       CASE WHEN b.ala IN ('S','G') AND b.medida_num BETWEEN 3 AND 35
            THEN b.medida_num END                   AS ring_size,
       -- medidas extraíbles de la descripción, con reglas explícitas:
       --   "19*19cm"  → ancho y alto      ·   "alt 6.4cm" → alto
       CASE WHEN b.raw_desc ~* '([0-9]+(\.[0-9]+)?)\s*[*x×]\s*([0-9]+(\.[0-9]+)?)\s*cm'
            THEN (regexp_match(b.raw_desc,
                   '([0-9]+(?:\.[0-9]+)?)\s*[*x×]\s*([0-9]+(?:\.[0-9]+)?)\s*cm','i'))[1]::numeric * 10
       END                                          AS desc_width_mm,
       CASE WHEN b.raw_desc ~* '([0-9]+(\.[0-9]+)?)\s*[*x×]\s*([0-9]+(\.[0-9]+)?)\s*cm'
            THEN (regexp_match(b.raw_desc,
                   '([0-9]+(?:\.[0-9]+)?)\s*[*x×]\s*([0-9]+(?:\.[0-9]+)?)\s*cm','i'))[2]::numeric * 10
            WHEN b.raw_desc ~* 'alt[a-z.]*\s*([0-9]+(\.[0-9]+)?)\s*cm'
            THEN (regexp_match(b.raw_desc,
                   'alt[a-z.]*\s*([0-9]+(?:\.[0-9]+)?)\s*cm','i'))[1]::numeric * 10
       END                                          AS desc_height_mm,
       -- "con 20 pi 2.5 mm" → 20 piedras de 2.5 mm
       -- OJO: en PostgreSQL el límite de palabra es \M / \y, NO \b (que es backspace)
       -- hasta 6 cifras: un número más largo es basura y desbordaría el ::int
       CASE WHEN b.raw_desc ~* '\m([0-9]{1,6})\s*pi\M'
            THEN (regexp_match(b.raw_desc, '\m([0-9]{1,6})\s*pi\M','i'))[1]::int END AS desc_stone_qty,
       CASE WHEN b.raw_desc ~* '([0-9]+(\.[0-9]+)?)\s*mm'
            THEN (regexp_match(b.raw_desc, '([0-9]+(?:\.[0-9]+)?)\s*mm','i'))[1]::numeric END
                                                    AS desc_stone_mm,
       ms.stone_id,
       mcol.color_code      AS v2_color_code,
       mcol.stone_id        AS color_as_stone_id,
       COALESCE(mcol.is_none, false) AS color_is_none,
       CASE WHEN mmc.is_junk THEN NULL ELSE mmc.primary_code   END AS metal_primary,
       CASE WHEN mmc.is_junk THEN NULL ELSE mmc.secondary_code END AS metal_secondary,
       CASE WHEN mmc.is_junk THEN NULL ELSE mmc.extra_codes    END AS metal_extra
FROM base b
LEFT JOIN migration.map_material    mm   ON mm.legacy_code = b.mat_letter
LEFT JOIN migration.map_category    mc   ON mc.legacy_ala = b.ala AND mc.legacy_cla = b.cla
LEFT JOIN migration.map_stone       ms   ON ms.legacy_clase = b.clase_piedra
LEFT JOIN migration.map_color       mcol ON mcol.legacy_code = b.color_code
LEFT JOIN migration.map_metal_color mmc  ON mmc.legacy_id = b.color_metal_id;

CREATE INDEX article_stage_legacy_idx ON migration.article_stage (legacy_code);
CREATE INDEX article_stage_group_idx
  ON migration.article_stage (mat_letter, ala, cla, base_name, desc_fp);

-- -----------------------------------------------------------------------------
-- 2. cuarentena: filas con datos imposibles entran como 'draft', no se corrigen
-- -----------------------------------------------------------------------------
ALTER TABLE migration.article_stage ADD COLUMN quarantine text[] DEFAULT '{}';

-- peso ínfimo con precio alto (caso AWS25: 0.1 g y S/ 1632)
UPDATE migration.article_stage
   SET quarantine = array_append(quarantine, 'peso_vs_precio')
 WHERE peso IS NOT NULL AND peso <= 0.2 AND COALESCE(precio,0) > 100;

-- peso exactamente 1 repetido en todo un grupo (caso BWS1..BWS13)
UPDATE migration.article_stage s
   SET quarantine = array_append(quarantine, 'peso_sospechoso_uniforme')
 WHERE peso = 1
   AND (SELECT count(*) FROM migration.article_stage s2
        WHERE s2.mat_letter = s.mat_letter AND s2.ala = s.ala AND s2.cla = s.cla
          AND s2.peso = 1) >= 5;

UPDATE migration.article_stage SET quarantine = array_append(quarantine, 'sin_peso')
 WHERE peso IS NULL OR peso <= 0;

UPDATE migration.article_stage SET quarantine = array_append(quarantine, 'fecha_futura')
 WHERE GREATEST(COALESCE(fecha_registro, '-infinity'::timestamptz),
                COALESCE(fecha_ingreso,  '-infinity'::timestamptz)) > now();

UPDATE migration.article_stage SET quarantine = array_append(quarantine, 'sin_precio')
 WHERE COALESCE(precio, 0) <= 0;

UPDATE migration.article_stage SET quarantine = array_append(quarantine, 'sin_material')
 WHERE material_id IS NULL AND product_kind = 'jewelry';

-- medida que no se pudo interpretar: no se tira, queda en legacy_flags
UPDATE migration.article_stage SET quarantine = array_append(quarantine, 'medida_sin_interpretar')
 WHERE medida_raw IS NOT NULL AND ring_size IS NULL AND medida_raw <> '0';

-- -----------------------------------------------------------------------------
-- detector de columnas corridas: segunda línea de defensa
-- Si alguien carga un CSV sin pasar por 020_prepare_csv.ps1, una descripción con
-- comas corre los valores siguientes. Se nota porque PESO deja de ser numérico,
-- ACTIVO deja de ser y/n, o MONEDA deja de ser un nombre de moneda.
-- -----------------------------------------------------------------------------
UPDATE migration.article_stage s
   SET quarantine = array_append(quarantine, 'columnas_corridas')
 WHERE EXISTS (
   SELECT 1 FROM legacy.almacen_articulo a
   WHERE btrim(a.codigo_articulo) = s.legacy_code
     AND (
       -- PESO con texto no numérico
       (migration.clean_text(a.peso) IS NOT NULL AND migration.to_numeric(a.peso) IS NULL)
       -- ACTIVO fuera de y/n/1/0
       OR (migration.clean_text(a.activo) IS NOT NULL AND migration.to_bool(a.activo) IS NULL)
       -- MONEDA que no es una moneda
       OR (migration.clean_text(a.moneda) IS NOT NULL
           AND lower(btrim(a.moneda)) NOT IN ('soles','dolares','dólares','euro','euros','0'))
       -- PRECIO con texto
       OR (migration.clean_text(a.precio) IS NOT NULL AND migration.to_numeric(a.precio) IS NULL)
     ));

SELECT migration.log_exception('error','catalog','columnas_corridas', s.legacy_code,
         'las columnas de esta fila están corridas: el export CSV no entrecomilla los textos con comas. Hay que re-exportar desde SQL Server (021_export_from_sqlserver.js).',
         jsonb_build_object('peso_crudo', a.peso, 'activo_crudo', a.activo,
                            'moneda_cruda', a.moneda, 'descripcion', a.descripcion))
FROM migration.article_stage s
JOIN legacy.almacen_articulo a ON btrim(a.codigo_articulo) = s.legacy_code
WHERE 'columnas_corridas' = ANY(s.quarantine);

SELECT migration.log_exception(
         CASE WHEN 'peso_vs_precio' = ANY(quarantine) THEN 'error' ELSE 'warning' END,
         'catalog', q.rule, s.legacy_code,
         format('%s (peso=%s, precio=%s, medida=%s)',
                q.rule, COALESCE(s.peso::text,'NULL'),
                COALESCE(s.precio::text,'NULL'), COALESCE(s.medida_raw,'NULL')),
         jsonb_build_object('peso', s.peso, 'precio', s.precio,
                            'medida', s.medida_raw, 'nombre', s.raw_name))
FROM migration.article_stage s
CROSS JOIN LATERAL unnest(s.quarantine) AS q(rule)
WHERE cardinality(s.quarantine) > 0;

-- -----------------------------------------------------------------------------
-- 3. productos: un grupo = material + tipo + clase + nombre base + descripción
--    Dos artículos sólo se unen si describen LO MISMO. Distinta descripción o
--    distinto precio = productos distintos (así Tiaraz, Tiaraz1 y Tiaraz2 no se
--    fusionan por error, pero ASD1..ASD6 sí).
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS migration.product_group CASCADE;
CREATE TABLE migration.product_group AS
SELECT row_number() OVER (ORDER BY mat_letter, ala, cla, base_name, desc_fp, precio) AS grp,
       mat_letter, ala, cla, base_name, desc_fp, precio,
       min(legacy_code)                                   AS rep_legacy_code,
       count(*)                                           AS article_count,
       (array_agg(raw_name ORDER BY legacy_code))[1]      AS rep_name,
       (array_agg(raw_desc ORDER BY legacy_code))[1]      AS rep_desc,
       (array_agg(material_id ORDER BY legacy_code))[1]   AS material_id,
       (array_agg(product_kind ORDER BY legacy_code))[1]  AS product_kind,
       (array_agg(category_id ORDER BY legacy_code))[1]   AS category_id,
       (array_agg(category_root ORDER BY legacy_code))[1] AS category_root,
       (array_agg(desc_width_mm ORDER BY legacy_code))[1] AS width_mm,
       (array_agg(desc_height_mm ORDER BY legacy_code))[1] AS height_mm,
       avg(peso)                                          AS avg_peso,
       bool_or(favorito)                                  AS any_favorito,
       bool_and(COALESCE(activo, false))                  AS all_activo,
       bool_or(COALESCE(dejar_usar, false))               AS any_dejar_usar,
       min(fecha_ingreso)                                 AS first_ingreso,
       bool_or(cardinality(quarantine) > 0)               AS any_quarantine,
       bool_or(ring_size IS NOT NULL)                     AS has_ring_size
FROM migration.article_stage
GROUP BY mat_letter, ala, cla, base_name, desc_fp, precio;

ALTER TABLE migration.product_group ADD COLUMN product_id bigint;
ALTER TABLE migration.product_group ADD COLUMN product_code text;

-- código de producto: prefijo del legacy + secuencia cuando el prefijo se repite.
-- La secuencia se cuenta sobre el PREFIJO YA ARMADO, no sobre las tres letras:
-- con los datos reales, combinaciones distintas escriben el mismo texto
-- ('o'+'A'+'M' y 'O'+'A'+'M', o 'OA'+'M'+'' y 'O'+'AM'+'') y numeraban cada una
-- desde 001: "llave duplicada (code)=(OAM-126)". Letras vacías o NULL no anulan
-- el código (NULL || 'x' es NULL); sin ninguna letra, el prefijo es ART.
UPDATE migration.product_group g
   SET product_code = cnt.prefix ||
       CASE WHEN cnt.n > 1
            THEN '-' || lpad(cnt.row_num::text, 3, '0')
            ELSE '' END
FROM (
  SELECT grp, p.prefix,
         row_number() OVER (PARTITION BY p.prefix ORDER BY grp) AS row_num,
         count(*)    OVER (PARTITION BY p.prefix)               AS n
  FROM migration.product_group
  CROSS JOIN LATERAL (
    SELECT COALESCE(NULLIF(upper(regexp_replace(
             COALESCE(mat_letter, '') || COALESCE(ala, '') || COALESCE(cla, ''),
             '[^[:alnum:]Ññ]', '', 'g')), ''), 'ART') AS prefix
  ) p
) cnt
WHERE cnt.grp = g.grp;

-- red de seguridad: si aun así dos grupos quedaran con el mismo código (un
-- prefijo 'OAM-1' que coincida con 'OAM' + secuencia), el número de grupo desempata
UPDATE migration.product_group g
   SET product_code = g.product_code || '-G' || g.grp
FROM (SELECT product_code FROM migration.product_group
      GROUP BY product_code HAVING count(*) > 1) d
WHERE d.product_code = g.product_code;

INSERT INTO catalog.product (
  code, slug, name, kind, status, long_desc, material_id,
  nominal_weight_g, width_mm, height_mm, size_scale_id,
  default_tracking_mode, launched_on, specs, legacy_code, created_by)
SELECT g.product_code,
       core.slugify(COALESCE(g.rep_name, g.product_code)) || '-' || lower(g.product_code),
       COALESCE(regexp_replace(g.rep_name, '^\s*@+', ''), g.product_code),
       COALESCE(g.product_kind, 'other'),
       CASE WHEN g.any_quarantine        THEN 'draft'::catalog.product_status
            WHEN g.any_dejar_usar        THEN 'discontinued'
            WHEN NOT g.all_activo        THEN 'draft'
            ELSE 'active' END,
       g.rep_desc,
       g.material_id,
       -- los CHECK de catalog.product exigen > 0 (>= 0 el peso): un 0 o un negativo
       -- del legacy queda vacío en vez de cortar la migración entera
       CASE WHEN g.avg_peso >= 0 AND g.avg_peso < 1e8 THEN round(g.avg_peso, 3) END,
       CASE WHEN g.width_mm  > 0 AND g.width_mm  < 1e7 THEN g.width_mm  END,
       CASE WHEN g.height_mm > 0 AND g.height_mm < 1e7 THEN g.height_mm END,
       CASE WHEN g.has_ring_size
            THEN (SELECT id FROM catalog.size_scale WHERE code = 'aro_pe') END,
       'quantity',
       CASE WHEN g.first_ingreso <= now() THEN g.first_ingreso::date END,
       jsonb_build_object('grupo_migracion', g.grp,
                          'articulos_legacy', g.article_count),
       g.mat_letter || g.ala || g.cla,
       1
FROM migration.product_group g;

UPDATE migration.product_group g
   SET product_id = p.id
FROM catalog.product p WHERE p.code = g.product_code;

-- categoría primaria
INSERT INTO catalog.product_category (product_id, category_id, is_primary)
SELECT g.product_id,
       COALESCE(g.category_id, (SELECT id FROM catalog.category WHERE slug = g.category_root)),
       true
FROM migration.product_group g
WHERE COALESCE(g.category_id, (SELECT id FROM catalog.category WHERE slug = g.category_root)) IS NOT NULL
ON CONFLICT DO NOTHING;

-- FAVORITO deja de ser una bandera suelta y pasa a ser un tag
INSERT INTO catalog.tag (slug, name, kind) VALUES ('favorito','Favorito','other')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO catalog.product_tag (product_id, tag_id)
SELECT g.product_id, (SELECT id FROM catalog.tag WHERE slug = 'favorito')
FROM migration.product_group g WHERE g.any_favorito
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. variantes: una por cada combinación real (producto + talla + color)
--    Varios CODIGO_ARTICULO pueden caer en la misma: ver 4b.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS migration.variant_stage CASCADE;
CREATE TABLE migration.variant_stage AS
WITH v AS (
  SELECT s.legacy_code,
         g.product_id,
         g.product_code,
         (SELECT sv.id FROM catalog.size_value sv
           JOIN catalog.size_scale ss ON ss.id = sv.size_scale_id
          WHERE ss.code = 'aro_pe' AND sv.value = s.ring_size)          AS size_value_id,
         CASE WHEN s.ring_size IS NULL AND s.medida_raw IS NOT NULL AND s.medida_raw <> '0'
              THEN s.medida_raw END                                     AS size_label,
         s.ring_size,
         s.v2_color_code,
         s.metal_primary,
         s.metal_secondary,
         CASE WHEN s.peso > 0 AND s.peso < 1e8 THEN s.peso END          AS weight_g,
         CASE WHEN abs(s.stock) < 1e10 THEN s.stock END                 AS stock,
         CASE WHEN cardinality(s.quarantine) > 0 THEN 'draft'::catalog.product_status
              WHEN COALESCE(s.dejar_usar, false) THEN 'discontinued'
              WHEN NOT COALESCE(s.activo, false) THEN 'draft'
              ELSE 'active' END                                         AS status
  FROM migration.article_stage s
  JOIN migration.product_group g
    -- IS NOT DISTINCT FROM y no '=': con una letra NULL, '=' dejaba al artículo
    -- sin variante (y fuera de la migración) sin avisar
    ON  g.mat_letter IS NOT DISTINCT FROM s.mat_letter
    AND g.ala        IS NOT DISTINCT FROM s.ala
    AND g.cla        IS NOT DISTINCT FROM s.cla
    AND g.base_name IS NOT DISTINCT FROM s.base_name
    AND g.desc_fp   IS NOT DISTINCT FROM s.desc_fp
    AND g.precio    IS NOT DISTINCT FROM s.precio
), keyed AS (
  SELECT v.*,
         -- clave real de la variante: producto + talla + color de metal
         row_number() OVER (w ORDER BY v.legacy_code) = 1           AS is_representative,
         first_value(v.legacy_code) OVER (w ORDER BY v.legacy_code) AS rep_legacy_code,
         count(*) OVER (w)                                          AS pieces,
         dense_rank() OVER (PARTITION BY v.product_id
                            ORDER BY COALESCE(v.size_value_id, -1),
                                     COALESCE(v.size_label, ''),
                                     COALESCE(v.metal_primary, ''),
                                     COALESCE(v.v2_color_code, '')) AS combo_rank,
         upper(v.product_code
               || COALESCE('-' || rtrim(trim(to_char(v.ring_size, 'FM999.9')), '.'), '')
               || COALESCE('-' || regexp_replace(upper(v.size_label), '[^A-Z0-9]', '', 'g'), '')
               || COALESCE('-' || left(upper(v.v2_color_code), 3), '')
               || COALESCE('-' || left(upper(v.metal_primary), 3), '')) AS sku_base
  FROM v
  WINDOW w AS (PARTITION BY v.product_id,
                            COALESCE(v.size_value_id, -1),
                            COALESCE(v.size_label, ''),
                            COALESCE(v.metal_primary, ''),
                            COALESCE(v.v2_color_code, ''))
)
SELECT k.*,
       -- si dos variantes distintas generan el mismo texto, se desempata con el
       -- código viejo de la variante: es único y la gente de tienda lo reconoce.
       -- (combo_rank no servía: se cuenta por producto, y dos productos distintos
       -- con el mismo texto terminaban ambos en '-01')
       CASE WHEN count(*) OVER (PARTITION BY k.sku_base) > k.pieces
            THEN k.sku_base || '-' || upper(regexp_replace(k.rep_legacy_code, '[^[:alnum:]]', '', 'g'))
            ELSE k.sku_base END AS sku
FROM keyed k;

CREATE INDEX variant_stage_legacy_idx ON migration.variant_stage (legacy_code);

-- red de seguridad: catalog.variant.sku es UNIQUE y un choque corta toda la
-- migración. Si dos variantes distintas (distinto artículo representante)
-- quedaron con el mismo SKU, la segunda en adelante lleva un número.
WITH reps AS (
  SELECT DISTINCT sku, rep_legacy_code FROM migration.variant_stage
), d AS (
  SELECT sku, rep_legacy_code,
         row_number() OVER (PARTITION BY sku ORDER BY rep_legacy_code) AS r
  FROM reps
)
UPDATE migration.variant_stage v
   SET sku = v.sku || '-' || d.r
FROM d
WHERE d.r > 1 AND d.sku = v.sku AND d.rep_legacy_code = v.rep_legacy_code;

INSERT INTO catalog.variant (
  product_id, sku, size_value_id, size_label, metal_color, secondary_metal_color,
  stone_color, weight_g, tracking_mode, status, legacy_code, created_by)
SELECT product_id, sku, size_value_id, size_label, metal_primary, metal_secondary,
       v2_color_code, weight_g, 'quantity', status, legacy_code, 1
FROM migration.variant_stage
WHERE is_representative;

-- -----------------------------------------------------------------------------
-- 4b. artículos duplicados: el legacy tenía varias filas para la MISMA variante
--     (mismo modelo, misma medida, mismo precio) que en realidad son PIEZAS
--     distintas, con pesos distintos. Ejemplo: CHI114 y CHI115, ambos "Cochola"
--     de 30 cm, uno de 250 g y el otro de 256.5 g.
--     No se botan ni se fuerzan como variantes falsas: quedan como alias de la
--     variante, y sus pesos se registran para crear las piezas al contar.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS migration.variant_alias CASCADE;
CREATE TABLE migration.variant_alias (
  legacy_code       text PRIMARY KEY,
  variant_id        bigint NOT NULL REFERENCES catalog.variant(id),
  is_representative boolean NOT NULL,
  peso              numeric(12,3),
  stock_legacy      numeric(14,3)
);

INSERT INTO migration.variant_alias (legacy_code, variant_id, is_representative, peso, stock_legacy)
SELECT vs.legacy_code, v.id, vs.is_representative, vs.weight_g, vs.stock
FROM migration.variant_stage vs
JOIN catalog.variant v ON v.legacy_code = vs.rep_legacy_code;

SELECT migration.log_exception('warning','catalog','articulo_duplicado', a.legacy_code,
         format('el legacy tenía otra fila idéntica (%s): son piezas distintas del mismo modelo, no variantes. Pesos: %s',
                v.legacy_code,
                (SELECT string_agg(DISTINCT a2.peso::text, ' / ')
                 FROM migration.variant_alias a2 WHERE a2.variant_id = a.variant_id)),
         jsonb_build_object('variante', v.sku, 'peso', a.peso))
FROM migration.variant_alias a
JOIN catalog.variant v ON v.id = a.variant_id
WHERE NOT a.is_representative;

-- una variante por defecto por producto
UPDATE catalog.variant v SET is_default = true
WHERE v.id = (SELECT v2.id FROM catalog.variant v2
              WHERE v2.product_id = v.product_id
              ORDER BY v2.size_value_id NULLS LAST, v2.id LIMIT 1);

-- color de metal con 3 o más colores: el detalle completo va a un atributo,
-- para no perder el 'N+A+B+R' del legacy
INSERT INTO catalog.attribute (code, name, type, scope)
VALUES ('colores_metal_legacy','Colores de metal (legacy)','text','variant')
ON CONFLICT (code) DO NOTHING;

INSERT INTO catalog.variant_attribute_value (variant_id, attribute_id, value_text)
SELECT v.id,
       (SELECT id FROM catalog.attribute WHERE code = 'colores_metal_legacy'),
       array_to_string(
         array_remove(ARRAY[s.metal_primary, s.metal_secondary] || s.metal_extra, NULL), '+')
FROM migration.article_stage s
JOIN catalog.variant v ON v.legacy_code = s.legacy_code
WHERE s.metal_extra IS NOT NULL AND cardinality(s.metal_extra) > 0
ON CONFLICT DO NOTHING;

-- decisión 4: oro y platino van serializados; plata y acero por cantidad
UPDATE catalog.variant v
   SET tracking_mode = 'serial'
FROM catalog.product p
JOIN catalog.material m ON m.id = p.material_id
WHERE p.id = v.product_id AND m.family IN ('gold','platinum');

UPDATE catalog.product p
   SET default_tracking_mode = 'serial'
FROM catalog.material m
WHERE m.id = p.material_id AND m.family IN ('gold','platinum');

SELECT migration.log_exception('info','catalog','tracking_serial', NULL,
         format('%s variante(s) quedaron serializadas (oro/platino); %s por cantidad',
                count(*) FILTER (WHERE tracking_mode = 'serial'),
                count(*) FILTER (WHERE tracking_mode = 'quantity')), '{}')
FROM catalog.variant;

-- -----------------------------------------------------------------------------
-- 5. piedras: lo que estaba en 6 columnas + lo que estaba en la descripción
-- -----------------------------------------------------------------------------
INSERT INTO catalog.variant_stone (
  variant_id, stone_id, color_code, quantity, size_mm, unit_cost, cost_currency, notes)
SELECT v.id,
       COALESCE(s.stone_id, s.color_as_stone_id),
       s.v2_color_code,
       -- CHECK quantity > 0 y size_mm > 0: "0 pi" o "0 mm" no pueden cortar todo
       CASE WHEN s.desc_stone_qty > 0 THEN s.desc_stone_qty ELSE 1 END,
       (SELECT x FROM (VALUES (s.medida_piedra), (s.desc_stone_mm)) m(x)
         WHERE x > 0 AND x < 1e6 LIMIT 1),
       CASE WHEN s.precio_piedra > 0 THEN s.precio_piedra END,
       CASE WHEN s.precio_piedra > 0 THEN 'PEN' END,
       CASE WHEN s.desc_stone_qty IS NOT NULL
            THEN 'cantidad y medida extraídas de la descripción del legacy' END
FROM migration.article_stage s
JOIN catalog.variant v ON v.legacy_code = s.legacy_code
WHERE COALESCE(s.stone_id, s.color_as_stone_id) IS NOT NULL
  AND NOT s.color_is_none
  AND COALESCE(s.clase_piedra, 0) <> 19;      -- 19 = NINGUNO: sin piedra, sin fila

-- artículos que decían tener piedra pero su clase no se pudo mapear
SELECT migration.log_exception('warning','catalog','piedra_no_migrada', s.legacy_code,
         format('clase de piedra %s sin equivalente: la variante queda sin piedra',
                s.clase_piedra),
         jsonb_build_object('clase', s.clase_piedra, 'color', s.color_code))
FROM migration.article_stage s
WHERE s.clase_piedra IS NOT NULL AND s.clase_piedra <> 19 AND s.stone_id IS NULL
  AND s.color_as_stone_id IS NULL;

-- -----------------------------------------------------------------------------
-- 6. imágenes: la ruta local queda registrada, el archivo hay que subirlo
-- -----------------------------------------------------------------------------
INSERT INTO catalog.media (variant_id, kind, storage_key, url, alt_text, is_primary, legacy_path)
SELECT v.id, 'image',
       'pendiente/' || migration.image_basename(s.imagen),
       'pendiente://' || migration.image_basename(s.imagen),
       COALESCE(s.raw_name, s.legacy_code),
       true,
       s.imagen
FROM migration.article_stage s
JOIN catalog.variant v ON v.legacy_code = s.legacy_code
WHERE migration.image_basename(s.imagen) IS NOT NULL;

-- la foto de un artículo duplicado, si es distinta, se guarda como secundaria
INSERT INTO catalog.media (variant_id, kind, storage_key, url, alt_text, is_primary, legacy_path)
SELECT a.variant_id, 'image',
       'pendiente/' || migration.image_basename(s.imagen),
       'pendiente://' || migration.image_basename(s.imagen),
       COALESCE(s.raw_name, s.legacy_code), false, s.imagen
FROM migration.variant_alias a
JOIN migration.article_stage s ON s.legacy_code = a.legacy_code
WHERE NOT a.is_representative
  AND migration.image_basename(s.imagen) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM catalog.media m
                  WHERE m.variant_id = a.variant_id
                    AND m.legacy_path = s.imagen);

SELECT migration.log_exception('warning','catalog','imagen_pendiente_subida', NULL,
         format('%s imagen(es) referenciadas con ruta local: hay que subirlas a Cloudinary y actualizar storage_key/url',
                count(*)), '{}')
FROM catalog.media WHERE storage_key LIKE 'pendiente/%';

SELECT migration.log_exception('warning','catalog','sin_imagen', s.legacy_code,
         'el artículo no tiene imagen en el legacy', '{}')
FROM migration.article_stage s
WHERE migration.image_basename(s.imagen) IS NULL;

-- -----------------------------------------------------------------------------
-- 7. banderas y proveedor
-- -----------------------------------------------------------------------------
UPDATE catalog.product p
   SET legacy_flags = agg.flags
FROM (
  SELECT g.product_id,
         jsonb_object_agg(s.legacy_code, s.legacy_flags) AS flags
  FROM migration.article_stage s
  JOIN catalog.variant v ON v.legacy_code = s.legacy_code
  JOIN migration.product_group g ON g.product_id = v.product_id
  GROUP BY g.product_id
) agg
WHERE p.id = agg.product_id;

SELECT migration.log_exception('info','catalog','proveedor_vacio', NULL,
         format('COD_PROVEEDOR está vacío en %s de %s artículos: no hay trazabilidad de compra que migrar',
                count(*) FILTER (WHERE cod_proveedor IS NULL), count(*)), '{}')
FROM migration.article_stage;

COMMIT;

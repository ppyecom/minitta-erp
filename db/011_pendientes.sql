-- =============================================================================
-- ERP v2 — 011: qué le falta a cada artículo para poder venderse
--
-- La migración trae del ERP viejo lo que está bien formado como `active` y lo
-- dudoso como `draft`. Esta vista es el otro lado de esa decisión: la lista de
-- trabajo del personal, para que un borrador no se quede en borrador para
-- siempre porque nadie sabe qué le falta.
--
-- Se calcula sobre el dato de HOY, no sobre lo que pasó en la importación: en
-- cuanto alguien carga el peso que faltaba, la variante sale sola de la lista.
-- Por eso no depende del esquema `migration`, que solo existe después de cargar.
-- =============================================================================

-- precio por gramo por encima del cual el par peso/precio es sospechoso.
-- Salió del legacy: AWS25 con 0.1 g declarado y S/ 1632 de precio.
INSERT INTO core.app_setting (location_id, key, value)
VALUES (NULL, 'catalog.max_price_per_gram', '2000'::jsonb)
ON CONFLICT (location_id, key) DO NOTHING;

CREATE OR REPLACE FUNCTION catalog.max_price_per_gram() RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT value::text::numeric FROM core.app_setting
                    WHERE location_id IS NULL AND key = 'catalog.max_price_per_gram'), 2000);
$$;

CREATE OR REPLACE VIEW catalog.v_pending AS
WITH base AS (
  SELECT v.id                                   AS variant_id,
         v.sku,
         v.legacy_code,
         v.size_label,
         v.size_value_id,
         v.status                               AS variant_status,
         p.id                                   AS product_id,
         p.code                                 AS product_code,
         p.name                                 AS product_name,
         p.status                               AS product_status,
         p.material_id,
         p.size_scale_id,
         p.legacy_flags,
         COALESCE(v.weight_g, p.nominal_weight_g) AS weight_g,
         mat.name                               AS material_name,
         cat.name                               AS category_name,
         pc.category_id,
         (SELECT md.url FROM catalog.media md
           WHERE (md.variant_id = v.id OR md.product_id = p.id) AND md.kind = 'image'
           ORDER BY md.is_primary DESC, md.sort_order, md.id LIMIT 1) AS image_url,
         (SELECT pr.amount FROM pricing.price pr
            JOIN pricing.price_list pl ON pl.id = pr.price_list_id AND pl.code = 'publico'
           WHERE pr.variant_id = v.id
             AND pr.valid_from <= now()
             AND (pr.valid_to IS NULL OR pr.valid_to > now())
           ORDER BY pr.valid_from DESC LIMIT 1) AS price
    FROM catalog.variant v
    JOIN catalog.product p ON p.id = v.product_id
    LEFT JOIN catalog.material mat ON mat.id = p.material_id
    LEFT JOIN catalog.product_category pc ON pc.product_id = p.id AND pc.is_primary
    LEFT JOIN catalog.category cat ON cat.id = pc.category_id
   WHERE p.status <> 'archived' AND v.status <> 'archived'
),
flagged AS (
  SELECT b.*,
         ARRAY_REMOVE(ARRAY[
           CASE WHEN b.weight_g IS NULL OR b.weight_g <= 0      THEN 'sin_peso' END,
           CASE WHEN b.price IS NULL                            THEN 'sin_precio' END,
           CASE WHEN b.material_id IS NULL                      THEN 'sin_material' END,
           CASE WHEN b.category_id IS NULL                      THEN 'sin_categoria' END,
           CASE WHEN b.image_url IS NULL
                  OR b.image_url LIKE 'pendiente/%'             THEN 'sin_foto' END,
           -- la talla llegó como texto libre ("5.5*4") en un producto que usa escala
           CASE WHEN b.size_scale_id IS NOT NULL
                 AND b.size_value_id IS NULL
                 AND b.size_label IS NOT NULL                   THEN 'medida_sin_interpretar' END,
           -- el par peso/precio no cierra: uno de los dos está mal cargado
           CASE WHEN b.weight_g > 0 AND b.price IS NOT NULL
                 AND b.price / b.weight_g > catalog.max_price_per_gram()
                                                                THEN 'peso_vs_precio' END
         ], NULL) AS reasons
    FROM base b
)
SELECT f.variant_id,
       f.sku,
       f.legacy_code,
       f.product_id,
       f.product_code,
       f.product_name,
       f.product_status,
       f.variant_status,
       f.material_name,
       f.category_name,
       f.weight_g,
       f.price,
       f.image_url,
       f.legacy_flags,
       -- un borrador sin ningún motivo concreto igual hay que revisarlo
       CASE WHEN cardinality(f.reasons) = 0 AND f.product_status = 'draft'
            THEN ARRAY['sin_revisar']
            ELSE f.reasons END                          AS reasons,
       -- lo que bloquea la venta: el producto está en borrador
       (f.product_status = 'draft')                     AS blocks_sale
  FROM flagged f
 WHERE cardinality(f.reasons) > 0 OR f.product_status = 'draft';

COMMENT ON VIEW catalog.v_pending IS
  'Lista de trabajo: qué le falta a cada variante. Una variante sale sola de acá cuando se completa el dato.';

-- =============================================================================
-- ERP v2 — migración 070: reporte de la corrida
-- Esto es lo que se revisa con la gente de tienda ANTES de cargar en producción.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vistas para exportar y revisar
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW migration.v_exception_summary AS
SELECT stage, severity, rule, count(*) AS casos,
       min(message) AS ejemplo
FROM migration.exception
GROUP BY stage, severity, rule
ORDER BY CASE severity WHEN 'error' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
         stage, count(*) DESC;

-- las variantes que quedaron bloqueadas y por qué
CREATE OR REPLACE VIEW migration.v_cuarentena AS
SELECT s.legacy_code,
       v.sku,
       p.code AS product_code,
       s.raw_name,
       s.peso,
       s.precio,
       s.medida_raw,
       s.quarantine AS motivos,
       v.status
FROM migration.article_stage s
JOIN catalog.variant v ON v.legacy_code = s.legacy_code
JOIN catalog.product p ON p.id = v.product_id
WHERE cardinality(s.quarantine) > 0
ORDER BY cardinality(s.quarantine) DESC, s.legacy_code;

-- qué artículos se agruparon en qué producto (lo más importante de revisar)
CREATE OR REPLACE VIEW migration.v_agrupacion AS
SELECT p.code AS product_code,
       p.name AS product_name,
       p.status,
       count(v.id) AS variantes,
       string_agg(v.legacy_code, ', ' ORDER BY v.legacy_code) AS codigos_legacy,
       string_agg(DISTINCT COALESCE(sv.label,'-'), ', ') AS tallas
FROM catalog.product p
JOIN catalog.variant v ON v.product_id = p.id
LEFT JOIN catalog.size_value sv ON sv.id = v.size_value_id
GROUP BY p.id, p.code, p.name, p.status
HAVING count(v.id) > 1
ORDER BY count(v.id) DESC, p.code;

-- el descuadre de stock que hay que resolver contando
CREATE OR REPLACE VIEW migration.v_descuadres_stock AS
SELECT ls.legacy_code, v.sku, l.code AS sede,
       ls.stock_en_stocks, ls.stock_en_articulo, ls.discrepancia
FROM migration.legacy_stock_snapshot ls
LEFT JOIN catalog.variant v ON v.id = ls.variant_id
LEFT JOIN core.location l ON l.id = ls.location_id
WHERE COALESCE(ls.discrepancia, 0) <> 0
ORDER BY abs(ls.discrepancia) DESC;

-- -----------------------------------------------------------------------------
-- resumen en pantalla
-- -----------------------------------------------------------------------------
\echo ''
\echo '================ RESULTADO DE LA MIGRACIÓN ================'
\echo ''
\echo '--- qué se cargó'
SELECT 'artículos leídos del legacy' AS concepto, count(*)::text AS valor FROM migration.article_stage
UNION ALL SELECT 'productos creados',        count(*)::text FROM catalog.product
UNION ALL SELECT 'variantes creadas',        count(*)::text FROM catalog.variant
UNION ALL SELECT '  de ellas, serializadas', count(*)::text FROM catalog.variant WHERE tracking_mode = 'serial'
UNION ALL SELECT '  de ellas, en borrador',  count(*)::text FROM catalog.variant WHERE status = 'draft'
UNION ALL SELECT 'piedras registradas',      count(*)::text FROM catalog.variant_stone
UNION ALL SELECT '  piedras totales (suma)', COALESCE(sum(quantity),0)::text FROM catalog.variant_stone
UNION ALL SELECT 'precios creados',          count(*)::text FROM pricing.price
UNION ALL SELECT 'costos creados',           count(*)::text FROM pricing.variant_cost
UNION ALL SELECT 'imágenes referenciadas',   count(*)::text FROM catalog.media
UNION ALL SELECT 'categorías en el árbol',   count(*)::text FROM catalog.category
UNION ALL SELECT 'sedes activas',            count(*)::text FROM core.location WHERE is_active
UNION ALL SELECT 'conteos de apertura',      count(*)::text FROM inventory.count_sheet WHERE is_opening
UNION ALL SELECT 'MOVIMIENTOS DE STOCK',     count(*)::text FROM inventory.movement;

\echo ''
\echo '--- agrupación: artículos del legacy que resultaron ser el mismo producto'
SELECT product_code, product_name, variantes, codigos_legacy, tallas
FROM migration.v_agrupacion LIMIT 15;

\echo ''
\echo '--- excepciones por regla (esto es lo que hay que revisar)'
SELECT severity, stage, rule, casos FROM migration.v_exception_summary;

\echo ''
\echo '--- errores que bloquean (requieren decisión de la empresa)'
SELECT rule, casos, ejemplo FROM migration.v_exception_summary WHERE severity = 'error';

\echo ''
\echo '--- variantes en cuarentena (no vendibles hasta revisión)'
SELECT legacy_code, sku, raw_name, peso, precio, motivos FROM migration.v_cuarentena LIMIT 15;

\echo ''
\echo '--- descuadres de stock entre las dos tablas del legacy'
SELECT legacy_code, sede, stock_en_stocks, stock_en_articulo, discrepancia
FROM migration.v_descuadres_stock LIMIT 15;

\echo ''
\echo '--- control de integridad'
SELECT 'variantes sin producto'        AS chequeo,
       count(*)::text AS valor FROM catalog.variant v
       WHERE NOT EXISTS (SELECT 1 FROM catalog.product p WHERE p.id = v.product_id)
UNION ALL
SELECT 'variantes sin categoría',
       count(*)::text FROM catalog.variant v
       JOIN catalog.product p ON p.id = v.product_id
       WHERE NOT EXISTS (SELECT 1 FROM catalog.product_category pc WHERE pc.product_id = p.id)
UNION ALL
SELECT 'códigos legacy duplicados',
       count(*)::text FROM (SELECT legacy_code FROM catalog.variant
                            GROUP BY legacy_code HAVING count(*) > 1) d
UNION ALL
SELECT 'artículos del legacy NO migrados',
       count(*)::text FROM migration.article_stage s
       WHERE NOT EXISTS (SELECT 1 FROM migration.variant_alias a WHERE a.legacy_code = s.legacy_code)
UNION ALL
SELECT 'saldo de stock (debe ser 0)',
       COALESCE(sum(on_hand),0)::text FROM inventory.stock;

\echo ''
\echo '--- cobertura: ningún artículo del legacy se puede quedar afuera'
SELECT s.legacy_code, s.raw_name, 'NO MIGRADO' AS estado
FROM migration.article_stage s
WHERE NOT EXISTS (SELECT 1 FROM migration.variant_alias a WHERE a.legacy_code = s.legacy_code);

\echo ''
\echo '==========================================================='

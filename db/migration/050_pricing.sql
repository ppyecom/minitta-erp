-- =============================================================================
-- ERP v2 — migración 050: precios y costos
-- Regla: la migración NO cambia ningún precio. Los pasa tal cual, en modo
-- 'manual', con vigencia abierta. Cambiar a 'by_weight' o 'by_margin' es una
-- decisión posterior, producto por producto, no algo que el script decida.
-- =============================================================================

BEGIN;

SET LOCAL app.user_id = '1';
SET LOCAL app.client_info = 'migracion legacy->v2';

-- -----------------------------------------------------------------------------
-- 1. precios: una fila por lista, sólo si el legacy tenía un valor usable
-- -----------------------------------------------------------------------------
INSERT INTO pricing.price
  (price_list_id, variant_id, mode, amount, price_per_gram, valid_from, created_by, notes)
SELECT pl.id, v.id, 'manual', d.amount,
       CASE WHEN s.prec_gr > 0 AND s.prec_gr < 1e9 THEN s.prec_gr END,
       -- una fecha de ingreso futura (reloj adelantado del legacy) dejaría el
       -- precio "vigente desde el futuro" y resolve_price() no lo encontraría
       LEAST(COALESCE(s.fecha_ingreso, now()), now()),
       1,
       'migrado del legacy sin modificar'
FROM migration.article_stage s
JOIN catalog.variant v ON v.legacy_code = s.legacy_code
CROSS JOIN LATERAL (VALUES
  ('publico',     s.precio),
  ('comerciante', s.precio_comerciante),
  ('mayorista',   s.precio_mayor)
) AS d(list_code, amount)
JOIN pricing.price_list pl ON pl.code = d.list_code
WHERE d.amount IS NOT NULL AND d.amount > 0 AND d.amount < 1e11;

-- la lista de e-commerce queda VACÍA a propósito: sus precios viven hoy en el
-- Postgres de la tienda online, que es otra fuente. No se inventan acá.
SELECT migration.log_exception('warning','pricing','ecommerce_sin_precios', NULL,
         'la lista "ecommerce" quedó vacía: hay que decidir si copia el precio público o se migra desde el Postgres de la tienda online',
         '{}');

-- precios que el legacy tenía en 0 con porcentaje cargado: inconsistencia real
SELECT migration.log_exception('warning','pricing','precio_en_cero', s.legacy_code,
         format('PRECIO_COMERCIANTE=%s y PRECIO_MAYOR=%s en 0 pero hay precio público %s: no se migró precio para esas listas',
                COALESCE(s.precio_comerciante::text,'NULL'),
                COALESCE(s.precio_mayor::text,'NULL'),
                COALESCE(s.precio::text,'NULL')),
         jsonb_build_object('precio', s.precio,
                            'comerciante', s.precio_comerciante,
                            'mayor', s.precio_mayor))
FROM migration.article_stage s
WHERE COALESCE(s.precio,0) > 0
  AND (COALESCE(s.precio_comerciante,0) = 0 OR COALESCE(s.precio_mayor,0) = 0);

SELECT migration.log_exception('error','pricing','sin_precio_publico', s.legacy_code,
         'el artículo no tiene precio público: la variante no es vendible hasta que se le ponga uno',
         '{}')
FROM migration.article_stage s
WHERE COALESCE(s.precio, 0) <= 0;

-- -----------------------------------------------------------------------------
-- 2. costos: PRECIO_PRODUCTO era costo, no precio
-- -----------------------------------------------------------------------------
INSERT INTO pricing.variant_cost
  (variant_id, metal_cost, stone_cost, other_cost, currency_code, source, valid_from, created_by, notes)
SELECT v.id,
       0,
       -- CHECK >= 0: un costo negativo del legacy queda en 0, no corta la migración
       CASE WHEN s.precio_piedra   > 0 AND s.precio_piedra   < 1e11 THEN s.precio_piedra   ELSE 0 END,
       CASE WHEN s.precio_producto > 0 AND s.precio_producto < 1e11 THEN s.precio_producto ELSE 0 END,
       'PEN',
       'migration',
       LEAST(COALESCE(s.fecha_ingreso, now()), now()),
       1,
       CASE WHEN s.clave IS NOT NULL
            THEN format('CLAVE del legacy sin descifrar: "%s". Revisar contra el costo real.', s.clave)
       END
FROM migration.article_stage s
JOIN catalog.variant v ON v.legacy_code = s.legacy_code
WHERE COALESCE(s.precio_producto, 0) > 0 OR COALESCE(s.precio_piedra, 0) > 0;

-- la CLAVE es el costo codificado en letras: no se puede descifrar sin la tabla
-- de equivalencias, que no está en la base. Queda registrada para que alguien
-- de la empresa la traduzca.
SELECT migration.log_exception('error','pricing','clave_sin_descifrar', NULL,
         format('%s artículo(s) traen el costo codificado en CLAVE (ej. "%s"). Hace falta la tabla de equivalencias letra→dígito para cargar el costo real.',
                count(*), min(clave)),
         jsonb_build_object('ejemplos', (SELECT jsonb_agg(DISTINCT clave)
                                         FROM (SELECT clave FROM migration.article_stage
                                               WHERE clave IS NOT NULL LIMIT 10) x)))
FROM migration.article_stage WHERE clave IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. PREC_GR: el que lo tenía es candidato a precio calculado por peso
-- -----------------------------------------------------------------------------
SELECT migration.log_exception('info','pricing','candidato_by_weight', NULL,
         format('%s variante(s) traen PREC_GR: son las candidatas a pasar a mode=''by_weight'' una vez cargado pricing.metal_rate',
                count(*)), '{}')
FROM migration.article_stage WHERE prec_gr > 0;

-- pistas de margen que el legacy guardaba copiadas en cada artículo
SELECT migration.log_exception('info','pricing','margenes_observados', NULL,
         'márgenes más frecuentes del legacy, para configurar pricing.price_rule',
         jsonb_build_object('comerciante', (
           SELECT jsonb_agg(jsonb_build_object('pct', pct, 'n', n))
           FROM (SELECT migration.to_numeric(porcentaje_comerciante) AS pct, count(*) AS n
                 FROM legacy.almacen_articulo
                 WHERE migration.to_numeric(porcentaje_comerciante) > 0
                 GROUP BY 1 ORDER BY 2 DESC LIMIT 5) a),
         'mayor', (
           SELECT jsonb_agg(jsonb_build_object('pct', pct, 'n', n))
           FROM (SELECT migration.to_numeric(porc_mayor) AS pct, count(*) AS n
                 FROM legacy.almacen_articulo
                 WHERE migration.to_numeric(porc_mayor) > 0
                 GROUP BY 1 ORDER BY 2 DESC LIMIT 5) b),
         'publico', (
           SELECT jsonb_agg(jsonb_build_object('pct', pct, 'n', n))
           FROM (SELECT migration.to_numeric(porcenteje) AS pct, count(*) AS n
                 FROM legacy.almacen_articulo
                 WHERE migration.to_numeric(porcenteje) > 0
                 GROUP BY 1 ORDER BY 2 DESC LIMIT 5) c)));

-- -----------------------------------------------------------------------------
-- 4. monedas: el legacy guardaba la moneda dos veces y siempre en soles
-- -----------------------------------------------------------------------------
SELECT migration.log_exception('info','pricing','monedas_usadas', NULL,
         'monedas encontradas en el legacy (ID_TIPO_MONEDA / MONEDA texto)',
         jsonb_build_object('combinaciones', (
           SELECT jsonb_agg(jsonb_build_object('id', id_tipo_moneda, 'texto', moneda, 'n', n))
           FROM (SELECT id_tipo_moneda, moneda, count(*) AS n
                 FROM legacy.almacen_articulo GROUP BY 1,2) x)));

COMMIT;

-- =============================================================================
-- ERP v2 — prueba de humo de la lista de pendientes (catalog.v_pending)
--
-- Verifica que cada defecto de carga aparezca con su motivo, y —lo importante—
-- que una variante SALGA de la lista en cuanto se completa el dato.
--
-- Termina en ROLLBACK: no deja datos.
-- =============================================================================
BEGIN;

SET LOCAL app.user_id = '1';
SET LOCAL app.client_info = 'smoke-pendientes';

-- -----------------------------------------------------------------------------
-- cuatro artículos con defectos distintos, como los que trae el ERP viejo
-- -----------------------------------------------------------------------------
INSERT INTO catalog.product (code, slug, name, kind, status, material_id, nominal_weight_g, created_by)
VALUES
  -- completo: material, peso, categoría y (más abajo) precio y foto
  ('PEND-OK','pend-ok','Artículo completo','jewelry','active',
   (SELECT id FROM catalog.material WHERE code='AU18'), 5.000, 1),
  -- sin material y sin peso
  ('PEND-1','pend-1','Sin material ni peso','jewelry','draft', NULL, NULL, 1),
  -- con peso pero el precio no cierra contra el peso (el caso AWS25 del legacy)
  ('PEND-2','pend-2','Peso contra precio','jewelry','draft',
   (SELECT id FROM catalog.material WHERE code='AU18'), 0.100, 1),
  -- medida que el legacy traía como texto libre
  ('PEND-3','pend-3','Medida sin interpretar','jewelry','draft',
   (SELECT id FROM catalog.material WHERE code='AU18'), 3.000, 1);

UPDATE catalog.product
   SET size_scale_id = (SELECT id FROM catalog.size_scale WHERE code='aro_pe')
 WHERE code = 'PEND-3';

INSERT INTO catalog.product_category (product_id, category_id, is_primary)
SELECT p.id, (SELECT id FROM catalog.category WHERE slug='sortijas'), true
  FROM catalog.product p WHERE p.code IN ('PEND-OK','PEND-2','PEND-3');

INSERT INTO catalog.variant (product_id, sku, size_label, weight_g, tracking_mode, is_default)
VALUES
  ((SELECT id FROM catalog.product WHERE code='PEND-OK'),'PEND-OK-1', NULL, 5.000,'quantity', true),
  ((SELECT id FROM catalog.product WHERE code='PEND-1'), 'PEND-1-1',  NULL, NULL,  'quantity', true),
  ((SELECT id FROM catalog.product WHERE code='PEND-2'), 'PEND-2-1',  NULL, 0.100, 'quantity', true),
  -- talla como texto libre: el producto usa escala pero nadie la interpretó
  ((SELECT id FROM catalog.product WHERE code='PEND-3'), 'PEND-3-1', '5.5*4', 3.000,'quantity', true);

-- precios: el completo bien, el de PEND-2 absurdo contra su peso
INSERT INTO pricing.price (price_list_id, variant_id, mode, amount, created_by)
SELECT (SELECT id FROM pricing.price_list WHERE code='publico'), v.id, 'manual', 1600.00, 1
  FROM catalog.variant v WHERE v.sku IN ('PEND-OK-1','PEND-2-1');

INSERT INTO pricing.price (price_list_id, variant_id, mode, amount, created_by)
SELECT (SELECT id FROM pricing.price_list WHERE code='publico'), v.id, 'manual', 300.00, 1
  FROM catalog.variant v WHERE v.sku = 'PEND-3-1';

-- foto real solo para el completo; la de PEND-3 es la que dejó la migración
INSERT INTO catalog.media (product_id, kind, url, storage_key, is_primary)
SELECT p.id, 'image', 'https://ejemplo/ok.jpg', 'ok.jpg', true
  FROM catalog.product p WHERE p.code = 'PEND-OK';
INSERT INTO catalog.media (product_id, kind, url, storage_key, is_primary)
SELECT p.id, 'image', 'pendiente/viejo.jpg', 'pendiente/viejo.jpg', true
  FROM catalog.product p WHERE p.code = 'PEND-3';

\echo '--- caso 1: cada artículo con lo que le falta'
SELECT sku, product_status, reasons, blocks_sale
  FROM catalog.v_pending WHERE sku LIKE 'PEND-%' ORDER BY sku;

\echo '--- caso 2: el artículo completo NO aparece en la lista'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM catalog.v_pending WHERE sku = 'PEND-OK-1') THEN
    RAISE EXCEPTION 'un artículo completo no debería estar en pendientes';
  END IF;
  RAISE NOTICE 'OK        PEND-OK-1 está completo y no figura';
END $$;

\echo '--- caso 3: los motivos son los esperados'
DO $$
DECLARE r text[];
BEGIN
  SELECT reasons INTO r FROM catalog.v_pending WHERE sku = 'PEND-1-1';
  IF NOT (r @> ARRAY['sin_peso','sin_material','sin_categoria','sin_precio','sin_foto']) THEN
    RAISE EXCEPTION 'PEND-1-1 debería acusar peso, material, categoría, precio y foto: %', r;
  END IF;
  RAISE NOTICE 'OK        PEND-1-1 acusa los 5 datos que le faltan';

  SELECT reasons INTO r FROM catalog.v_pending WHERE sku = 'PEND-2-1';
  IF NOT (r @> ARRAY['peso_vs_precio']) THEN
    RAISE EXCEPTION 'PEND-2-1 debería acusar peso_vs_precio (0.1 g a 1600): %', r;
  END IF;
  RAISE NOTICE 'OK        PEND-2-1 acusa peso contra precio';

  SELECT reasons INTO r FROM catalog.v_pending WHERE sku = 'PEND-3-1';
  IF NOT (r @> ARRAY['medida_sin_interpretar','sin_foto']) THEN
    RAISE EXCEPTION 'PEND-3-1 debería acusar la medida y la foto pendiente: %', r;
  END IF;
  RAISE NOTICE 'OK        PEND-3-1 acusa la medida sin interpretar y la foto sin subir';
END $$;

\echo '--- caso 4: al completar el dato, la variante sale sola de la lista'
UPDATE catalog.product
   SET material_id = (SELECT id FROM catalog.material WHERE code='AG925'),
       status = 'active'
 WHERE code = 'PEND-1';
UPDATE catalog.variant SET weight_g = 7.500 WHERE sku = 'PEND-1-1';
INSERT INTO catalog.product_category (product_id, category_id, is_primary)
SELECT p.id, (SELECT id FROM catalog.category WHERE slug='sortijas'), true
  FROM catalog.product p WHERE p.code = 'PEND-1';
INSERT INTO pricing.price (price_list_id, variant_id, mode, amount, created_by)
SELECT (SELECT id FROM pricing.price_list WHERE code='publico'), v.id, 'manual', 450.00, 1
  FROM catalog.variant v WHERE v.sku = 'PEND-1-1';
INSERT INTO catalog.media (product_id, kind, url, storage_key, is_primary)
SELECT p.id, 'image', 'https://ejemplo/pend1.jpg', 'pend1.jpg', true
  FROM catalog.product p WHERE p.code = 'PEND-1';

SELECT sku, reasons FROM catalog.v_pending WHERE sku LIKE 'PEND-%' ORDER BY sku;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM catalog.v_pending WHERE sku = 'PEND-1-1') THEN
    RAISE EXCEPTION 'PEND-1-1 ya está completo: debería haber salido de la lista';
  END IF;
  RAISE NOTICE 'OK        PEND-1-1 se completó y salió de pendientes sin tocar nada más';
END $$;

ROLLBACK;

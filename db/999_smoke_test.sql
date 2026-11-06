-- =============================================================================
-- ERP v2 — prueba de humo: reproduce casos reales del legacy sobre el modelo nuevo
-- Correr sobre una base recién creada con 001..007. Todo dentro de una transacción.
-- =============================================================================
BEGIN;

SET LOCAL app.user_id = '1';          -- usuario 'migracion'
SET LOCAL app.client_info = 'smoke-test';

-- -----------------------------------------------------------------------------
-- CASO 1 — ASD1..ASD6: un producto con varias tallas
-- -----------------------------------------------------------------------------
INSERT INTO catalog.product
  (code, slug, name, kind, status, material_id, size_scale_id,
   nominal_weight_g, thickness_mm, long_desc, legacy_code, created_by)
VALUES
  ('RIV-P2','riviera-cruzada-p2','Riviera cruzada P2','jewelry','active',
   (SELECT id FROM catalog.material WHERE code='AU18'),
   (SELECT id FROM catalog.size_scale WHERE code='aro_pe'),
   4.000, 2.00,
   'Aro cruzado con piedras de 2.5 mm, espesor 2 mm; aro pulido 2.5 mm, espesor 1.5 mm.',
   'ASD', 1);

INSERT INTO catalog.product_category (product_id, category_id, is_primary)
VALUES ((SELECT id FROM catalog.product WHERE code='RIV-P2'),
        (SELECT id FROM catalog.category WHERE slug='sortijas'), true);

INSERT INTO catalog.variant
  (product_id, sku, size_value_id, metal_color, weight_g, tracking_mode, legacy_code, is_default)
SELECT (SELECT id FROM catalog.product WHERE code='RIV-P2'),
       'RIV-P2-' || d.talla || '-CRI',
       (SELECT sv.id FROM catalog.size_value sv
        JOIN catalog.size_scale ss ON ss.id = sv.size_scale_id
        WHERE ss.code='aro_pe' AND sv.value = d.talla),
       'amarillo', 4.000, 'serial', d.legacy, d.talla = 16
FROM (VALUES (11,'ASD5'),(14,'ASD6'),(15,'ASD2'),(16,'ASD1'),(17,'ASD4'))
  AS d(talla, legacy);

-- las "20 pi 2.5 mm" de la descripción, ahora como dato
INSERT INTO catalog.variant_stone
  (variant_id, stone_id, color_code, cut_code, setting_code, quantity, size_mm, unit_cost, cost_currency)
SELECT v.id,
       (SELECT id FROM catalog.stone WHERE code='ZIRCON'),
       'cristalino','redonda','cruzado', 20, 2.50, 0.80,'PEN'
FROM catalog.variant v
JOIN catalog.product p ON p.id = v.product_id
WHERE p.code='RIV-P2';

\echo '--- caso 1: 1 producto, 5 variantes, 20 piedras cada una'
SELECT p.code, count(v.id) AS variantes, sum(vs.stone_count) AS piedras_totales
FROM catalog.product p
JOIN catalog.variant v ON v.product_id = p.id
JOIN catalog.v_variant_full vs ON vs.variant_id = v.id
WHERE p.code='RIV-P2' GROUP BY p.code;

-- -----------------------------------------------------------------------------
-- precio: modo manual (566, como el legacy) y modo calculado
-- -----------------------------------------------------------------------------
INSERT INTO pricing.metal_rate (material_id, price_per_gram, currency_code, valid_from, source)
VALUES ((SELECT id FROM catalog.material WHERE code='AU18'), 280.00,'PEN','2026-01-01','manual');

INSERT INTO pricing.price (price_list_id, variant_id, mode, amount, created_by)
SELECT (SELECT id FROM pricing.price_list WHERE code='publico'), v.id, 'manual', 566.00, 1
FROM catalog.variant v WHERE v.sku='RIV-P2-16-CRI';

INSERT INTO pricing.price (price_list_id, variant_id, mode, amount, margin_pct, created_by)
SELECT (SELECT id FROM pricing.price_list WHERE code='comerciante'), v.id, 'by_weight', 0, 50, 1
FROM catalog.variant v WHERE v.sku='RIV-P2-16-CRI';

\echo '--- precio manual vs precio calculado por peso (4 g x 280 + 20 piedras x 0.80, +50%)'
SELECT pl.code AS lista, p.mode,
       pricing.resolve_price(p.variant_id, p.price_list_id, 1, now()) AS precio_efectivo
FROM pricing.price p
JOIN pricing.price_list pl ON pl.id = p.price_list_id
JOIN catalog.variant v ON v.id = p.variant_id
WHERE v.sku='RIV-P2-16-CRI'
ORDER BY pl.code;

-- -----------------------------------------------------------------------------
-- CASO 2 — piezas serializadas: dos anillos del mismo modelo, pesos distintos
-- -----------------------------------------------------------------------------
INSERT INTO inventory.serial_item (variant_id, serial_code, actual_weight_g, acquired_on)
SELECT v.id, 'P-000418', 4.120, '2026-11-01' FROM catalog.variant v WHERE v.sku='RIV-P2-16-CRI';
INSERT INTO inventory.serial_item (variant_id, serial_code, actual_weight_g, acquired_on)
SELECT v.id, 'P-000419', 3.980, '2026-11-01' FROM catalog.variant v WHERE v.sku='RIV-P2-16-CRI';

SELECT inventory.post_movement(
         (SELECT id FROM catalog.variant WHERE sku='RIV-P2-16-CRI'),
         (SELECT id FROM core.location WHERE code='T-1'),
         'opening', 1, 1,
         (SELECT id FROM inventory.serial_item WHERE serial_code='P-000418'),
         NULL, NULL, 'inv_apertura');
SELECT inventory.post_movement(
         (SELECT id FROM catalog.variant WHERE sku='RIV-P2-16-CRI'),
         (SELECT id FROM core.location WHERE code='T-1'),
         'opening', 1, 1,
         (SELECT id FROM inventory.serial_item WHERE serial_code='P-000419'),
         NULL, NULL, 'inv_apertura');

\echo '--- caso 2: cada pieza con su peso real y su diferencia contra el nominal'
SELECT serial_code, status, location_code, nominal_weight_g, actual_weight_g, weight_diff_g
FROM inventory.v_serial_tracking ORDER BY serial_code;

-- una pieza sale al taller: deja de estar disponible, pero no desaparece
SELECT inventory.post_movement(
         (SELECT id FROM catalog.variant WHERE sku='RIV-P2-16-CRI'),
         (SELECT id FROM core.location WHERE code='T-1'),
         'production_out', -1, 1,
         (SELECT id FROM inventory.serial_item WHERE serial_code='P-000419'),
         NULL, NULL, 'ajuste_talla', NULL, NULL, 'cliente pide talla 15');

\echo '--- la pieza en taller ya no cuenta como stock de la tienda'
SELECT sku, location_code, on_hand FROM inventory.v_availability
WHERE sku='RIV-P2-16-CRI';
SELECT serial_code, status FROM inventory.v_serial_tracking WHERE serial_code='P-000419';

-- -----------------------------------------------------------------------------
-- CASO 3 — BLX1 por cantidad: el kardex explica el saldo
-- -----------------------------------------------------------------------------
INSERT INTO catalog.product (code, slug, name, kind, status, material_id, nominal_weight_g, legacy_code, created_by)
VALUES ('LLAV-MIN','llavero-minitta','Llavero Minitta','gift','active',
        (SELECT id FROM catalog.material WHERE code='BRONCE'), 8.000, 'BLX', 1);

INSERT INTO catalog.variant (product_id, sku, tracking_mode, legacy_code, is_default)
VALUES ((SELECT id FROM catalog.product WHERE code='LLAV-MIN'),'LLAV-MIN-STD','quantity','BLX1', true);

INSERT INTO inventory.stock (variant_id, location_id, min_quantity)
VALUES ((SELECT id FROM catalog.variant WHERE sku='LLAV-MIN-STD'),
        (SELECT id FROM core.location WHERE code='T-1'), 50);

SELECT inventory.post_movement((SELECT id FROM catalog.variant WHERE sku='LLAV-MIN-STD'),
         (SELECT id FROM core.location WHERE code='T-1'),'opening', 160, 1,
         NULL, NULL, NULL,'inv_apertura', NULL, NULL, NULL,'2026-11-06'::timestamptz);
SELECT inventory.post_movement((SELECT id FROM catalog.variant WHERE sku='LLAV-MIN-STD'),
         (SELECT id FROM core.location WHERE code='T-1'),'sale', -40, 1,
         NULL, NULL, NULL,'venta_mostrador', NULL, NULL, NULL,'2026-11-10'::timestamptz);
SELECT inventory.post_movement((SELECT id FROM catalog.variant WHERE sku='LLAV-MIN-STD'),
         (SELECT id FROM core.location WHERE code='T-1'),'sale', -25, 1,
         NULL, NULL, NULL,'venta_mostrador', NULL, NULL, NULL,'2026-11-14'::timestamptz);

\echo '--- caso 3: kardex con saldo corrido (esto es lo que hoy no existe)'
SELECT occurred_at::date, type, reason_code, quantity, running_balance, created_by_username
FROM inventory.v_kardex WHERE sku='LLAV-MIN-STD' ORDER BY occurred_at;

-- -----------------------------------------------------------------------------
-- CASO 4 — apartado: el papelito en la vitrina, ahora como dato
-- -----------------------------------------------------------------------------
INSERT INTO inventory.reservation
  (variant_id, location_id, kind, quantity, customer_name, customer_phone,
   deposit_amount, deposit_currency, expires_at, created_by)
VALUES ((SELECT id FROM catalog.variant WHERE sku='LLAV-MIN-STD'),
        (SELECT id FROM core.location WHERE code='T-1'),
        'layaway', 10, 'Cliente de prueba','999888777', 50.00,'PEN',
        now() + interval '15 days', 1);

\echo '--- caso 4: 95 en mano, 10 apartados, 85 realmente vendibles'
SELECT sku, on_hand, reserved, available, min_quantity, below_min
FROM inventory.v_availability WHERE sku='LLAV-MIN-STD';

-- -----------------------------------------------------------------------------
-- CASO 5 — inventario físico (así arranca el stock, decisión 5)
-- -----------------------------------------------------------------------------
SELECT inventory.open_count_sheet(
  (SELECT id FROM core.location WHERE code='T-7'), 1, true) AS count_sheet_id \gset

UPDATE inventory.count_line
   SET counted_qty = 3, counted_at = now(), reason_code = 'inv_apertura'
 WHERE count_sheet_id = :count_sheet_id
   AND variant_id = (SELECT id FROM catalog.variant WHERE sku='LLAV-MIN-STD');

SELECT inventory.apply_count_sheet(:count_sheet_id, 1) AS movimientos_generados;

\echo '--- caso 5: el conteo de arranque creó el saldo de T-7'
SELECT sku, location_code, on_hand, last_counted_at IS NOT NULL AS contado
FROM inventory.v_availability WHERE sku='LLAV-MIN-STD' ORDER BY location_code;

-- -----------------------------------------------------------------------------
-- CASO 6 — reposición: qué pedir y en qué sede
-- -----------------------------------------------------------------------------
UPDATE inventory.stock SET min_quantity = 120
 WHERE variant_id = (SELECT id FROM catalog.variant WHERE sku='LLAV-MIN-STD')
   AND location_id = (SELECT id FROM core.location WHERE code='T-1');
UPDATE inventory.stock SET min_quantity = 10
 WHERE variant_id = (SELECT id FROM catalog.variant WHERE sku='LLAV-MIN-STD')
   AND location_id = (SELECT id FROM core.location WHERE code='T-7');

\echo '--- caso 6: sugerencia de reposición por sede'
SELECT sku, location_code, on_hand, min_quantity, suggested_qty FROM inventory.v_reorder;

-- -----------------------------------------------------------------------------
-- CASO 7 — integridad: el saldo guardado SIEMPRE coincide con los movimientos
-- -----------------------------------------------------------------------------
\echo '--- caso 7: filas descuadradas (debe salir 0)'
SELECT count(*) AS descuadres FROM inventory.v_stock_integrity;

\echo '--- y se puede reconstruir desde cero sin perder nada'
SELECT inventory.rebuild_stock() AS filas_reconstruidas;
SELECT count(*) AS descuadres_post_rebuild FROM inventory.v_stock_integrity;

-- -----------------------------------------------------------------------------
-- CASO 8 — auditoría: quién cambió qué
-- -----------------------------------------------------------------------------
\echo '--- caso 8: auditoría automática'
SELECT entity, action, count(*) FROM core.audit_log GROUP BY 1,2 ORDER BY 1,2;

-- -----------------------------------------------------------------------------
-- CASO 9 — las reglas que DEBEN fallar
-- Lo que el legacy aceptaba sin chistar, acá la base lo rechaza.
-- -----------------------------------------------------------------------------
\echo '--- caso 9: reglas de integridad (las 6 deben decir RECHAZADO)'
DO $$
DECLARE
  v_variant_qty bigint := (SELECT id FROM catalog.variant WHERE sku='LLAV-MIN-STD');
  v_variant_ser bigint := (SELECT id FROM catalog.variant WHERE sku='RIV-P2-16-CRI');
  v_serial      bigint := (SELECT id FROM inventory.serial_item WHERE serial_code='P-000418');
  v_t1          bigint := (SELECT id FROM core.location WHERE code='T-1');
  v_oficina     bigint := (SELECT id FROM core.location WHERE code='OFI-T1');
  v_mov         bigint := (SELECT min(id) FROM inventory.movement);
BEGIN
  -- 1. vender más de lo que hay
  BEGIN
    PERFORM inventory.post_movement(v_variant_qty, v_t1, 'sale', -9999, 1);
    RAISE WARNING 'ACEPTADO (mal): venta mayor al saldo';
  EXCEPTION WHEN others THEN RAISE NOTICE 'RECHAZADO 1/6 saldo insuficiente'; END;

  -- 2. mover 2 unidades de una pieza serializada
  BEGIN
    PERFORM inventory.post_movement(v_variant_ser, v_t1, 'sale', -2, 1, v_serial);
    RAISE WARNING 'ACEPTADO (mal): 2 unidades de una pieza única';
  EXCEPTION WHEN others THEN RAISE NOTICE 'RECHAZADO 2/6 pieza serializada mueve 1'; END;

  -- 3. mover una variante serializada sin indicar la pieza
  BEGIN
    PERFORM inventory.post_movement(v_variant_ser, v_t1, 'sale', -1, 1);
    RAISE WARNING 'ACEPTADO (mal): serializada sin serial_id';
  EXCEPTION WHEN others THEN RAISE NOTICE 'RECHAZADO 3/6 falta serial_id'; END;

  -- 4. cargar stock en una sede que no maneja stock (la oficina)
  BEGIN
    PERFORM inventory.post_movement(v_variant_qty, v_oficina, 'opening', 5, 1);
    RAISE WARNING 'ACEPTADO (mal): stock en la oficina';
  EXCEPTION WHEN others THEN RAISE NOTICE 'RECHAZADO 4/6 sede sin stock'; END;

  -- 5. editar un movimiento del kardex
  BEGIN
    UPDATE inventory.movement SET quantity = 1 WHERE id = v_mov;
    RAISE WARNING 'ACEPTADO (mal): movimiento editado';
  EXCEPTION WHEN others THEN RAISE NOTICE 'RECHAZADO 5/6 kardex append-only'; END;

  -- 6. borrar un movimiento del kardex
  BEGIN
    DELETE FROM inventory.movement WHERE id = v_mov;
    RAISE WARNING 'ACEPTADO (mal): movimiento borrado';
  EXCEPTION WHEN others THEN RAISE NOTICE 'RECHAZADO 6/6 kardex append-only'; END;
END $$;

\echo '--- y el kardex sigue intacto después de los 6 intentos'
SELECT count(*) AS movimientos, sum(quantity) AS suma_neta FROM inventory.movement;

COMMIT;

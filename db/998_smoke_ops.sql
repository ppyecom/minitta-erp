-- =============================================================================
-- ERP v2 — prueba de humo de los procesos (esquema ops)
--
-- Verifica las reglas que hacen que no se escape una joya:
--   · la cadena de custodia se escribe sola y no se puede editar
--   · una pieza del cliente nunca se convierte en stock nuestro
--   · una orden de taller no cierra si no cuadran los gramos
--   · la merma por encima del estándar necesita que alguien la firme
--   · el tercero no puede vender lo que no tiene
--
-- Termina en ROLLBACK: no deja datos en la base.
-- =============================================================================
BEGIN;

SET LOCAL app.user_id = '1';
SET LOCAL app.client_info = 'smoke-ops';

-- -----------------------------------------------------------------------------
-- fixtures
-- -----------------------------------------------------------------------------
INSERT INTO catalog.product (code, slug, name, kind, status, material_id, created_by)
VALUES ('OPS-TEST','ops-test','Cadena de prueba','jewelry','active',
        (SELECT id FROM catalog.material WHERE code='AU18'), 1);

-- size_label distinto en cada una: el índice variant_unique_combo no admite
-- dos variantes del mismo producto con todos los ejes en NULL
INSERT INTO catalog.variant (product_id, sku, size_label, weight_g, tracking_mode, is_default)
VALUES ((SELECT id FROM catalog.product WHERE code='OPS-TEST'),'OPS-Q','45 cm', 10.000,'quantity', true),
       ((SELECT id FROM catalog.product WHERE code='OPS-TEST'),'OPS-S','60 cm', 20.000,'serial', false);

INSERT INTO inventory.serial_item (variant_id, serial_code, location_id, actual_weight_g)
VALUES ((SELECT id FROM catalog.variant WHERE sku='OPS-S'),'OPS-S-0001', 1, 20.500);

-- sede de un consignatario
INSERT INTO core.location (code, name, kind, sells, holds_stock, is_third_party)
VALUES ('CONSIG-FERIA','Feria de artesanos','consignment', false, true, true);

-- stock inicial
SELECT inventory.post_movement(
  (SELECT id FROM catalog.variant WHERE sku='OPS-Q'), 1,
  'purchase'::inventory.movement_type, 10, 1, NULL, NULL, NULL, 'compra_prov');
SELECT inventory.post_movement(
  (SELECT id FROM catalog.variant WHERE sku='OPS-S'), 1,
  'purchase'::inventory.movement_type, 1, 1,
  (SELECT id FROM inventory.serial_item WHERE serial_code='OPS-S-0001'),
  NULL, NULL, 'compra_prov');

-- =============================================================================
\echo '--- caso 1: recibir la pieza de un cliente escribe el primer eslabón sola'
-- =============================================================================
INSERT INTO ops.custody_item
  (code, customer_name, customer_phone, description, material_id, received_weight_g,
   stone_notes, condition_notes, requested_service, location_id, received_by, promised_on)
VALUES
  ('CUS-0001','María Quispe','999888777','Anillo de compromiso, oro amarillo',
   (SELECT id FROM catalog.material WHERE code='AU18'), 4.820,
   '1 brillante central','Aro abierto, piedra floja','Soldar aro y ajustar engaste',
   1, 1, current_date + 7);

SELECT c.code, c.status, c.received_weight_g,
       count(e.id) AS eslabones, min(e.kind::text) AS primer_evento
  FROM ops.custody_item c
  JOIN ops.custody_event e ON e.custody_item_id = c.id
 WHERE c.code='CUS-0001'
 GROUP BY c.code, c.status, c.received_weight_g;

-- =============================================================================
\echo '--- caso 2: orden de taller sobre una pieza NUESTRA, con cuadre de gramos'
-- =============================================================================
INSERT INTO ops.work_order (code, kind, location_id, promised_on, created_by, notes)
VALUES ('OT-0001','resize', 10, current_date + 3, 1, 'achicar de talla 16 a 14');

INSERT INTO ops.work_order_input
  (work_order_id, source, variant_id, serial_id, from_location_id, quantity, weight_g)
VALUES ((SELECT id FROM ops.work_order WHERE code='OT-0001'),'stock',
        (SELECT id FROM catalog.variant WHERE sku='OPS-S'),
        (SELECT id FROM inventory.serial_item WHERE serial_code='OPS-S-0001'),
        1, 1, 20.500);

SELECT ops.start_work_order((SELECT id FROM ops.work_order WHERE code='OT-0001'), 1);

\echo '    la pieza está en el taller, no en la tienda:'
SELECT si.serial_code, si.status, l.code AS esta_en
  FROM inventory.serial_item si JOIN core.location l ON l.id = si.location_id
 WHERE si.serial_code='OPS-S-0001';

-- se le sacaron 1.3 g de aro: 0.9 g vuelven como recorte recuperado, 0.4 g de merma
INSERT INTO ops.work_order_output
  (work_order_id, variant_id, serial_id, to_location_id, quantity, weight_g)
VALUES ((SELECT id FROM ops.work_order WHERE code='OT-0001'),
        (SELECT id FROM catalog.variant WHERE sku='OPS-S'),
        (SELECT id FROM inventory.serial_item WHERE serial_code='OPS-S-0001'),
        1, 1, 19.200);

INSERT INTO ops.work_order_loss (work_order_id, material_id, weight_g, is_recovered, reason, created_by)
VALUES ((SELECT id FROM ops.work_order WHERE code='OT-0001'),
        (SELECT id FROM catalog.material WHERE code='AU18'), 0.900, true,
        'recorte de aro recuperado', 1),
       ((SELECT id FROM ops.work_order WHERE code='OT-0001'),
        (SELECT id FROM catalog.material WHERE code='AU18'), 0.400, false,
        'limadura y pulido', 1);

SELECT code, input_g, output_g, recovered_g, loss_g, diff_g, loss_pct, max_loss_pct, balanced
  FROM ops.v_work_order_balance WHERE code='OT-0001';

SELECT ops.close_work_order((SELECT id FROM ops.work_order WHERE code='OT-0001'), 1);

\echo '    cerrada: la pieza volvió a la tienda y pesa lo que realmente pesa'
SELECT si.serial_code, si.status, l.code AS esta_en, si.actual_weight_g
  FROM inventory.serial_item si JOIN core.location l ON l.id = si.location_id
 WHERE si.serial_code='OPS-S-0001';

\echo '    y el stock quedó donde tiene que quedar (1 en T-1, 0 en el taller)'
SELECT l.code AS sede, s.on_hand
  FROM inventory.stock s JOIN core.location l ON l.id = s.location_id
 WHERE s.variant_id = (SELECT id FROM catalog.variant WHERE sku='OPS-S')
   AND s.on_hand <> 0;

-- =============================================================================
\echo '--- caso 3: reparación de la pieza del cliente, de punta a punta'
-- =============================================================================
INSERT INTO ops.work_order (code, kind, location_id, custody_item_id, promised_on, created_by)
VALUES ('OT-0002','repair', 10,
        (SELECT id FROM ops.custody_item WHERE code='CUS-0001'), current_date + 5, 1);

INSERT INTO ops.work_order_input
  (work_order_id, source, custody_item_id, quantity, weight_g)
VALUES ((SELECT id FROM ops.work_order WHERE code='OT-0002'),'custody',
        (SELECT id FROM ops.custody_item WHERE code='CUS-0001'), 1, 4.820);

SELECT ops.start_work_order((SELECT id FROM ops.work_order WHERE code='OT-0002'), 1);

INSERT INTO ops.work_order_output (work_order_id, custody_item_id, quantity, weight_g)
VALUES ((SELECT id FROM ops.work_order WHERE code='OT-0002'),
        (SELECT id FROM ops.custody_item WHERE code='CUS-0001'), 1, 4.800);

INSERT INTO ops.work_order_loss (work_order_id, weight_g, reason, created_by)
VALUES ((SELECT id FROM ops.work_order WHERE code='OT-0002'), 0.020, 'limpieza y pulido', 1);

SELECT ops.close_work_order((SELECT id FROM ops.work_order WHERE code='OT-0002'), 1);

SELECT ops.deliver_custody((SELECT id FROM ops.custody_item WHERE code='CUS-0001'),
                           'María Quispe (DNI 40123456)', 4.800, 1, 'retirado en T-1');

\echo '    la cadena completa de la pieza, con el peso en cada paso:'
SELECT event, to_char(weight_g,'FM999.000') AS peso,
       to_char(weight_diff_g,'FM999.000') AS dif, work_order
  FROM ops.v_custody_ledger WHERE code='CUS-0001';

\echo '    y nunca tocó el inventario (0 movimientos con esa pieza):'
SELECT count(*) AS movimientos_de_la_pieza_del_cliente
  FROM inventory.movement WHERE doc_type='custody';

-- =============================================================================
\echo '--- caso 4: consignación en una feria'
-- =============================================================================
INSERT INTO ops.consignment
  (code, partner_location_id, partner_name, from_location_id, commission_pct,
   currency_code, due_on, responsible_user_id, created_by)
VALUES ('CON-0001',(SELECT id FROM core.location WHERE code='CONSIG-FERIA'),
        'Feria de artesanos de Miraflores', 1, 20, 'PEN', current_date - 1, 1, 1);

INSERT INTO ops.consignment_line (consignment_id, variant_id, quantity_sent, unit_price)
VALUES ((SELECT id FROM ops.consignment WHERE code='CON-0001'),
        (SELECT id FROM catalog.variant WHERE sku='OPS-Q'), 6, 150.00);

SELECT ops.send_consignment((SELECT id FROM ops.consignment WHERE code='CON-0001'), 1);
SELECT ops.report_consignment_sale(
  (SELECT id FROM ops.consignment_line
    WHERE consignment_id=(SELECT id FROM ops.consignment WHERE code='CON-0001')), 2, 1);
SELECT ops.return_consignment(
  (SELECT id FROM ops.consignment_line
    WHERE consignment_id=(SELECT id FROM ops.consignment WHERE code='CON-0001')), 1, 1);

SELECT ops.settle_consignment((SELECT id FROM ops.consignment WHERE code='CON-0001'),
                              current_date - 1, current_date, 1) AS liquidacion_id;

SELECT gross_amount AS vendido, commission_amount AS comision, net_amount AS nos_corresponde
  FROM ops.consignment_settlement
 WHERE consignment_id = (SELECT id FROM ops.consignment WHERE code='CON-0001');

\echo '    saldo: 6 entregadas, 2 vendidas, 1 devuelta, 3 todavía en la feria'
SELECT quantity_sent, quantity_sold, quantity_returned,
       quantity_sent - quantity_sold - quantity_returned AS pendiente
  FROM ops.consignment_line
 WHERE consignment_id = (SELECT id FROM ops.consignment WHERE code='CON-0001');

-- =============================================================================
\echo '--- caso 5: apartado con cuotas'
-- =============================================================================
INSERT INTO inventory.reservation
  (variant_id, location_id, kind, quantity, customer_name, customer_phone,
   deposit_amount, deposit_currency, reserved_at, expires_at, created_by)
VALUES ((SELECT id FROM catalog.variant WHERE sku='OPS-Q'), 1,'layaway', 1,
        'Luis Ramos','988777666', 50.00,'PEN',
        now() - interval '30 days', now() - interval '1 day', 1);

SELECT ops.register_layaway_payment(
  (SELECT id FROM inventory.reservation WHERE customer_name='Luis Ramos'),
  50.00,'PEN', 1,'cash'::ops.payment_method) AS pagado_total;
SELECT ops.register_layaway_payment(
  (SELECT id FROM inventory.reservation WHERE customer_name='Luis Ramos'),
  30.00,'PEN', 1,'wallet'::ops.payment_method) AS pagado_total;

SELECT customer_name, sku, paid, payment_count, status
  FROM ops.v_layaway_balance WHERE customer_name='Luis Ramos';

\echo '    el apartado está vencido: expirarlo libera la pieza'
SELECT ops.expire_layaways(1) AS apartados_vencidos;
SELECT status, quantity FROM inventory.reservation WHERE customer_name='Luis Ramos';

-- =============================================================================
\echo '--- caso 6: todo lo que en este momento NO está en una sede'
-- =============================================================================
SELECT kind, reference, location, responsible, days_out, is_overdue
  FROM ops.v_pieces_out ORDER BY kind, reference;

-- =============================================================================
\echo '--- caso 7: reglas de integridad (las 7 deben decir RECHAZADO)'
-- =============================================================================
-- la orden mal armada que usan las reglas 2 y 3: entran 20 g, salen 17 g
INSERT INTO ops.work_order (code, kind, location_id, created_by)
VALUES ('OT-MAL','polish', 10, 1);
INSERT INTO ops.work_order_input
  (work_order_id, source, variant_id, from_location_id, quantity, weight_g)
VALUES ((SELECT id FROM ops.work_order WHERE code='OT-MAL'),'stock',
        (SELECT id FROM catalog.variant WHERE sku='OPS-Q'), 1, 2, 20.000);
SELECT ops.start_work_order((SELECT id FROM ops.work_order WHERE code='OT-MAL'), 1);
INSERT INTO ops.work_order_output
  (work_order_id, variant_id, to_location_id, quantity, weight_g)
VALUES ((SELECT id FROM ops.work_order WHERE code='OT-MAL'),
        (SELECT id FROM catalog.variant WHERE sku='OPS-Q'), 1, 2, 17.000);

DO $$
DECLARE
  v_n int := 0;
  v_wo bigint := (SELECT id FROM ops.work_order WHERE code='OT-MAL');
BEGIN
  -- 1. la cadena de custodia no se edita
  BEGIN
    UPDATE ops.custody_event SET weight_g = 999
     WHERE custody_item_id = (SELECT id FROM ops.custody_item WHERE code='CUS-0001');
    RAISE EXCEPTION 'NO RECHAZADO: se pudo editar la cadena de custodia';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
    v_n := v_n + 1; RAISE NOTICE 'RECHAZADO %/7 cadena de custodia append-only', v_n;
  END;

  -- 2. una orden que no cuadra en gramos no cierra
  BEGIN
    PERFORM ops.close_work_order(v_wo, 1);
    RAISE EXCEPTION 'NO RECHAZADO: cerró una orden con 3 g sin explicar';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%no cuadra en gramos%' THEN RAISE; END IF;
    v_n := v_n + 1; RAISE NOTICE 'RECHAZADO %/7 faltan gramos sin declarar', v_n;
  END;

  -- 3. la merma por encima del estándar necesita firma
  INSERT INTO ops.work_order_loss (work_order_id, weight_g, reason, created_by)
  VALUES (v_wo, 3.000, 'se perdió en el pulido', 1);
  BEGIN
    PERFORM ops.close_work_order(v_wo, 1);
    RAISE EXCEPTION 'NO RECHAZADO: 15%% de merma sin que nadie la apruebe';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%necesita aprobación%' THEN RAISE; END IF;
    v_n := v_n + 1; RAISE NOTICE 'RECHAZADO %/7 merma sobre el estándar sin aprobar', v_n;
  END;

  -- 4. ... y con la firma de un segundo usuario, la misma orden cierra
  UPDATE ops.work_order_loss SET approved_by = 3, approved_at = now()
   WHERE work_order_id = v_wo;
  PERFORM ops.close_work_order(v_wo, 1);
  RAISE NOTICE 'OK        la misma orden cierra una vez que la merma está aprobada';

  -- 5. una pieza en custodia no puede volverse stock nuestro
  BEGIN
    INSERT INTO ops.custody_item
      (code, customer_name, description, received_weight_g, requested_service,
       location_id, received_by)
    VALUES ('CUS-0002','Ana Torres','Dije de oro', 3.000,'Pulir', 1, 1);
    INSERT INTO ops.work_order (code, kind, location_id, custody_item_id, created_by)
    VALUES ('OT-ROBO','polish', 10,
            (SELECT id FROM ops.custody_item WHERE code='CUS-0002'), 1);
    INSERT INTO ops.work_order_input
      (work_order_id, source, custody_item_id, quantity, weight_g)
    VALUES ((SELECT id FROM ops.work_order WHERE code='OT-ROBO'),'custody',
            (SELECT id FROM ops.custody_item WHERE code='CUS-0002'), 1, 3.000);
    PERFORM ops.start_work_order((SELECT id FROM ops.work_order WHERE code='OT-ROBO'), 1);
    INSERT INTO ops.work_order_output
      (work_order_id, variant_id, to_location_id, quantity, weight_g)
    VALUES ((SELECT id FROM ops.work_order WHERE code='OT-ROBO'),
            (SELECT id FROM catalog.variant WHERE sku='OPS-Q'), 1, 1, 3.000);
    PERFORM ops.close_work_order((SELECT id FROM ops.work_order WHERE code='OT-ROBO'), 1);
    RAISE EXCEPTION 'NO RECHAZADO: la pieza de un cliente entró al inventario';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%custodia%' THEN RAISE; END IF;
    v_n := v_n + 1; RAISE NOTICE 'RECHAZADO %/7 la pieza del cliente no se vuelve stock', v_n;
  END;

  -- 6. el tercero no puede vender lo que no tiene
  BEGIN
    PERFORM ops.report_consignment_sale(
      (SELECT id FROM ops.consignment_line
        WHERE consignment_id=(SELECT id FROM ops.consignment WHERE code='CON-0001')), 99, 1);
    RAISE EXCEPTION 'NO RECHAZADO: vendió 99 teniendo 3';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%solo quedan%' THEN RAISE; END IF;
    v_n := v_n + 1; RAISE NOTICE 'RECHAZADO %/7 el tercero vende más de lo que tiene', v_n;
  END;

  -- 7. el taller tiene que ser un taller
  BEGIN
    INSERT INTO ops.work_order (code, kind, location_id, created_by)
    VALUES ('OT-SEDE','repair', 1, 1);
    RAISE EXCEPTION 'NO RECHAZADO: se abrió una orden de taller en una tienda';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%debe ser workshop%' THEN RAISE; END IF;
    v_n := v_n + 1; RAISE NOTICE 'RECHAZADO %/7 orden de taller en una tienda', v_n;
  END;

  -- 8. no se entrega una pieza con la orden abierta
  BEGIN
    INSERT INTO ops.custody_item
      (code, customer_name, description, received_weight_g, requested_service,
       location_id, received_by)
    VALUES ('CUS-0003','Pedro Díaz','Cadena', 8.000,'Soldar', 1, 1);
    INSERT INTO ops.work_order (code, kind, location_id, custody_item_id, created_by)
    VALUES ('OT-0003','repair', 10,
            (SELECT id FROM ops.custody_item WHERE code='CUS-0003'), 1);
    PERFORM ops.deliver_custody(
      (SELECT id FROM ops.custody_item WHERE code='CUS-0003'),'Pedro Díaz', 8.000, 1);
    RAISE EXCEPTION 'NO RECHAZADO: se entregó una pieza con la orden abierta';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%orden de taller abierta%' THEN RAISE; END IF;
    v_n := v_n + 1; RAISE NOTICE 'RECHAZADO %/7 entrega con orden de taller abierta', v_n;
  END;

  IF v_n <> 7 THEN
    RAISE EXCEPTION 'solo % de 7 reglas rechazaron como corresponde', v_n;
  END IF;
END $$;

-- =============================================================================
\echo '--- caso 8: el kardex sigue cuadrando después de todos los procesos'
-- =============================================================================
SELECT count(*) AS descuadres FROM inventory.v_stock_integrity;

ROLLBACK;

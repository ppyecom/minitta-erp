-- =============================================================================
-- ERP v2 — 010: la lógica de los procesos y las vistas de control
--
-- Las funciones de este archivo son la única forma correcta de mover una pieza
-- por un proceso. La aplicación no inserta movimientos a mano (CLAUDE.md §3).
--
-- Convención de pesos: `weight_g` de una línea es el peso TOTAL de esa línea,
-- no el peso unitario.
-- =============================================================================

-- =============================================================================
-- CUSTODIA
-- =============================================================================

-- mover una pieza del cliente de un lugar a otro (mostrador -> taller, etc.)
CREATE OR REPLACE FUNCTION ops.move_custody(
  p_custody_item_id bigint,
  p_to_location_id  bigint,
  p_user_id         bigint,
  p_kind            ops.custody_event_kind DEFAULT 'moved',
  p_weight_g        numeric DEFAULT NULL,
  p_notes           text DEFAULT NULL,
  p_work_order_id   bigint DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r ops.custody_item;
BEGIN
  SELECT * INTO r FROM ops.custody_item WHERE id = p_custody_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no existe la pieza en custodia %', p_custody_item_id;
  END IF;
  IF r.status = 'delivered' THEN
    RAISE EXCEPTION 'la pieza en custodia % ya fue entregada al cliente', r.code;
  END IF;

  INSERT INTO ops.custody_event (custody_item_id, kind, from_location_id, to_location_id,
                                 to_user_id, weight_g, work_order_id, notes, created_by)
  VALUES (p_custody_item_id, p_kind, r.location_id, p_to_location_id,
          p_user_id, p_weight_g, p_work_order_id, p_notes, p_user_id);

  UPDATE ops.custody_item
     SET location_id = p_to_location_id,
         status = CASE p_kind
                    WHEN 'to_workshop'   THEN 'in_workshop'::ops.custody_status
                    WHEN 'from_workshop' THEN 'ready'::ops.custody_status
                    ELSE status
                  END
   WHERE id = p_custody_item_id;
END $$;

-- entregar la pieza al cliente: cierra la cadena con el peso de salida
CREATE OR REPLACE FUNCTION ops.deliver_custody(
  p_custody_item_id bigint,
  p_delivered_to    text,
  p_weight_g        numeric,
  p_user_id         bigint,
  p_notes           text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r ops.custody_item; v_diff numeric;
BEGIN
  SELECT * INTO r FROM ops.custody_item WHERE id = p_custody_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no existe la pieza en custodia %', p_custody_item_id;
  END IF;
  IF r.status = 'delivered' THEN
    RAISE EXCEPTION 'la pieza en custodia % ya fue entregada', r.code;
  END IF;
  IF EXISTS (SELECT 1 FROM ops.work_order
              WHERE custody_item_id = p_custody_item_id
                AND status NOT IN ('closed', 'cancelled')) THEN
    RAISE EXCEPTION 'la pieza % tiene una orden de taller abierta: ciérrela antes de entregar',
      r.code;
  END IF;

  -- la pieza puede salir más liviana (se limó) o más pesada (se le agregó metal),
  -- pero la diferencia queda registrada y a la vista, nunca en silencio
  v_diff := p_weight_g - r.received_weight_g;

  INSERT INTO ops.custody_event (custody_item_id, kind, from_location_id, to_user_id,
                                 weight_g, notes, created_by)
  VALUES (p_custody_item_id, 'delivered', r.location_id, p_user_id, p_weight_g,
          COALESCE(p_notes, '') ||
          CASE WHEN abs(v_diff) > ops.weight_tolerance_g()
               THEN format(' [diferencia de peso: %s g]', to_char(v_diff, 'FM999999.000'))
               ELSE '' END,
          p_user_id);

  UPDATE ops.custody_item
     SET status = 'delivered', delivered_at = now(), delivered_by = p_user_id,
         delivered_to = p_delivered_to, delivered_weight_g = p_weight_g
   WHERE id = p_custody_item_id;
END $$;

-- =============================================================================
-- ÓRDENES DE TALLER
-- =============================================================================

-- arrancar la orden: las piezas nuestras viajan al taller, la del cliente cambia de estado
CREATE OR REPLACE FUNCTION ops.start_work_order(p_id bigint, p_user_id bigint)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r_w ops.work_order; r_i ops.work_order_input; v_count int := 0;
BEGIN
  SELECT * INTO r_w FROM ops.work_order WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no existe la orden de taller %', p_id;
  END IF;
  IF r_w.status NOT IN ('draft', 'open') THEN
    RAISE EXCEPTION 'la orden % ya fue iniciada (está en %)', r_w.code, r_w.status;
  END IF;

  FOR r_i IN SELECT * FROM ops.work_order_input WHERE work_order_id = p_id LOOP
    v_count := v_count + 1;

    IF r_i.source = 'stock' THEN
      -- sale de la sede
      PERFORM inventory.post_movement(
        r_i.variant_id, r_i.from_location_id, 'production_out'::inventory.movement_type,
        -r_i.quantity, p_user_id, r_i.serial_id, NULL, NULL,
        'taller_salida', 'work_order', p_id,
        format('orden %s', r_w.code));
      -- entra al taller
      PERFORM inventory.post_movement(
        r_i.variant_id, r_w.location_id, 'production_in'::inventory.movement_type,
        r_i.quantity, p_user_id, r_i.serial_id, NULL, NULL,
        'taller_ingreso', 'work_order', p_id,
        format('orden %s', r_w.code));
      -- la pieza está en el taller, no "en stock" dentro del taller
      IF r_i.serial_id IS NOT NULL THEN
        UPDATE inventory.serial_item
           SET status = 'in_workshop', updated_at = now()
         WHERE id = r_i.serial_id;
      END IF;

    ELSIF r_i.source = 'custody' THEN
      PERFORM ops.move_custody(r_i.custody_item_id, r_w.location_id, p_user_id,
                               'to_workshop'::ops.custody_event_kind, r_i.weight_g,
                               format('orden %s', r_w.code), p_id);
    END IF;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'la orden % no tiene nada que trabajar: cargue al menos una entrada',
      r_w.code;
  END IF;

  UPDATE ops.work_order
     SET status = 'in_progress', started_at = COALESCE(started_at, now())
   WHERE id = p_id;
END $$;

-- cerrar la orden: ACÁ se verifica que no se haya escapado un gramo
CREATE OR REPLACE FUNCTION ops.close_work_order(p_id bigint, p_user_id bigint)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r_w ops.work_order;
  r_i ops.work_order_input;
  r_o ops.work_order_output;
  v_in numeric; v_out numeric; v_loss numeric; v_diff numeric; v_tol numeric;
  v_loss_pct numeric; v_max_pct numeric; v_unapproved numeric;
BEGIN
  SELECT * INTO r_w FROM ops.work_order WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no existe la orden de taller %', p_id;
  END IF;
  IF r_w.status NOT IN ('in_progress', 'finished') THEN
    RAISE EXCEPTION 'la orden % no está en curso (está en %)', r_w.code, r_w.status;
  END IF;

  -- regla 1: una pieza en custodia NO puede convertirse en inventario nuestro
  IF r_w.custody_item_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM ops.work_order_output
                  WHERE work_order_id = p_id AND variant_id IS NOT NULL) THEN
    RAISE EXCEPTION
      'la orden % trabaja sobre una pieza en custodia: no puede generar stock propio',
      r_w.code;
  END IF;

  -- regla 2: el cuadre de gramos
  SELECT COALESCE(sum(weight_g), 0) INTO v_in
    FROM ops.work_order_input WHERE work_order_id = p_id;
  SELECT COALESCE(sum(weight_g), 0) INTO v_out
    FROM ops.work_order_output WHERE work_order_id = p_id;
  SELECT COALESCE(sum(weight_g), 0) INTO v_loss
    FROM ops.work_order_loss WHERE work_order_id = p_id;

  v_tol  := ops.weight_tolerance_g();
  v_diff := v_in - v_out - v_loss;

  IF abs(v_diff) > v_tol THEN
    RAISE EXCEPTION
      'la orden % no cuadra en gramos: entraron %, salieron %, merma declarada % (faltan %)',
      r_w.code,
      to_char(v_in,   'FM999999.000'),
      to_char(v_out,  'FM999999.000'),
      to_char(v_loss, 'FM999999.000'),
      to_char(v_diff, 'FM999999.000');
  END IF;

  -- regla 3: la merma por encima del estándar la firma alguien.
  -- OJO: el recorte recuperado (is_recovered) cuadra el peso pero NO es merma:
  -- ese oro sigue siendo nuestro. Contra el estándar se mide solo lo perdido.
  SELECT COALESCE(sum(weight_g), 0) INTO v_loss
    FROM ops.work_order_loss WHERE work_order_id = p_id AND NOT is_recovered;

  IF v_in > 0 THEN
    v_loss_pct := v_loss / v_in * 100;
    SELECT max_loss_pct INTO v_max_pct FROM ops.loss_standard
      WHERE work_order_kind = r_w.kind AND material_id IS NULL AND is_active;

    IF v_max_pct IS NOT NULL AND v_loss_pct > v_max_pct THEN
      SELECT COALESCE(sum(weight_g), 0) INTO v_unapproved
        FROM ops.work_order_loss
       WHERE work_order_id = p_id AND NOT is_recovered AND approved_by IS NULL;
      IF v_unapproved > 0 THEN
        RAISE EXCEPTION
          'la merma de la orden % es % %% y el estándar para % es % %%: necesita aprobación',
          r_w.code, to_char(v_loss_pct, 'FM999.000'), r_w.kind,
          to_char(v_max_pct, 'FM999.000');
      END IF;
    END IF;
  END IF;

  -- las piezas nuestras salen del taller
  FOR r_i IN SELECT * FROM ops.work_order_input
              WHERE work_order_id = p_id AND source = 'stock' LOOP
    PERFORM inventory.post_movement(
      r_i.variant_id, r_w.location_id, 'production_out'::inventory.movement_type,
      -r_i.quantity, p_user_id, r_i.serial_id, NULL, NULL,
      'taller_salida', 'work_order', p_id, format('cierre de la orden %s', r_w.code));
  END LOOP;

  -- y lo que salió del trabajo entra donde corresponde
  FOR r_o IN SELECT * FROM ops.work_order_output WHERE work_order_id = p_id LOOP
    IF r_o.variant_id IS NOT NULL THEN
      PERFORM inventory.post_movement(
        r_o.variant_id, r_o.to_location_id, 'production_in'::inventory.movement_type,
        r_o.quantity, p_user_id, r_o.serial_id, NULL, NULL,
        'taller_retorno', 'work_order', p_id, format('cierre de la orden %s', r_w.code));

      -- el peso real de la pieza cambió en el taller: se actualiza, no se adivina
      IF r_o.serial_id IS NOT NULL THEN
        UPDATE inventory.serial_item
           SET actual_weight_g = r_o.weight_g, updated_at = now()
         WHERE id = r_o.serial_id;
      END IF;

    ELSE
      -- la pieza del cliente vuelve al mostrador donde la recibimos
      PERFORM ops.move_custody(
        r_o.custody_item_id,
        COALESCE((SELECT e.to_location_id FROM ops.custody_event e
                   WHERE e.custody_item_id = r_o.custody_item_id AND e.kind = 'received'
                   ORDER BY e.id LIMIT 1),
                 (SELECT location_id FROM ops.custody_item WHERE id = r_o.custody_item_id)),
        p_user_id, 'from_workshop'::ops.custody_event_kind, r_o.weight_g,
        format('cierre de la orden %s', r_w.code), p_id);
    END IF;
  END LOOP;

  UPDATE ops.work_order
     SET status = 'closed', finished_at = COALESCE(finished_at, now()), closed_at = now()
   WHERE id = p_id;
END $$;

CREATE OR REPLACE FUNCTION ops.cancel_work_order(p_id bigint, p_user_id bigint, p_reason text)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r_w ops.work_order;
BEGIN
  SELECT * INTO r_w FROM ops.work_order WHERE id = p_id FOR UPDATE;
  IF r_w.status NOT IN ('draft', 'open') THEN
    RAISE EXCEPTION
      'la orden % ya movió piezas (está en %): ciérrela declarando qué pasó con cada una',
      r_w.code, r_w.status;
  END IF;
  UPDATE ops.work_order
     SET status = 'cancelled', closed_at = now(),
         notes = concat_ws(E'\n', notes, 'anulada: ' || p_reason)
   WHERE id = p_id;
END $$;

-- =============================================================================
-- CONSIGNACIÓN
-- =============================================================================

CREATE OR REPLACE FUNCTION ops.send_consignment(p_id bigint, p_user_id bigint)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r_c ops.consignment; r_l ops.consignment_line; v_count int := 0;
BEGIN
  SELECT * INTO r_c FROM ops.consignment WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no existe la consignación %', p_id;
  END IF;
  IF r_c.status <> 'draft' THEN
    RAISE EXCEPTION 'la consignación % ya fue enviada (está en %)', r_c.code, r_c.status;
  END IF;

  FOR r_l IN SELECT * FROM ops.consignment_line WHERE consignment_id = p_id LOOP
    v_count := v_count + 1;
    PERFORM inventory.post_movement(
      r_l.variant_id, r_c.from_location_id, 'consignment_out'::inventory.movement_type,
      -r_l.quantity_sent, p_user_id, r_l.serial_id, NULL, NULL,
      'consig_entrega', 'consignment', p_id, format('consignación %s', r_c.code));
    PERFORM inventory.post_movement(
      r_l.variant_id, r_c.partner_location_id, 'consignment_in'::inventory.movement_type,
      r_l.quantity_sent, p_user_id, r_l.serial_id, NULL, NULL,
      'consig_ingreso_terc', 'consignment', p_id, format('consignación %s', r_c.code));
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'la consignación % no tiene líneas', r_c.code;
  END IF;

  UPDATE ops.consignment SET status = 'active' WHERE id = p_id;
END $$;

-- el tercero vendió: la pieza sale de su poder como venta
CREATE OR REPLACE FUNCTION ops.report_consignment_sale(
  p_line_id bigint, p_quantity numeric, p_user_id bigint)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r_l ops.consignment_line; r_c ops.consignment; v_pending numeric;
BEGIN
  SELECT * INTO r_l FROM ops.consignment_line WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no existe la línea de consignación %', p_line_id;
  END IF;
  SELECT * INTO r_c FROM ops.consignment WHERE id = r_l.consignment_id;
  IF r_c.status <> 'active' THEN
    RAISE EXCEPTION 'la consignación % no está activa (está en %)', r_c.code, r_c.status;
  END IF;

  v_pending := r_l.quantity_sent - r_l.quantity_sold - r_l.quantity_returned;
  IF p_quantity > v_pending THEN
    RAISE EXCEPTION
      'el tercero no puede vender % de la línea %: solo quedan % en su poder',
      p_quantity, p_line_id, v_pending;
  END IF;

  PERFORM inventory.post_movement(
    r_l.variant_id, r_c.partner_location_id, 'sale'::inventory.movement_type,
    -p_quantity, p_user_id, r_l.serial_id, NULL, NULL,
    'consig_venta_terc', 'consignment', r_c.id, format('consignación %s', r_c.code));

  UPDATE ops.consignment_line
     SET quantity_sold = quantity_sold + p_quantity WHERE id = p_line_id;
END $$;

-- el tercero devuelve lo que no vendió
CREATE OR REPLACE FUNCTION ops.return_consignment(
  p_line_id bigint, p_quantity numeric, p_user_id bigint)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r_l ops.consignment_line; r_c ops.consignment; v_pending numeric;
BEGIN
  SELECT * INTO r_l FROM ops.consignment_line WHERE id = p_line_id FOR UPDATE;
  SELECT * INTO r_c FROM ops.consignment WHERE id = r_l.consignment_id;
  IF r_c.status NOT IN ('active', 'settling') THEN
    RAISE EXCEPTION 'la consignación % no está activa', r_c.code;
  END IF;

  v_pending := r_l.quantity_sent - r_l.quantity_sold - r_l.quantity_returned;
  IF p_quantity > v_pending THEN
    RAISE EXCEPTION 'no puede devolver % de la línea %: solo quedan %',
      p_quantity, p_line_id, v_pending;
  END IF;

  PERFORM inventory.post_movement(
    r_l.variant_id, r_c.partner_location_id, 'consignment_out'::inventory.movement_type,
    -p_quantity, p_user_id, r_l.serial_id, NULL, NULL,
    'consig_salida_terc', 'consignment', r_c.id, format('devolución %s', r_c.code));
  PERFORM inventory.post_movement(
    r_l.variant_id, r_c.from_location_id, 'consignment_in'::inventory.movement_type,
    p_quantity, p_user_id, r_l.serial_id, NULL, NULL,
    'consig_devolucion', 'consignment', r_c.id, format('devolución %s', r_c.code));

  UPDATE ops.consignment_line
     SET quantity_returned = quantity_returned + p_quantity WHERE id = p_line_id;
END $$;

-- liquidar un período: cuánto vendió, cuánto se lleva de comisión, cuánto nos debe
CREATE OR REPLACE FUNCTION ops.settle_consignment(
  p_id bigint, p_from date, p_to date, p_user_id bigint)
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE r_c ops.consignment; v_gross numeric; v_comm numeric; v_id bigint;
BEGIN
  SELECT * INTO r_c FROM ops.consignment WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no existe la consignación %', p_id;
  END IF;

  SELECT COALESCE(sum(m.quantity * -1 * COALESCE(l.unit_price, 0)), 0) INTO v_gross
    FROM inventory.movement m
    JOIN ops.consignment_line l
      ON l.consignment_id = p_id AND l.variant_id = m.variant_id
   WHERE m.doc_type = 'consignment' AND m.doc_id = p_id
     AND m.reason_code = 'consig_venta_terc'
     AND m.occurred_at >= p_from AND m.occurred_at < (p_to + 1);

  v_comm := round(v_gross * r_c.commission_pct / 100, 4);

  INSERT INTO ops.consignment_settlement (
    consignment_id, period_from, period_to, gross_amount, commission_amount,
    net_amount, currency_code, settled_by)
  VALUES (p_id, p_from, p_to, v_gross, v_comm, v_gross - v_comm,
          r_c.currency_code, p_user_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- =============================================================================
-- APARTADOS
-- =============================================================================

CREATE OR REPLACE FUNCTION ops.register_layaway_payment(
  p_reservation_id bigint,
  p_amount         numeric,
  p_currency       char(3),
  p_user_id        bigint,
  p_method         ops.payment_method DEFAULT 'cash',
  p_receipt_no     text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql AS $$
DECLARE r_r inventory.reservation; v_paid numeric;
BEGIN
  SELECT * INTO r_r FROM inventory.reservation WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no existe el apartado %', p_reservation_id;
  END IF;
  IF r_r.status <> 'active' THEN
    RAISE EXCEPTION 'el apartado % está en %: no admite pagos', p_reservation_id, r_r.status;
  END IF;

  INSERT INTO ops.layaway_payment (reservation_id, amount, currency_code, method,
                                   received_by, receipt_no)
  VALUES (p_reservation_id, p_amount, p_currency, p_method, p_user_id, p_receipt_no);

  SELECT COALESCE(sum(amount), 0) INTO v_paid
    FROM ops.layaway_payment WHERE reservation_id = p_reservation_id;

  RETURN v_paid;
END $$;

-- el cliente no volvió: se libera la pieza y queda registrado por qué
CREATE OR REPLACE FUNCTION ops.expire_layaways(p_user_id bigint DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_count integer;
BEGIN
  WITH vencidos AS (
    UPDATE inventory.reservation
       SET status = 'expired', released_at = now()
     WHERE status = 'active'
       AND expires_at IS NOT NULL
       AND expires_at < now()
    RETURNING id)
  SELECT count(*) INTO v_count FROM vencidos;
  RETURN v_count;
END $$;

-- =============================================================================
-- VISTAS DE CONTROL
-- =============================================================================

-- el cuadre de gramos de cada orden, a la vista
CREATE OR REPLACE VIEW ops.v_work_order_balance AS
SELECT w.id,
       w.code,
       w.kind,
       w.status,
       COALESCE(i.g, 0) AS input_g,
       COALESCE(o.g, 0) AS output_g,
       COALESCE(l.recovered_g, 0) AS recovered_g,   -- recorte que sigue siendo nuestro
       COALESCE(l.lost_g, 0)      AS loss_g,        -- lo que realmente se perdió
       COALESCE(i.g, 0) - COALESCE(o.g, 0) - COALESCE(l.g, 0) AS diff_g,
       CASE WHEN COALESCE(i.g, 0) > 0
            THEN round(COALESCE(l.lost_g, 0) / i.g * 100, 3) END AS loss_pct,
       s.max_loss_pct,
       (abs(COALESCE(i.g, 0) - COALESCE(o.g, 0) - COALESCE(l.g, 0))
          <= ops.weight_tolerance_g()) AS balanced
  FROM ops.work_order w
  LEFT JOIN (SELECT work_order_id, sum(weight_g) AS g
               FROM ops.work_order_input GROUP BY 1) i ON i.work_order_id = w.id
  LEFT JOIN (SELECT work_order_id, sum(weight_g) AS g
               FROM ops.work_order_output GROUP BY 1) o ON o.work_order_id = w.id
  LEFT JOIN (SELECT work_order_id,
                    sum(weight_g) AS g,
                    sum(weight_g) FILTER (WHERE is_recovered)     AS recovered_g,
                    sum(weight_g) FILTER (WHERE NOT is_recovered) AS lost_g
               FROM ops.work_order_loss GROUP BY 1) l ON l.work_order_id = w.id
  LEFT JOIN ops.loss_standard s
         ON s.work_order_kind = w.kind AND s.material_id IS NULL AND s.is_active;

COMMENT ON VIEW ops.v_work_order_balance IS
  'Gramos que entraron, salieron y se declararon como merma en cada orden.';

-- -----------------------------------------------------------------------------
-- TODO lo que en este momento no está en una sede
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW ops.v_pieces_out AS
-- 1. piezas de clientes
SELECT 'custodia'::text              AS kind,
       c.code                        AS reference,
       c.description || ' — ' || c.customer_name AS detail,
       l.name                        AS location,
       u.full_name                   AS responsible,
       c.received_at                 AS since,
       (current_date - c.received_at::date) AS days_out,
       c.promised_on                 AS due_on,
       (c.promised_on IS NOT NULL AND c.promised_on < current_date) AS is_overdue
  FROM ops.custody_item c
  JOIN core.location l ON l.id = c.location_id
  LEFT JOIN core.app_user u ON u.id = c.received_by
 WHERE c.status NOT IN ('delivered')

UNION ALL
-- 2. órdenes de taller abiertas
SELECT 'taller',
       w.code,
       initcap(w.kind::text) || ' — ' ||
         (SELECT count(*)::text FROM ops.work_order_input i WHERE i.work_order_id = w.id)
         || ' pieza(s)',
       l.name,
       COALESCE(u.full_name, s.name, '(sin asignar)'),
       COALESCE(w.started_at, w.opened_at),
       (current_date - COALESCE(w.started_at, w.opened_at)::date),
       w.promised_on,
       (w.promised_on IS NOT NULL AND w.promised_on < current_date)
  FROM ops.work_order w
  JOIN core.location l ON l.id = w.location_id
  LEFT JOIN core.app_user u ON u.id = w.assigned_user_id
  LEFT JOIN core.supplier s ON s.id = w.assigned_supplier_id
 WHERE w.status NOT IN ('closed', 'cancelled')

UNION ALL
-- 3. mercadería en poder de un tercero
SELECT 'consignación',
       c.code,
       v.sku || ' — ' ||
         to_char(cl.quantity_sent - cl.quantity_sold - cl.quantity_returned, 'FM999999.###')
         || ' pendiente(s)',
       l.name,
       COALESCE(u.full_name, c.partner_name),
       c.started_on::timestamptz,
       (current_date - c.started_on),
       c.due_on,
       (c.due_on IS NOT NULL AND c.due_on < current_date)
  FROM ops.consignment_line cl
  JOIN ops.consignment c ON c.id = cl.consignment_id
  JOIN catalog.variant v ON v.id = cl.variant_id
  JOIN core.location l ON l.id = c.partner_location_id
  LEFT JOIN core.app_user u ON u.id = c.responsible_user_id
 WHERE c.status IN ('active', 'settling')
   AND cl.quantity_sent - cl.quantity_sold - cl.quantity_returned > 0

UNION ALL
-- 4. transferencias despachadas que todavía no llegaron
SELECT CASE WHEN t.purpose = 'exhibition' THEN 'exhibición' ELSE 'tránsito' END,
       t.code,
       lo.name || ' → ' || ld.name,
       ld.name,
       COALESCE(ur.full_name, us.full_name, '(sin responsable)'),
       t.sent_at,
       (current_date - t.sent_at::date),
       t.due_back_on,
       (t.due_back_on IS NOT NULL AND t.due_back_on < current_date)
  FROM inventory.transfer t
  JOIN core.location lo ON lo.id = t.from_location_id
  JOIN core.location ld ON ld.id = t.to_location_id
  LEFT JOIN core.app_user ur ON ur.id = t.responsible_user_id
  LEFT JOIN core.app_user us ON us.id = t.sent_by
 WHERE t.status IN ('sent', 'partially_received');

COMMENT ON VIEW ops.v_pieces_out IS
  'Todo lo que en este momento no está en una sede: custodia, taller, consignación, tránsito.';

-- lo que ya debería haber vuelto
CREATE OR REPLACE VIEW ops.v_overdue AS
SELECT * FROM ops.v_pieces_out WHERE is_overdue
UNION ALL
SELECT 'apartado',
       'RES-' || r.id::text,
       COALESCE(r.customer_name, '(sin nombre)') || ' — ' || v.sku,
       l.name,
       u.full_name,
       r.reserved_at,
       (current_date - r.reserved_at::date),
       r.expires_at::date,
       true
  FROM inventory.reservation r
  JOIN catalog.variant v ON v.id = r.variant_id
  JOIN core.location l ON l.id = r.location_id
  LEFT JOIN core.app_user u ON u.id = r.created_by
 WHERE r.status = 'active' AND r.expires_at IS NOT NULL AND r.expires_at < now();

-- la cadena de custodia de cada pieza, con la evolución del peso
CREATE OR REPLACE VIEW ops.v_custody_ledger AS
SELECT c.code,
       c.customer_name,
       c.status,
       e.occurred_at,
       e.kind                AS event,
       lf.name               AS from_location,
       lt.name               AS to_location,
       u.full_name           AS registered_by,
       e.weight_g,
       e.weight_g - c.received_weight_g AS weight_diff_g,
       w.code                AS work_order,
       e.notes
  FROM ops.custody_event e
  JOIN ops.custody_item c ON c.id = e.custody_item_id
  LEFT JOIN core.location lf ON lf.id = e.from_location_id
  LEFT JOIN core.location lt ON lt.id = e.to_location_id
  LEFT JOIN core.app_user u ON u.id = e.created_by
  LEFT JOIN ops.work_order w ON w.id = e.work_order_id
 ORDER BY c.code, e.occurred_at, e.id;

-- cuánto pagó el cliente y cuánto falta
CREATE OR REPLACE VIEW ops.v_layaway_balance AS
SELECT r.id            AS reservation_id,
       r.customer_name,
       r.customer_phone,
       v.sku,
       p.name          AS product_name,
       l.name          AS location,
       r.quantity,
       r.status,
       r.reserved_at,
       r.expires_at,
       COALESCE(r.deposit_amount, 0)        AS deposit,
       COALESCE(pay.total, 0)               AS paid,
       COALESCE(pay.payments, 0)            AS payment_count,
       pay.last_payment_at
  FROM inventory.reservation r
  JOIN catalog.variant v ON v.id = r.variant_id
  JOIN catalog.product p ON p.id = v.product_id
  JOIN core.location l ON l.id = r.location_id
  LEFT JOIN (SELECT reservation_id, sum(amount) AS total, count(*) AS payments,
                    max(paid_at) AS last_payment_at
               FROM ops.layaway_payment GROUP BY 1) pay ON pay.reservation_id = r.id
 WHERE r.kind = 'layaway';

-- cuánto oro se pierde en el taller, por tipo de trabajo
CREATE OR REPLACE VIEW ops.v_loss_summary AS
SELECT w.kind,
       count(DISTINCT w.id)                     AS orders,
       sum(b.input_g)                           AS input_g,
       sum(b.loss_g)                            AS loss_g,
       CASE WHEN sum(b.input_g) > 0
            THEN round(sum(b.loss_g) / sum(b.input_g) * 100, 3) END AS loss_pct,
       max(s.max_loss_pct)                      AS max_loss_pct
  FROM ops.work_order w
  JOIN ops.v_work_order_balance b ON b.id = w.id
  LEFT JOIN ops.loss_standard s
         ON s.work_order_kind = w.kind AND s.material_id IS NULL AND s.is_active
 WHERE w.status = 'closed'
 GROUP BY w.kind;

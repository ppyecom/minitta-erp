-- =============================================================================
-- ERP v2 — 008: corrige inventory.receive_transfer()
--
-- 1. `SET status = CASE WHEN ... THEN 'partially_received' ELSE 'received' END`
--    fallaba SIEMPRE: un CASE entre literales sin tipo resuelve a text, y la
--    columna es inventory.transfer_status ("column status is of type
--    inventory.transfer_status but expression is of type text"). Ninguna
--    transferencia se podía recibir. La prueba de humo no tenía caso de
--    transferencias; ahora lo tiene (caso 6b).
-- 2. El ajuste por faltante no llevaba serial_id: en una variante serializada
--    validate_movement() lo rechazaba. Ahora la pieza que no llegó vuelve a
--    figurar en origen con su serial.
-- =============================================================================

CREATE OR REPLACE FUNCTION inventory.receive_transfer(p_transfer_id bigint, p_user_id bigint)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r_t inventory.transfer; r_l inventory.transfer_line; v_qty numeric; v_partial boolean := false;
BEGIN
  SELECT * INTO r_t FROM inventory.transfer WHERE id = p_transfer_id FOR UPDATE;
  IF r_t.status NOT IN ('sent','partially_received') THEN
    RAISE EXCEPTION 'la transferencia % no está enviada (está en %)', p_transfer_id, r_t.status;
  END IF;

  FOR r_l IN SELECT * FROM inventory.transfer_line WHERE transfer_id = p_transfer_id LOOP
    v_qty := COALESCE(r_l.quantity_received, r_l.quantity_sent);

    IF v_qty > 0 THEN
      INSERT INTO inventory.movement (
        variant_id, location_id, serial_id, type, quantity,
        transfer_id, doc_type, doc_id, created_by)
      VALUES (r_l.variant_id, r_t.to_location_id, r_l.serial_id, 'transfer_in',
              v_qty, p_transfer_id, 'transfer', p_transfer_id, p_user_id);
    END IF;

    -- faltante: queda registrado como ajuste con motivo, no se pierde
    IF v_qty < r_l.quantity_sent THEN
      v_partial := true;
      INSERT INTO inventory.movement (
        variant_id, location_id, serial_id, type, reason_code, quantity,
        transfer_id, doc_type, doc_id, notes, created_by)
      VALUES (r_l.variant_id, r_t.from_location_id, r_l.serial_id, 'adjustment', NULL,
              r_l.quantity_sent - v_qty, p_transfer_id, 'transfer', p_transfer_id,
              'faltante en recepción de transferencia', p_user_id);
    END IF;

    UPDATE inventory.stock
       SET in_transit = GREATEST(in_transit - r_l.quantity_sent, 0), updated_at = now()
     WHERE variant_id = r_l.variant_id AND location_id = r_t.to_location_id;
  END LOOP;

  UPDATE inventory.transfer
     SET status = CASE WHEN v_partial THEN 'partially_received'::inventory.transfer_status
                       ELSE 'received'::inventory.transfer_status END,
         received_at = now(), received_by = p_user_id
   WHERE id = p_transfer_id;
END $$;

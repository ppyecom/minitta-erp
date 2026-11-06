-- =============================================================================
-- ERP v2 — 006 reglas, operaciones y vistas
-- Acá vive lo que el legacy dejaba al criterio de cada pantalla.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- validación del movimiento ANTES de insertarlo
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventory.validate_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_tracking catalog.tracking_mode;
  v_holds    boolean;
  v_allow_neg boolean;
  v_on_hand  numeric;
  v_serial_variant bigint;
BEGIN
  SELECT tracking_mode INTO v_tracking FROM catalog.variant WHERE id = NEW.variant_id;
  SELECT holds_stock, allows_negative_stock INTO v_holds, v_allow_neg
    FROM core.location WHERE id = NEW.location_id;

  IF NOT v_holds THEN
    RAISE EXCEPTION 'la sede % no maneja stock (holds_stock = false)', NEW.location_id;
  END IF;

  -- decisión 4: si la variante es serializada, se mueve pieza por pieza
  IF v_tracking = 'serial' THEN
    IF NEW.serial_id IS NULL THEN
      RAISE EXCEPTION 'la variante % es serializada: el movimiento requiere serial_id',
        NEW.variant_id;
    END IF;
    IF abs(NEW.quantity) <> 1 THEN
      RAISE EXCEPTION 'una pieza serializada mueve exactamente 1 unidad (recibido: %)',
        NEW.quantity;
    END IF;
    SELECT variant_id INTO v_serial_variant
      FROM inventory.serial_item WHERE id = NEW.serial_id;
    IF v_serial_variant <> NEW.variant_id THEN
      RAISE EXCEPTION 'la pieza % no pertenece a la variante %', NEW.serial_id, NEW.variant_id;
    END IF;
  ELSIF NEW.serial_id IS NOT NULL THEN
    RAISE EXCEPTION 'la variante % se controla por cantidad: no acepta serial_id',
      NEW.variant_id;
  END IF;

  -- motivo coherente con el tipo
  IF NEW.reason_code IS NOT NULL THEN
    PERFORM 1 FROM inventory.movement_reason
      WHERE code = NEW.reason_code AND type = NEW.type;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'el motivo % no corresponde al tipo de movimiento %',
        NEW.reason_code, NEW.type;
    END IF;
  END IF;

  -- no dejar el saldo en negativo salvo que la sede lo permita
  IF NEW.quantity < 0 AND NOT v_allow_neg THEN
    SELECT COALESCE(on_hand, 0) INTO v_on_hand
      FROM inventory.stock
     WHERE variant_id = NEW.variant_id AND location_id = NEW.location_id;
    IF COALESCE(v_on_hand, 0) + NEW.quantity < 0 THEN
      RAISE EXCEPTION
        'saldo insuficiente: variante % en sede % tiene % y se intenta mover %',
        NEW.variant_id, NEW.location_id, COALESCE(v_on_hand,0), NEW.quantity;
    END IF;
  END IF;

  IF NEW.created_by IS NULL THEN
    NEW.created_by := core.current_user_id();
  END IF;
  IF NEW.created_by IS NULL THEN
    RAISE EXCEPTION 'todo movimiento necesita usuario responsable (created_by)';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_movement_validate BEFORE INSERT ON inventory.movement
  FOR EACH ROW EXECUTE FUNCTION inventory.validate_movement();

-- -----------------------------------------------------------------------------
-- aplicación del movimiento al saldo
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventory.apply_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO inventory.stock AS s (variant_id, location_id, on_hand, last_movement_at)
  VALUES (NEW.variant_id, NEW.location_id, NEW.quantity, NEW.occurred_at)
  ON CONFLICT (variant_id, location_id) DO UPDATE
     SET on_hand          = s.on_hand + NEW.quantity,
         last_movement_at = GREATEST(COALESCE(s.last_movement_at, NEW.occurred_at), NEW.occurred_at),
         updated_at       = now();

  -- la pieza serializada sigue a su movimiento
  IF NEW.serial_id IS NOT NULL THEN
    UPDATE inventory.serial_item
       SET location_id = CASE WHEN NEW.quantity > 0 THEN NEW.location_id ELSE location_id END,
           status = CASE NEW.type
                      WHEN 'sale'            THEN 'sold'
                      WHEN 'sale_return'     THEN 'in_stock'
                      WHEN 'transfer_out'    THEN 'in_transit'
                      WHEN 'transfer_in'     THEN 'in_stock'
                      WHEN 'production_out'  THEN 'in_workshop'
                      WHEN 'production_in'   THEN 'in_stock'
                      WHEN 'loan_out'        THEN 'on_loan'
                      WHEN 'loan_in'         THEN 'in_stock'
                      WHEN 'consignment_out' THEN 'consigned'
                      WHEN 'consignment_in'  THEN 'in_stock'
                      WHEN 'scrap'           THEN 'scrapped'
                      WHEN 'opening'         THEN 'in_stock'
                      WHEN 'purchase'        THEN 'in_stock'
                      ELSE status
                    END,
           updated_at = now()
     WHERE id = NEW.serial_id;
  END IF;

  RETURN NULL;
END $$;

CREATE TRIGGER trg_movement_apply AFTER INSERT ON inventory.movement
  FOR EACH ROW EXECUTE FUNCTION inventory.apply_movement();

-- -----------------------------------------------------------------------------
-- el saldo reservado lo mantienen los apartados, no una pantalla
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventory.apply_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_old numeric := 0;
  v_new numeric := 0;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.status = 'active' THEN v_old := OLD.quantity; END IF;
  IF TG_OP <> 'DELETE' AND NEW.status = 'active' THEN v_new := NEW.quantity; END IF;

  IF TG_OP <> 'INSERT' AND v_old <> 0 THEN
    UPDATE inventory.stock
       SET reserved = GREATEST(reserved - v_old, 0), updated_at = now()
     WHERE variant_id = OLD.variant_id AND location_id = OLD.location_id;
  END IF;

  IF TG_OP <> 'DELETE' AND v_new <> 0 THEN
    INSERT INTO inventory.stock AS s (variant_id, location_id, reserved)
    VALUES (NEW.variant_id, NEW.location_id, v_new)
    ON CONFLICT (variant_id, location_id) DO UPDATE
       SET reserved = s.reserved + v_new, updated_at = now();
  END IF;

  RETURN NULL;
END $$;

CREATE TRIGGER trg_reservation_apply
  AFTER INSERT OR UPDATE OR DELETE ON inventory.reservation
  FOR EACH ROW EXECUTE FUNCTION inventory.apply_reservation();

-- -----------------------------------------------------------------------------
-- operaciones de alto nivel: la app llama a estas, no inserta a mano
-- -----------------------------------------------------------------------------

-- registrar un movimiento
CREATE OR REPLACE FUNCTION inventory.post_movement(
  p_variant_id  bigint,
  p_location_id bigint,
  p_type        inventory.movement_type,
  p_quantity    numeric,
  p_user_id     bigint,
  p_serial_id   bigint DEFAULT NULL,
  p_unit_cost   numeric DEFAULT NULL,
  p_currency    char(3) DEFAULT NULL,
  p_reason      text DEFAULT NULL,
  p_doc_type    text DEFAULT NULL,
  p_doc_id      bigint DEFAULT NULL,
  p_notes       text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now())
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO inventory.movement (
    variant_id, location_id, serial_id, type, reason_code, quantity,
    unit_cost, currency_code, occurred_at, doc_type, doc_id, notes, created_by)
  VALUES (
    p_variant_id, p_location_id, p_serial_id, p_type, p_reason, p_quantity,
    p_unit_cost, p_currency, p_occurred_at, p_doc_type, p_doc_id, p_notes, p_user_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- enviar una transferencia: descarga origen y marca en tránsito
CREATE OR REPLACE FUNCTION inventory.send_transfer(p_transfer_id bigint, p_user_id bigint)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r_t inventory.transfer; r_l inventory.transfer_line;
BEGIN
  SELECT * INTO r_t FROM inventory.transfer WHERE id = p_transfer_id FOR UPDATE;
  IF r_t.status <> 'draft' THEN
    RAISE EXCEPTION 'la transferencia % no está en borrador (está en %)', p_transfer_id, r_t.status;
  END IF;

  FOR r_l IN SELECT * FROM inventory.transfer_line WHERE transfer_id = p_transfer_id LOOP
    INSERT INTO inventory.movement (
      variant_id, location_id, serial_id, type, quantity,
      transfer_id, doc_type, doc_id, created_by)
    VALUES (r_l.variant_id, r_t.from_location_id, r_l.serial_id, 'transfer_out',
            -r_l.quantity_sent, p_transfer_id, 'transfer', p_transfer_id, p_user_id);

    UPDATE inventory.stock
       SET in_transit = in_transit + r_l.quantity_sent, updated_at = now()
     WHERE variant_id = r_l.variant_id AND location_id = r_t.to_location_id;
  END LOOP;

  UPDATE inventory.transfer
     SET status = 'sent', sent_at = now(), sent_by = p_user_id
   WHERE id = p_transfer_id;
END $$;

-- recibir una transferencia: carga destino y deja constancia de lo que no llegó
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
        variant_id, location_id, type, reason_code, quantity,
        transfer_id, doc_type, doc_id, notes, created_by)
      VALUES (r_l.variant_id, r_t.from_location_id, 'adjustment', NULL,
              r_l.quantity_sent - v_qty, p_transfer_id, 'transfer', p_transfer_id,
              'faltante en recepción de transferencia', p_user_id);
    END IF;

    UPDATE inventory.stock
       SET in_transit = GREATEST(in_transit - r_l.quantity_sent, 0), updated_at = now()
     WHERE variant_id = r_l.variant_id AND location_id = r_t.to_location_id;
  END LOOP;

  UPDATE inventory.transfer
     SET status = CASE WHEN v_partial THEN 'partially_received' ELSE 'received' END,
         received_at = now(), received_by = p_user_id
   WHERE id = p_transfer_id;
END $$;

-- abrir un inventario físico: congela el saldo del sistema como referencia
CREATE OR REPLACE FUNCTION inventory.open_count_sheet(
  p_location_id bigint, p_user_id bigint, p_is_opening boolean DEFAULT false,
  p_category_id bigint DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_code text;
BEGIN
  v_code := 'INV-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || p_location_id;

  INSERT INTO inventory.count_sheet (code, location_id, is_opening, scope_category_id, created_by)
  VALUES (v_code, p_location_id, p_is_opening, p_category_id, p_user_id)
  RETURNING id INTO v_id;

  INSERT INTO inventory.count_line (count_sheet_id, variant_id, system_qty)
  SELECT v_id, v.id, COALESCE(s.on_hand, 0)
  FROM catalog.variant v
  JOIN catalog.product p ON p.id = v.product_id
  LEFT JOIN inventory.stock s ON s.variant_id = v.id AND s.location_id = p_location_id
  WHERE v.status = 'active'
    AND (p_category_id IS NULL OR EXISTS (
          SELECT 1 FROM catalog.product_category pc
          JOIN catalog.category c  ON c.id = pc.category_id
          JOIN catalog.category sc ON sc.id = p_category_id
          WHERE pc.product_id = p.id AND c.path <@ sc.path))
    AND (NOT p_is_opening OR COALESCE(s.on_hand, 0) <> 0 OR p_is_opening);

  RETURN v_id;
END $$;

-- cerrar y aplicar: cada diferencia se vuelve un movimiento con responsable
CREATE OR REPLACE FUNCTION inventory.apply_count_sheet(p_count_sheet_id bigint, p_user_id bigint)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE r_cs inventory.count_sheet; r_cl inventory.count_line; v_applied integer := 0;
BEGIN
  SELECT * INTO r_cs FROM inventory.count_sheet WHERE id = p_count_sheet_id FOR UPDATE;
  IF r_cs.status NOT IN ('open','counting','closed') THEN
    RAISE EXCEPTION 'el conteo % ya fue aplicado o anulado (está en %)',
      p_count_sheet_id, r_cs.status;
  END IF;

  FOR r_cl IN SELECT * FROM inventory.count_line
              WHERE count_sheet_id = p_count_sheet_id
                AND counted_qty IS NOT NULL
                AND counted_qty <> system_qty LOOP
    INSERT INTO inventory.movement (
      variant_id, location_id, type, reason_code, quantity,
      doc_type, doc_id, notes, created_by)
    VALUES (r_cl.variant_id, r_cs.location_id,
            CASE WHEN r_cs.is_opening THEN 'opening'::inventory.movement_type
                 ELSE 'count'::inventory.movement_type END,
            r_cl.reason_code,
            r_cl.counted_qty - r_cl.system_qty,
            'count', p_count_sheet_id, r_cl.notes, p_user_id);
    v_applied := v_applied + 1;
  END LOOP;

  UPDATE inventory.stock s
     SET last_counted_at = now(), updated_at = now()
   WHERE s.location_id = r_cs.location_id
     AND s.variant_id IN (SELECT variant_id FROM inventory.count_line
                          WHERE count_sheet_id = p_count_sheet_id
                            AND counted_qty IS NOT NULL);

  UPDATE inventory.count_sheet
     SET status = 'applied', closed_at = COALESCE(closed_at, now()),
         applied_at = now(), approved_by = p_user_id
   WHERE id = p_count_sheet_id;

  RETURN v_applied;
END $$;

-- reconstruir el saldo desde cero: la prueba de que el caché nunca manda
CREATE OR REPLACE FUNCTION inventory.rebuild_stock() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_rows integer;
BEGIN
  UPDATE inventory.stock SET on_hand = 0, updated_at = now();

  WITH real_balance AS (
    SELECT variant_id, location_id, SUM(quantity) AS qty, MAX(occurred_at) AS last_at
    FROM inventory.movement GROUP BY 1, 2)
  INSERT INTO inventory.stock AS s (variant_id, location_id, on_hand, last_movement_at)
  SELECT variant_id, location_id, qty, last_at FROM real_balance
  ON CONFLICT (variant_id, location_id) DO UPDATE
     SET on_hand = EXCLUDED.on_hand,
         last_movement_at = EXCLUDED.last_movement_at,
         updated_at = now();

  WITH res AS (
    SELECT variant_id, location_id, SUM(quantity) AS qty
    FROM inventory.reservation WHERE status = 'active' GROUP BY 1, 2)
  UPDATE inventory.stock s
     SET reserved = COALESCE(r.qty, 0), updated_at = now()
    FROM (SELECT s2.variant_id, s2.location_id FROM inventory.stock s2) k
    LEFT JOIN res r ON r.variant_id = k.variant_id AND r.location_id = k.location_id
   WHERE s.variant_id = k.variant_id AND s.location_id = k.location_id;

  SELECT count(*) INTO v_rows FROM inventory.stock;
  RETURN v_rows;
END $$;

-- -----------------------------------------------------------------------------
-- vistas de lectura
-- -----------------------------------------------------------------------------

-- control: el saldo guardado vs. el saldo real de los movimientos
CREATE VIEW inventory.v_stock_integrity AS
SELECT COALESCE(s.variant_id, m.variant_id)   AS variant_id,
       COALESCE(s.location_id, m.location_id) AS location_id,
       COALESCE(s.on_hand, 0)                 AS cached_on_hand,
       COALESCE(m.real_on_hand, 0)            AS real_on_hand,
       COALESCE(s.on_hand, 0) - COALESCE(m.real_on_hand, 0) AS drift
FROM inventory.stock s
FULL JOIN (
  SELECT variant_id, location_id, SUM(quantity) AS real_on_hand
  FROM inventory.movement GROUP BY 1, 2
) m ON m.variant_id = s.variant_id AND m.location_id = s.location_id
WHERE COALESCE(s.on_hand, 0) <> COALESCE(m.real_on_hand, 0);

-- kardex: el movimiento con su saldo corrido. Esto es lo que hoy no existe.
CREATE VIEW inventory.v_kardex AS
SELECT m.id,
       m.occurred_at,
       m.variant_id,
       v.sku,
       v.legacy_code,
       m.location_id,
       l.code AS location_code,
       m.type,
       m.reason_code,
       m.quantity,
       SUM(m.quantity) OVER (PARTITION BY m.variant_id, m.location_id
                             ORDER BY m.occurred_at, m.id) AS running_balance,
       m.unit_cost,
       m.currency_code,
       m.doc_type,
       m.doc_id,
       u.username AS created_by_username,
       m.notes
FROM inventory.movement m
JOIN catalog.variant v ON v.id = m.variant_id
JOIN core.location  l ON l.id = m.location_id
JOIN core.app_user  u ON u.id = m.created_by;

-- catálogo plano para pantallas y para el e-commerce
CREATE VIEW catalog.v_variant_full AS
SELECT v.id            AS variant_id,
       v.sku,
       v.barcode,
       v.legacy_code,
       p.id            AS product_id,
       p.code          AS product_code,
       p.name          AS product_name,
       p.slug,
       p.kind,
       p.status        AS product_status,
       v.status        AS variant_status,
       v.tracking_mode,
       mat.code        AS material_code,
       mat.name        AS material_name,
       cat.path        AS category_path,
       cat.name        AS category_name,
       sv.label        AS size_label,
       v.metal_color,
       v.secondary_metal_color,
       COALESCE(v.weight_g, p.nominal_weight_g) AS weight_g,
       p.is_engravable,
       (SELECT count(*) FROM catalog.variant_stone vs WHERE vs.variant_id = v.id) AS stone_rows,
       (SELECT COALESCE(SUM(vs.quantity), 0) FROM catalog.variant_stone vs
         WHERE vs.variant_id = v.id) AS stone_count,
       (SELECT string_agg(DISTINCT st.name, ', ' ORDER BY st.name)
          FROM catalog.variant_stone vs JOIN catalog.stone st ON st.id = vs.stone_id
         WHERE vs.variant_id = v.id) AS stones,
       (SELECT md.url FROM catalog.media md
         WHERE (md.variant_id = v.id OR md.product_id = p.id) AND md.kind = 'image'
         ORDER BY md.is_primary DESC, md.sort_order, md.id LIMIT 1) AS image_url
FROM catalog.variant v
JOIN catalog.product p   ON p.id = v.product_id
LEFT JOIN catalog.material mat ON mat.id = p.material_id
LEFT JOIN catalog.product_category pc ON pc.product_id = p.id AND pc.is_primary
LEFT JOIN catalog.category cat ON cat.id = pc.category_id
LEFT JOIN catalog.size_value sv ON sv.id = v.size_value_id;

-- disponibilidad consolidada por sede
CREATE VIEW inventory.v_availability AS
SELECT s.variant_id,
       vf.sku,
       vf.product_name,
       s.location_id,
       l.code AS location_code,
       l.name AS location_name,
       s.on_hand,
       s.reserved,
       s.in_transit,
       s.available,
       s.min_quantity,
       (s.on_hand < s.min_quantity) AS below_min,
       s.last_movement_at,
       s.last_counted_at
FROM inventory.stock s
JOIN core.location l ON l.id = s.location_id
JOIN catalog.v_variant_full vf ON vf.variant_id = s.variant_id
WHERE l.is_active;

-- qué reponer y en qué sede
CREATE VIEW inventory.v_reorder AS
SELECT variant_id, sku, product_name, location_id, location_code,
       on_hand, min_quantity, (min_quantity - on_hand) AS suggested_qty
FROM inventory.v_availability
WHERE below_min
ORDER BY (min_quantity - on_hand) DESC;

-- dónde está cada pieza serializada
CREATE VIEW inventory.v_serial_tracking AS
SELECT si.id AS serial_id,
       si.serial_code,
       si.status,
       vf.sku,
       vf.product_name,
       l.code AS location_code,
       si.actual_weight_g,
       vf.weight_g AS nominal_weight_g,
       si.actual_weight_g - vf.weight_g AS weight_diff_g,
       si.acquired_on,
       (SELECT max(m.occurred_at) FROM inventory.movement m WHERE m.serial_id = si.id)
         AS last_movement_at
FROM inventory.serial_item si
JOIN catalog.v_variant_full vf ON vf.variant_id = si.variant_id
LEFT JOIN core.location l ON l.id = si.location_id;

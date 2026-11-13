-- =============================================================================
-- ERP v2 — 009: esquema `ops`, los procesos por donde se escapa la mercadería
--
-- El ERP viejo tenía un solo circuito: todo lo que entraba era stock. Por eso
-- la pieza del cliente, la feria y el taller se manejaban por fuera del sistema
-- — y lo que se maneja por fuera es exactamente lo que se pierde.
--
-- Acá viven los dos circuitos que faltaban:
--   1. CUSTODIA  — piezas que NO son nuestras. No pueden tocar el inventario.
--   2. ÓRDENES   — taller, consignación, apartados: toda salida tiene documento,
--                  responsable, fecha de retorno y, para el oro, cuadre en gramos.
--
-- La regla dura de este archivo: en una orden de taller
--      gramos que entran = gramos que salen + merma declarada
-- y si no cuadra, la orden no cierra.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS ops;
COMMENT ON SCHEMA ops IS 'Procesos sobre la mercadería: custodia, taller, consignación, apartados';

-- -----------------------------------------------------------------------------
-- enums
-- -----------------------------------------------------------------------------
CREATE TYPE ops.custody_status AS ENUM (
  'received',      -- recibida en mostrador
  'in_workshop',   -- en el taller
  'ready',         -- lista, esperando que el cliente la retire
  'delivered',     -- entregada y firmada
  'abandoned');    -- el cliente nunca volvió

CREATE TYPE ops.custody_event_kind AS ENUM (
  'received', 'moved', 'to_workshop', 'from_workshop',
  'weighed', 'quoted', 'delivered', 'abandoned', 'note');

CREATE TYPE ops.work_order_kind AS ENUM (
  'repair',      -- reparación
  'resize',      -- ajuste de talla
  'polish',      -- pulido / baño
  'setting',     -- engaste
  'engraving',   -- grabado
  'production',  -- fabricación
  'melt',        -- fundición
  'assembly',    -- armado
  'other');

CREATE TYPE ops.work_order_status AS ENUM (
  'draft', 'open', 'in_progress', 'finished', 'closed', 'cancelled');

-- qué entra a una orden
CREATE TYPE ops.work_item_source AS ENUM (
  'stock',     -- una variante nuestra (sale del inventario)
  'custody',   -- la pieza de un cliente (NO es inventario)
  'material'); -- metal suelto, insumo

CREATE TYPE ops.consignment_status AS ENUM (
  'draft', 'active', 'settling', 'closed', 'cancelled');

CREATE TYPE ops.payment_method AS ENUM (
  'cash', 'card', 'transfer', 'wallet', 'other');

-- -----------------------------------------------------------------------------
-- motivos de movimiento que estos procesos necesitan
-- -----------------------------------------------------------------------------
INSERT INTO inventory.movement_reason (code, name, type) VALUES
  ('taller_retorno',      'Retorno de taller a la sede',      'production_in'),
  ('consig_ingreso_terc', 'Ingreso a poder del tercero',      'consignment_in'),
  ('consig_devolucion',   'Devolución del tercero a la sede', 'consignment_in'),
  ('consig_salida_terc',  'Salida del poder del tercero',     'consignment_out'),
  ('consig_venta_terc',   'Venta realizada por el tercero',   'sale')
ON CONFLICT (code) DO NOTHING;

-- tolerancia de cuadre de gramos (balanza de joyería: 0.05 g)
INSERT INTO core.app_setting (location_id, key, value)
VALUES (NULL, 'ops.weight_tolerance_g', '0.05'::jsonb)
ON CONFLICT (location_id, key) DO NOTHING;

CREATE OR REPLACE FUNCTION ops.weight_tolerance_g() RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT value::text::numeric FROM core.app_setting
                    WHERE location_id IS NULL AND key = 'ops.weight_tolerance_g'), 0.05);
$$;

-- =============================================================================
-- 1. CUSTODIA — la pieza del cliente
-- =============================================================================
-- No tiene variant_id a propósito: no es un producto nuestro, no entra al
-- catálogo y por construcción no puede aparecer en inventory.movement.
CREATE TABLE ops.custody_item (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code             text NOT NULL UNIQUE,            -- etiqueta física que se le cuelga
  status           ops.custody_status NOT NULL DEFAULT 'received',

  customer_name    text NOT NULL,
  customer_phone   text,
  customer_document text,

  description      text NOT NULL,                   -- "anillo de compromiso, oro amarillo"
  material_id      bigint REFERENCES catalog.material(id),
  received_weight_g numeric(12,3) NOT NULL CHECK (received_weight_g > 0),
  stone_notes      text,                            -- "1 brillante central, 2 laterales"
  condition_notes  text,                            -- en qué estado llegó
  requested_service text NOT NULL,                  -- qué pidió el cliente

  location_id      bigint NOT NULL REFERENCES core.location(id),
  received_at      timestamptz NOT NULL DEFAULT now(),
  received_by      bigint NOT NULL REFERENCES core.app_user(id),
  promised_on      date,                            -- cuándo se prometió devolverla

  quoted_amount    numeric(16,4) CHECK (quoted_amount >= 0),
  quoted_currency  char(3) REFERENCES core.currency(code),

  delivered_at     timestamptz,
  delivered_by     bigint REFERENCES core.app_user(id),
  delivered_to     text,                            -- quién la retiró
  delivered_weight_g numeric(12,3) CHECK (delivered_weight_g > 0),

  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT custody_quote_currency CHECK ((quoted_amount IS NULL) = (quoted_currency IS NULL)),
  -- una pieza entregada tiene que tener fecha, responsable y peso de salida
  CONSTRAINT custody_delivery_complete CHECK (
    status <> 'delivered' OR (delivered_at IS NOT NULL
                          AND delivered_by IS NOT NULL
                          AND delivered_weight_g IS NOT NULL))
);

COMMENT ON TABLE ops.custody_item IS
  'Pieza de un cliente bajo nuestra responsabilidad. NO es inventario: no tiene variante ni stock.';

CREATE INDEX custody_status_idx   ON ops.custody_item (status) WHERE status <> 'delivered';
CREATE INDEX custody_customer_idx ON ops.custody_item USING gin (customer_name gin_trgm_ops);
CREATE INDEX custody_promised_idx ON ops.custody_item (promised_on) WHERE status <> 'delivered';

CREATE TRIGGER trg_custody_touch BEFORE UPDATE ON ops.custody_item
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER trg_custody_audit AFTER INSERT OR UPDATE OR DELETE ON ops.custody_item
  FOR EACH ROW EXECUTE FUNCTION core.audit_row();

-- -----------------------------------------------------------------------------
-- la cadena de custodia: append-only, con el peso en cada paso
-- -----------------------------------------------------------------------------
CREATE TABLE ops.custody_event (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  custody_item_id bigint NOT NULL REFERENCES ops.custody_item(id) ON DELETE RESTRICT,
  kind            ops.custody_event_kind NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),

  from_location_id bigint REFERENCES core.location(id),
  to_location_id   bigint REFERENCES core.location(id),
  from_user_id     bigint REFERENCES core.app_user(id),
  to_user_id       bigint REFERENCES core.app_user(id),

  weight_g        numeric(12,3) CHECK (weight_g > 0),  -- cuánto pesaba en ESE momento
  work_order_id   bigint,                              -- FK más abajo
  notes           text,
  created_by      bigint NOT NULL REFERENCES core.app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX custody_event_item_idx ON ops.custody_event (custody_item_id, occurred_at);

CREATE OR REPLACE FUNCTION ops.custody_event_is_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'ops.custody_event es append-only: la cadena de custodia no se edita (id=%)',
    COALESCE(OLD.id, NEW.id);
END $$;

CREATE TRIGGER trg_custody_event_no_update BEFORE UPDATE ON ops.custody_event
  FOR EACH ROW EXECUTE FUNCTION ops.custody_event_is_immutable();
CREATE TRIGGER trg_custody_event_no_delete BEFORE DELETE ON ops.custody_event
  FOR EACH ROW EXECUTE FUNCTION ops.custody_event_is_immutable();

-- al recibir la pieza, el primer eslabón de la cadena se escribe solo
CREATE OR REPLACE FUNCTION ops.custody_log_reception() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ops.custody_event (custody_item_id, kind, occurred_at, to_location_id,
                                 to_user_id, weight_g, notes, created_by)
  VALUES (NEW.id, 'received', NEW.received_at, NEW.location_id, NEW.received_by,
          NEW.received_weight_g, NEW.condition_notes, NEW.received_by);
  RETURN NULL;
END $$;

CREATE TRIGGER trg_custody_log_reception AFTER INSERT ON ops.custody_item
  FOR EACH ROW EXECUTE FUNCTION ops.custody_log_reception();

-- =============================================================================
-- 2. ÓRDENES DE TALLER
-- =============================================================================
CREATE TABLE ops.work_order (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  kind            ops.work_order_kind NOT NULL,
  status          ops.work_order_status NOT NULL DEFAULT 'draft',

  location_id     bigint NOT NULL REFERENCES core.location(id),  -- el taller
  custody_item_id bigint REFERENCES ops.custody_item(id),        -- si es pieza de cliente

  assigned_user_id     bigint REFERENCES core.app_user(id),
  assigned_supplier_id bigint REFERENCES core.supplier(id),      -- taller externo

  opened_at       timestamptz NOT NULL DEFAULT now(),
  promised_on     date,
  started_at      timestamptz,
  finished_at     timestamptz,
  closed_at       timestamptz,

  labor_cost      numeric(16,4) CHECK (labor_cost >= 0),
  labor_currency  char(3) REFERENCES core.currency(code),

  notes           text,
  created_by      bigint NOT NULL REFERENCES core.app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT wo_labor_currency CHECK ((labor_cost IS NULL) = (labor_currency IS NULL))
);

CREATE INDEX wo_status_idx   ON ops.work_order (status) WHERE status NOT IN ('closed','cancelled');
CREATE INDEX wo_promised_idx ON ops.work_order (promised_on) WHERE status NOT IN ('closed','cancelled');
CREATE INDEX wo_custody_idx  ON ops.work_order (custody_item_id);

ALTER TABLE ops.custody_event
  ADD CONSTRAINT custody_event_work_order_fk
  FOREIGN KEY (work_order_id) REFERENCES ops.work_order(id);

CREATE TRIGGER trg_wo_touch BEFORE UPDATE ON ops.work_order
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER trg_wo_audit AFTER INSERT OR UPDATE OR DELETE ON ops.work_order
  FOR EACH ROW EXECUTE FUNCTION core.audit_row();

-- el taller tiene que ser un taller (o un tercero), no la tienda
CREATE OR REPLACE FUNCTION ops.validate_work_order() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_kind core.location_kind; v_holds boolean;
BEGIN
  SELECT kind, holds_stock INTO v_kind, v_holds
    FROM core.location WHERE id = NEW.location_id;
  IF v_kind NOT IN ('workshop', 'consignment') THEN
    RAISE EXCEPTION 'la orden de taller % apunta a una sede de tipo % (debe ser workshop)',
      NEW.code, v_kind;
  END IF;
  IF NOT v_holds THEN
    RAISE EXCEPTION 'el taller % no maneja stock: no puede recibir piezas', NEW.location_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_wo_validate BEFORE INSERT OR UPDATE ON ops.work_order
  FOR EACH ROW EXECUTE FUNCTION ops.validate_work_order();

-- -----------------------------------------------------------------------------
-- lo que entra y lo que sale, SIEMPRE con su peso
-- -----------------------------------------------------------------------------
CREATE TABLE ops.work_order_input (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_order_id   bigint NOT NULL REFERENCES ops.work_order(id) ON DELETE CASCADE,
  source          ops.work_item_source NOT NULL,

  variant_id      bigint REFERENCES catalog.variant(id),
  serial_id       bigint REFERENCES inventory.serial_item(id),
  custody_item_id bigint REFERENCES ops.custody_item(id),
  material_id     bigint REFERENCES catalog.material(id),
  from_location_id bigint REFERENCES core.location(id),

  quantity        numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  weight_g        numeric(12,3) NOT NULL CHECK (weight_g > 0),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT wo_input_shape CHECK (
    CASE source
      WHEN 'stock'    THEN variant_id IS NOT NULL AND from_location_id IS NOT NULL
                           AND custody_item_id IS NULL
      WHEN 'custody'  THEN custody_item_id IS NOT NULL AND variant_id IS NULL
      WHEN 'material' THEN material_id IS NOT NULL AND variant_id IS NULL
                           AND custody_item_id IS NULL
    END)
);

CREATE INDEX wo_input_order_idx ON ops.work_order_input (work_order_id);

CREATE TABLE ops.work_order_output (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_order_id   bigint NOT NULL REFERENCES ops.work_order(id) ON DELETE CASCADE,

  variant_id      bigint REFERENCES catalog.variant(id),
  serial_id       bigint REFERENCES inventory.serial_item(id),
  custody_item_id bigint REFERENCES ops.custody_item(id),
  to_location_id  bigint REFERENCES core.location(id),

  quantity        numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  weight_g        numeric(12,3) NOT NULL CHECK (weight_g > 0),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- o vuelve al inventario (con destino), o vuelve al cliente: nunca las dos
  CONSTRAINT wo_output_shape CHECK (
    (variant_id IS NOT NULL AND to_location_id IS NOT NULL AND custody_item_id IS NULL)
    OR (custody_item_id IS NOT NULL AND variant_id IS NULL))
);

CREATE INDEX wo_output_order_idx ON ops.work_order_output (work_order_id);

-- la merma: gramos que no vuelven. En joyería esto es dinero.
CREATE TABLE ops.work_order_loss (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_order_id bigint NOT NULL REFERENCES ops.work_order(id) ON DELETE CASCADE,
  material_id   bigint REFERENCES catalog.material(id),
  weight_g      numeric(12,3) NOT NULL CHECK (weight_g > 0),
  is_recovered  boolean NOT NULL DEFAULT false,   -- limadura recuperada vs perdida
  reason        text NOT NULL,
  approved_by   bigint REFERENCES core.app_user(id),
  approved_at   timestamptz,
  created_by    bigint NOT NULL REFERENCES core.app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX wo_loss_order_idx ON ops.work_order_loss (work_order_id);

-- cuánta merma se acepta sin que alguien la firme
CREATE TABLE ops.loss_standard (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_order_kind ops.work_order_kind NOT NULL,
  material_id    bigint REFERENCES catalog.material(id),
  max_loss_pct   numeric(6,3) NOT NULL CHECK (max_loss_pct >= 0),
  notes          text,
  is_active      boolean NOT NULL DEFAULT true,
  UNIQUE NULLS NOT DISTINCT (work_order_kind, material_id)
);

COMMENT ON TABLE ops.loss_standard IS
  'Merma aceptable por tipo de trabajo. Por encima, la orden exige aprobación de un segundo usuario.';

INSERT INTO ops.loss_standard (work_order_kind, material_id, max_loss_pct, notes) VALUES
  ('repair',     NULL, 0.5, 'soldadura y limpieza'),
  ('resize',     NULL, 2.0, 'corte de aro'),
  ('polish',     NULL, 1.0, 'pulido y abrillantado'),
  ('setting',    NULL, 0.5, 'engaste'),
  ('engraving',  NULL, 0.3, 'grabado'),
  ('production', NULL, 3.0, 'fabricación desde metal'),
  ('melt',       NULL, 5.0, 'fundición'),
  ('assembly',   NULL, 0.5, 'armado'),
  ('other',      NULL, 1.0, NULL);

-- =============================================================================
-- 3. CONSIGNACIÓN
-- =============================================================================
CREATE TABLE ops.consignment (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  status          ops.consignment_status NOT NULL DEFAULT 'draft',

  partner_location_id bigint NOT NULL REFERENCES core.location(id),
  partner_name    text NOT NULL,
  partner_contact text,

  from_location_id bigint NOT NULL REFERENCES core.location(id),  -- de qué sede sale
  commission_pct  numeric(6,3) NOT NULL DEFAULT 0 CHECK (commission_pct >= 0 AND commission_pct <= 100),
  currency_code   char(3) NOT NULL REFERENCES core.currency(code),

  started_on      date NOT NULL DEFAULT current_date,
  due_on          date,                               -- cuándo vence el acuerdo
  closed_at       timestamptz,

  responsible_user_id bigint REFERENCES core.app_user(id),
  notes           text,
  created_by      bigint NOT NULL REFERENCES core.app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX consignment_status_idx ON ops.consignment (status) WHERE status = 'active';
CREATE INDEX consignment_due_idx    ON ops.consignment (due_on) WHERE status = 'active';

CREATE TRIGGER trg_consignment_touch BEFORE UPDATE ON ops.consignment
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER trg_consignment_audit AFTER INSERT OR UPDATE OR DELETE ON ops.consignment
  FOR EACH ROW EXECUTE FUNCTION core.audit_row();

CREATE OR REPLACE FUNCTION ops.validate_consignment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_third boolean; v_holds boolean;
BEGIN
  SELECT is_third_party, holds_stock INTO v_third, v_holds
    FROM core.location WHERE id = NEW.partner_location_id;
  IF NOT v_third THEN
    RAISE EXCEPTION 'la sede del consignatario debe estar marcada is_third_party (sede %)',
      NEW.partner_location_id;
  END IF;
  IF NOT v_holds THEN
    RAISE EXCEPTION 'la sede del consignatario % debe manejar stock', NEW.partner_location_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_consignment_validate BEFORE INSERT OR UPDATE ON ops.consignment
  FOR EACH ROW EXECUTE FUNCTION ops.validate_consignment();

CREATE TABLE ops.consignment_line (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  consignment_id  bigint NOT NULL REFERENCES ops.consignment(id) ON DELETE CASCADE,
  variant_id      bigint NOT NULL REFERENCES catalog.variant(id),
  serial_id       bigint REFERENCES inventory.serial_item(id),

  quantity_sent     numeric(14,3) NOT NULL CHECK (quantity_sent > 0),
  quantity_sold     numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_sold >= 0),
  quantity_returned numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_returned >= 0),

  unit_price      numeric(16,4) CHECK (unit_price >= 0),
  notes           text,

  CONSTRAINT consignment_line_balance CHECK (quantity_sold + quantity_returned <= quantity_sent)
);

CREATE INDEX consignment_line_idx ON ops.consignment_line (consignment_id);

CREATE TABLE ops.consignment_settlement (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  consignment_id  bigint NOT NULL REFERENCES ops.consignment(id) ON DELETE RESTRICT,
  period_from     date NOT NULL,
  period_to       date NOT NULL,
  gross_amount    numeric(16,4) NOT NULL CHECK (gross_amount >= 0),
  commission_amount numeric(16,4) NOT NULL CHECK (commission_amount >= 0),
  net_amount      numeric(16,4) NOT NULL,
  currency_code   char(3) NOT NULL REFERENCES core.currency(code),
  settled_at      timestamptz NOT NULL DEFAULT now(),
  settled_by      bigint NOT NULL REFERENCES core.app_user(id),
  notes           text,
  CONSTRAINT settlement_period CHECK (period_to >= period_from)
);

-- =============================================================================
-- 4. APARTADOS — pagos sobre inventory.reservation
-- =============================================================================
CREATE TABLE ops.layaway_payment (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id bigint NOT NULL REFERENCES inventory.reservation(id) ON DELETE RESTRICT,
  amount         numeric(16,4) NOT NULL CHECK (amount > 0),
  currency_code  char(3) NOT NULL REFERENCES core.currency(code),
  method         ops.payment_method NOT NULL DEFAULT 'cash',
  paid_at        timestamptz NOT NULL DEFAULT now(),
  received_by    bigint NOT NULL REFERENCES core.app_user(id),
  receipt_no     text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX layaway_payment_res_idx ON ops.layaway_payment (reservation_id, paid_at);

CREATE OR REPLACE FUNCTION ops.layaway_payment_is_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'ops.layaway_payment es append-only: un pago mal cargado se corrige con otro pago (id=%)',
    COALESCE(OLD.id, NEW.id);
END $$;

CREATE TRIGGER trg_layaway_payment_no_update BEFORE UPDATE ON ops.layaway_payment
  FOR EACH ROW EXECUTE FUNCTION ops.layaway_payment_is_immutable();
CREATE TRIGGER trg_layaway_payment_no_delete BEFORE DELETE ON ops.layaway_payment
  FOR EACH ROW EXECUTE FUNCTION ops.layaway_payment_is_immutable();

-- =============================================================================
-- 5. EXHIBICIONES QUE VUELVEN — la transferencia necesita fecha y responsable
-- =============================================================================
ALTER TABLE inventory.transfer
  ADD COLUMN due_back_on date,
  ADD COLUMN responsible_user_id bigint REFERENCES core.app_user(id);

COMMENT ON COLUMN inventory.transfer.due_back_on IS
  'Para purpose = exhibition / repair: cuándo se comprometió el retorno.';

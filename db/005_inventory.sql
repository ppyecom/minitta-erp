-- =============================================================================
-- ERP v2 — 005 inventory: kardex, saldos, piezas serializadas, apartados,
--                          transferencias, inventarios físicos
-- Decisión 4: variant.tracking_mode = 'serial' obliga a mover pieza por pieza.
-- Decisión 5: el stock arranca con inventario físico por sede (count_sheet).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- piezas serializadas: identidad propia para la pieza física
-- -----------------------------------------------------------------------------
CREATE TYPE inventory.serial_status AS ENUM (
  'in_stock',     -- en vitrina o caja fuerte
  'reserved',     -- apartada por un cliente
  'in_transit',   -- viajando entre sedes
  'in_workshop',  -- en el taller (reparación / ajuste de talla)
  'on_loan',      -- prestada para exhibición
  'consigned',    -- en poder de un tercero
  'sold',
  'returned',
  'lost',
  'scrapped'      -- fundida / dada de baja
);

CREATE TABLE inventory.serial_item (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id      bigint NOT NULL REFERENCES catalog.variant(id) ON DELETE RESTRICT,
  serial_code     text NOT NULL UNIQUE,              -- etiqueta / QR de la pieza
  location_id     bigint REFERENCES core.location(id),
  status          inventory.serial_status NOT NULL DEFAULT 'in_stock',

  -- el dato que hoy se pierde: dos piezas del mismo modelo no pesan igual
  actual_weight_g numeric(12,3) CHECK (actual_weight_g > 0),
  actual_size_label text,                            -- si se ajustó la talla en taller

  supplier_id     bigint REFERENCES core.supplier(id),
  acquisition_cost numeric(16,4) CHECK (acquisition_cost >= 0),
  acquisition_currency char(3) REFERENCES core.currency(code),
  acquired_on     date,

  engraving_text  text,                              -- lo grabado en ESTA pieza
  engraving_font_id bigint REFERENCES catalog.engraving_font(id),

  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT serial_cost_currency CHECK (
    (acquisition_cost IS NULL) = (acquisition_currency IS NULL))
);
CREATE INDEX serial_variant_idx  ON inventory.serial_item (variant_id, status);
CREATE INDEX serial_location_idx ON inventory.serial_item (location_id, status);
CREATE TRIGGER trg_serial_touch BEFORE UPDATE ON inventory.serial_item
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER trg_serial_audit AFTER INSERT OR UPDATE OR DELETE ON inventory.serial_item
  FOR EACH ROW EXECUTE FUNCTION core.audit_row();

-- certificados de gema, por pieza (hoy son papeles en un cajón)
CREATE TABLE inventory.certification (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  serial_id      bigint NOT NULL REFERENCES inventory.serial_item(id) ON DELETE CASCADE,
  authority      text NOT NULL,                      -- 'GIA','IGI','interno'
  certificate_no text NOT NULL,
  issued_on      date,
  media_id       bigint REFERENCES catalog.media(id),
  details        jsonb NOT NULL DEFAULT '{}',
  UNIQUE (authority, certificate_no)
);

-- -----------------------------------------------------------------------------
-- motivos de movimiento: el "Estado = 'L'" del legacy, pero con diccionario
-- -----------------------------------------------------------------------------
CREATE TYPE inventory.movement_type AS ENUM (
  'opening',          -- carga inicial (inventario físico de arranque)
  'purchase',         -- compra a proveedor
  'purchase_return',
  'sale',
  'sale_return',
  'transfer_out',
  'transfer_in',
  'adjustment',       -- ajuste manual justificado
  'count',            -- diferencia de inventario físico
  'production_in',    -- entra del taller
  'production_out',   -- sale al taller (reparación, fundición, ajuste)
  'scrap',            -- merma / baja
  'loan_out',         -- préstamo para exhibición
  'loan_in',
  'consignment_out',  -- entrega en consignación
  'consignment_in'
);

CREATE TABLE inventory.movement_reason (
  code        text PRIMARY KEY,                      -- 'robo','rotura','merma_taller','error_digitacion'
  name        text NOT NULL,
  type        inventory.movement_type NOT NULL,
  requires_note boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true
);

-- -----------------------------------------------------------------------------
-- transferencias entre sedes
-- -----------------------------------------------------------------------------
CREATE TYPE inventory.transfer_status AS ENUM ('draft','sent','partially_received','received','cancelled');
CREATE TYPE inventory.transfer_purpose AS ENUM ('restock','exhibition','repair','return','rebalance');

CREATE TABLE inventory.transfer (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code             text NOT NULL UNIQUE,
  from_location_id bigint NOT NULL REFERENCES core.location(id),
  to_location_id   bigint NOT NULL REFERENCES core.location(id),
  purpose          inventory.transfer_purpose NOT NULL DEFAULT 'restock',
  status           inventory.transfer_status NOT NULL DEFAULT 'draft',
  sent_at          timestamptz,
  received_at      timestamptz,
  sent_by          bigint REFERENCES core.app_user(id),
  received_by      bigint REFERENCES core.app_user(id),
  carrier          text,                             -- quién la llevó
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transfer_locations_differ CHECK (from_location_id <> to_location_id),
  CONSTRAINT transfer_received_after_sent CHECK (
    received_at IS NULL OR sent_at IS NULL OR received_at >= sent_at)
);
CREATE TRIGGER trg_transfer_touch BEFORE UPDATE ON inventory.transfer
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

CREATE TABLE inventory.transfer_line (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transfer_id       bigint NOT NULL REFERENCES inventory.transfer(id) ON DELETE CASCADE,
  variant_id        bigint NOT NULL REFERENCES catalog.variant(id),
  serial_id         bigint REFERENCES inventory.serial_item(id),
  quantity_sent     numeric(14,3) NOT NULL CHECK (quantity_sent > 0),
  quantity_received numeric(14,3) CHECK (quantity_received >= 0),
  notes             text,
  CONSTRAINT transfer_line_received_not_more CHECK (
    quantity_received IS NULL OR quantity_received <= quantity_sent)
);
CREATE INDEX transfer_line_transfer_idx ON inventory.transfer_line (transfer_id);
CREATE UNIQUE INDEX transfer_line_serial_once
  ON inventory.transfer_line (transfer_id, serial_id) WHERE serial_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- MOVIMIENTO: la única fuente de verdad del inventario. Append-only.
-- -----------------------------------------------------------------------------
CREATE TABLE inventory.movement (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id    bigint NOT NULL REFERENCES catalog.variant(id) ON DELETE RESTRICT,
  location_id   bigint NOT NULL REFERENCES core.location(id) ON DELETE RESTRICT,
  serial_id     bigint REFERENCES inventory.serial_item(id),

  type          inventory.movement_type NOT NULL,
  reason_code   text REFERENCES inventory.movement_reason(code),
  quantity      numeric(14,3) NOT NULL CHECK (quantity <> 0),   -- (+) entra, (-) sale

  unit_cost     numeric(16,4) CHECK (unit_cost >= 0),
  currency_code char(3) REFERENCES core.currency(code),

  occurred_at   timestamptz NOT NULL DEFAULT now(),

  -- documento origen, sin FK rígida a módulos que todavía no existen
  doc_type      text,                                -- 'sale','purchase','transfer','count'
  doc_id        bigint,
  transfer_id   bigint REFERENCES inventory.transfer(id),

  notes         text,
  created_by    bigint NOT NULL REFERENCES core.app_user(id),
  client_info   text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT movement_cost_currency CHECK ((unit_cost IS NULL) = (currency_code IS NULL))
);
CREATE INDEX movement_kardex_idx   ON inventory.movement (variant_id, location_id, occurred_at, id);
CREATE INDEX movement_doc_idx      ON inventory.movement (doc_type, doc_id);
CREATE INDEX movement_serial_idx   ON inventory.movement (serial_id, occurred_at);
CREATE INDEX movement_location_idx ON inventory.movement (location_id, occurred_at DESC);

-- nunca se edita ni se borra: un error se corrige con un movimiento de ajuste
CREATE OR REPLACE FUNCTION inventory.movement_is_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'inventory.movement es append-only: corrija con un movimiento de ajuste (id=%)',
    COALESCE(OLD.id, NEW.id);
END $$;

CREATE TRIGGER trg_movement_no_update BEFORE UPDATE ON inventory.movement
  FOR EACH ROW EXECUTE FUNCTION inventory.movement_is_immutable();
CREATE TRIGGER trg_movement_no_delete BEFORE DELETE ON inventory.movement
  FOR EACH ROW EXECUTE FUNCTION inventory.movement_is_immutable();

-- -----------------------------------------------------------------------------
-- SALDO: caché derivado de los movimientos, nunca se escribe a mano
-- -----------------------------------------------------------------------------
CREATE TABLE inventory.stock (
  variant_id   bigint NOT NULL REFERENCES catalog.variant(id) ON DELETE CASCADE,
  location_id  bigint NOT NULL REFERENCES core.location(id) ON DELETE CASCADE,
  on_hand      numeric(14,3) NOT NULL DEFAULT 0,
  reserved     numeric(14,3) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  in_transit   numeric(14,3) NOT NULL DEFAULT 0 CHECK (in_transit >= 0),
  available    numeric(14,3) GENERATED ALWAYS AS (on_hand - reserved) STORED,

  -- stock mínimo POR SEDE (el legacy tenía uno global, siempre en 1)
  min_quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  max_quantity numeric(14,3) CHECK (max_quantity IS NULL OR max_quantity >= min_quantity),

  last_movement_at timestamptz,
  last_counted_at  timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (variant_id, location_id)
);
CREATE INDEX stock_location_idx ON inventory.stock (location_id);
CREATE INDEX stock_below_min_idx ON inventory.stock (location_id)
  WHERE on_hand < min_quantity;

-- -----------------------------------------------------------------------------
-- apartados / reservas: hoy se anotan en un papel en la vitrina
-- -----------------------------------------------------------------------------
CREATE TYPE inventory.reservation_status AS ENUM ('active','fulfilled','cancelled','expired');
CREATE TYPE inventory.reservation_kind AS ENUM ('layaway','cart','order','hold','repair');

CREATE TABLE inventory.reservation (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id  bigint NOT NULL REFERENCES catalog.variant(id) ON DELETE RESTRICT,
  location_id bigint NOT NULL REFERENCES core.location(id) ON DELETE RESTRICT,
  serial_id   bigint REFERENCES inventory.serial_item(id),
  kind        inventory.reservation_kind NOT NULL DEFAULT 'layaway',
  status      inventory.reservation_status NOT NULL DEFAULT 'active',
  quantity    numeric(14,3) NOT NULL CHECK (quantity > 0),

  customer_name  text,                               -- hasta que exista el módulo de clientes
  customer_phone text,
  customer_id    bigint,                             -- FK futura a sales.customer
  deposit_amount numeric(16,4) CHECK (deposit_amount >= 0),
  deposit_currency char(3) REFERENCES core.currency(code),

  reserved_at  timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  released_at  timestamptz,
  created_by   bigint NOT NULL REFERENCES core.app_user(id),
  notes        text,

  CONSTRAINT reservation_expires_after CHECK (expires_at IS NULL OR expires_at > reserved_at),
  CONSTRAINT reservation_closed_has_date CHECK (
    (status = 'active') = (released_at IS NULL))
);
CREATE INDEX reservation_active_idx ON inventory.reservation (variant_id, location_id)
  WHERE status = 'active';
CREATE INDEX reservation_expiry_idx ON inventory.reservation (expires_at)
  WHERE status = 'active';
CREATE UNIQUE INDEX reservation_serial_once ON inventory.reservation (serial_id)
  WHERE status = 'active' AND serial_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- inventario físico (decisión 5: así arranca el stock)
-- -----------------------------------------------------------------------------
CREATE TYPE inventory.count_status AS ENUM ('open','counting','closed','applied','cancelled');

CREATE TABLE inventory.count_sheet (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         text NOT NULL UNIQUE,
  location_id  bigint NOT NULL REFERENCES core.location(id),
  status       inventory.count_status NOT NULL DEFAULT 'open',
  is_opening   boolean NOT NULL DEFAULT false,       -- true = conteo de arranque del ERP
  scope_category_id bigint REFERENCES catalog.category(id),   -- conteo parcial
  started_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz,
  applied_at   timestamptz,
  created_by   bigint NOT NULL REFERENCES core.app_user(id),
  counted_by   bigint REFERENCES core.app_user(id),
  approved_by  bigint REFERENCES core.app_user(id),
  notes        text,
  CONSTRAINT count_closed_after_start CHECK (closed_at IS NULL OR closed_at >= started_at)
);
CREATE INDEX count_sheet_location_idx ON inventory.count_sheet (location_id, started_at DESC);
CREATE UNIQUE INDEX count_sheet_one_open ON inventory.count_sheet (location_id)
  WHERE status IN ('open','counting');

CREATE TABLE inventory.count_line (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  count_sheet_id bigint NOT NULL REFERENCES inventory.count_sheet(id) ON DELETE CASCADE,
  variant_id     bigint NOT NULL REFERENCES catalog.variant(id),
  system_qty     numeric(14,3) NOT NULL,             -- foto del saldo al abrir el conteo
  counted_qty    numeric(14,3) CHECK (counted_qty >= 0),
  difference     numeric(14,3) GENERATED ALWAYS AS (counted_qty - system_qty) STORED,
  reason_code    text REFERENCES inventory.movement_reason(code),
  notes          text,
  counted_at     timestamptz,
  UNIQUE (count_sheet_id, variant_id)
);
CREATE INDEX count_line_diff_idx ON inventory.count_line (count_sheet_id)
  WHERE counted_qty IS NOT NULL;

-- piezas serializadas vistas (o no) en un conteo
CREATE TABLE inventory.count_serial (
  count_sheet_id bigint NOT NULL REFERENCES inventory.count_sheet(id) ON DELETE CASCADE,
  serial_id      bigint NOT NULL REFERENCES inventory.serial_item(id),
  was_found      boolean NOT NULL,
  notes          text,
  PRIMARY KEY (count_sheet_id, serial_id)
);

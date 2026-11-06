-- =============================================================================
-- ERP v2 — 004 pricing: listas de precio, precio fijo Y calculado, costos,
--                        precio del gramo, tipo de cambio
-- Decisión 3: el precio se puede FIJAR a mano o CALCULAR. Los dos modos conviven.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- precio del metal por gramo y por fecha  (no existía: PREC_GR era una columna suelta)
-- -----------------------------------------------------------------------------
CREATE TABLE pricing.metal_rate (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  material_id    bigint NOT NULL REFERENCES catalog.material(id) ON DELETE CASCADE,
  price_per_gram numeric(16,6) NOT NULL CHECK (price_per_gram > 0),
  currency_code  char(3) NOT NULL REFERENCES core.currency(code),
  valid_from     date NOT NULL,
  source         text,                               -- 'proveedor','bolsa','manual'
  created_by     bigint REFERENCES core.app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (material_id, currency_code, valid_from)
);
CREATE INDEX metal_rate_lookup ON pricing.metal_rate (material_id, valid_from DESC);

CREATE OR REPLACE FUNCTION pricing.metal_rate_at(
  p_material_id bigint, p_currency char(3), p_date date DEFAULT current_date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT price_per_gram FROM pricing.metal_rate
  WHERE material_id = p_material_id AND currency_code = p_currency
    AND valid_from <= p_date
  ORDER BY valid_from DESC LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- tipo de cambio  (TIPO_MONEDA existía sin tasas: nada se podía consolidar)
-- -----------------------------------------------------------------------------
CREATE TABLE pricing.exchange_rate (
  currency_code char(3) NOT NULL REFERENCES core.currency(code),
  rate_date     date NOT NULL,
  buy           numeric(14,6) NOT NULL CHECK (buy > 0),
  sell          numeric(14,6) NOT NULL CHECK (sell > 0),
  source        text,                                -- 'SUNAT','SBS','manual'
  PRIMARY KEY (currency_code, rate_date),
  CONSTRAINT exchange_rate_spread CHECK (sell >= buy)
);

CREATE OR REPLACE FUNCTION pricing.exchange_rate_at(
  p_currency char(3), p_date date DEFAULT current_date, p_side text DEFAULT 'sell')
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_side = 'buy' THEN buy ELSE sell END
  FROM pricing.exchange_rate
  WHERE currency_code = p_currency AND rate_date <= p_date
  ORDER BY rate_date DESC LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- mano de obra del taller (para el costeo por peso)
-- -----------------------------------------------------------------------------
CREATE TABLE pricing.labor_rate (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text NOT NULL UNIQUE,                -- 'fundicion','engaste','pulido','armado'
  name          text NOT NULL,
  cost_per_gram numeric(14,4) CHECK (cost_per_gram >= 0),
  cost_per_piece numeric(14,4) CHECK (cost_per_piece >= 0),
  cost_per_stone numeric(14,4) CHECK (cost_per_stone >= 0),
  currency_code char(3) NOT NULL REFERENCES core.currency(code),
  valid_from    date NOT NULL DEFAULT current_date,
  is_active     boolean NOT NULL DEFAULT true
);

-- -----------------------------------------------------------------------------
-- costo desagregado y con historia  (reemplaza la "CLAVE" codificada en letras)
-- -----------------------------------------------------------------------------
CREATE TYPE pricing.cost_source AS ENUM ('manual','calculated','purchase','migration');

CREATE TABLE pricing.variant_cost (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id    bigint NOT NULL REFERENCES catalog.variant(id) ON DELETE CASCADE,
  metal_cost    numeric(16,4) NOT NULL DEFAULT 0 CHECK (metal_cost   >= 0),
  stone_cost    numeric(16,4) NOT NULL DEFAULT 0 CHECK (stone_cost   >= 0),
  labor_cost    numeric(16,4) NOT NULL DEFAULT 0 CHECK (labor_cost   >= 0),
  plating_cost  numeric(16,4) NOT NULL DEFAULT 0 CHECK (plating_cost >= 0),
  packaging_cost numeric(16,4) NOT NULL DEFAULT 0 CHECK (packaging_cost >= 0),
  other_cost    numeric(16,4) NOT NULL DEFAULT 0 CHECK (other_cost   >= 0),
  total_cost    numeric(16,4) GENERATED ALWAYS AS
                  (metal_cost + stone_cost + labor_cost + plating_cost
                   + packaging_cost + other_cost) STORED,
  currency_code char(3) NOT NULL REFERENCES core.currency(code),
  source        pricing.cost_source NOT NULL DEFAULT 'manual',
  valid_from    timestamptz NOT NULL DEFAULT now(),
  valid_to      timestamptz,
  created_by    bigint REFERENCES core.app_user(id),
  notes         text,
  CONSTRAINT variant_cost_period CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE UNIQUE INDEX variant_cost_current ON pricing.variant_cost (variant_id)
  WHERE valid_to IS NULL;
CREATE INDEX variant_cost_history ON pricing.variant_cost (variant_id, valid_from DESC);

-- costo del metal calculado desde el peso y la cotización del día
CREATE OR REPLACE FUNCTION pricing.calc_metal_cost(
  p_variant_id bigint, p_currency char(3), p_date date DEFAULT current_date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
           COALESCE(v.weight_g, p.nominal_weight_g)
           * pricing.metal_rate_at(p.material_id, p_currency, p_date), 0)
  FROM catalog.variant v
  JOIN catalog.product p ON p.id = v.product_id
  WHERE v.id = p_variant_id;
$$;

-- costo de las piedras sumando catalog.variant_stone
CREATE OR REPLACE FUNCTION pricing.calc_stone_cost(
  p_variant_id bigint, p_currency char(3), p_date date DEFAULT current_date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(
           vs.unit_cost * vs.quantity
           * CASE WHEN vs.cost_currency = p_currency THEN 1
                  ELSE COALESCE(pricing.exchange_rate_at(vs.cost_currency, p_date), 1) END
         ), 0)
  FROM catalog.variant_stone vs
  WHERE vs.variant_id = p_variant_id AND vs.unit_cost IS NOT NULL;
$$;

-- -----------------------------------------------------------------------------
-- listas de precio  (decisión 2: público, comerciante, mayorista, e-commerce)
-- -----------------------------------------------------------------------------
CREATE TABLE pricing.price_list (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code           text NOT NULL UNIQUE,               -- 'publico','comerciante','mayorista','ecommerce'
  name           text NOT NULL,
  currency_code  char(3) NOT NULL REFERENCES core.currency(code),
  includes_tax   boolean NOT NULL DEFAULT true,
  -- margen por defecto cuando el precio se calcula desde el costo
  default_margin_pct numeric(8,4) CHECK (default_margin_pct >= 0),
  -- redondeo comercial: 0.10 deja 236.10 ; 1 deja 236 ; 0.5 deja 236.50
  rounding_step  numeric(8,4) NOT NULL DEFAULT 0.01 CHECK (rounding_step > 0),
  min_order_qty  numeric(12,3) NOT NULL DEFAULT 1 CHECK (min_order_qty > 0),
  priority       int NOT NULL DEFAULT 0,             -- si una variante cae en 2 listas
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_price_list_touch BEFORE UPDATE ON pricing.price_list
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- una lista puede estar restringida a ciertas sedes
-- (Jockey Plaza más caro que el Centro: hoy imposible sin duplicar artículos)
CREATE TABLE pricing.price_list_location (
  price_list_id bigint NOT NULL REFERENCES pricing.price_list(id) ON DELETE CASCADE,
  location_id   bigint NOT NULL REFERENCES core.location(id) ON DELETE CASCADE,
  PRIMARY KEY (price_list_id, location_id)
);

-- reglas de margen por categoría / material: el "PORCENTAJE" del legacy,
-- pero una vez y en su lugar, no copiado en cada artículo
CREATE TABLE pricing.price_rule (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  price_list_id bigint NOT NULL REFERENCES pricing.price_list(id) ON DELETE CASCADE,
  category_id   bigint REFERENCES catalog.category(id) ON DELETE CASCADE,
  material_id   bigint REFERENCES catalog.material(id) ON DELETE CASCADE,
  margin_pct    numeric(8,4) NOT NULL CHECK (margin_pct >= 0),
  valid_from    date NOT NULL DEFAULT current_date,
  valid_to      date,
  CONSTRAINT price_rule_scope CHECK (category_id IS NOT NULL OR material_id IS NOT NULL),
  CONSTRAINT price_rule_period CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX price_rule_lookup ON pricing.price_rule (price_list_id, category_id, material_id);

-- -----------------------------------------------------------------------------
-- precio
-- -----------------------------------------------------------------------------
CREATE TYPE pricing.price_mode AS ENUM (
  'manual',      -- lo escribe una persona (fantasía, artesanía)
  'by_weight',   -- peso x precio del gramo + piedras + mano de obra (oro, plata)
  'by_margin'    -- costo x (1 + margen de la lista/regla)
);

CREATE TABLE pricing.price (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  price_list_id  bigint NOT NULL REFERENCES pricing.price_list(id) ON DELETE CASCADE,
  variant_id     bigint NOT NULL REFERENCES catalog.variant(id) ON DELETE CASCADE,
  mode           pricing.price_mode NOT NULL DEFAULT 'manual',

  amount         numeric(16,4) NOT NULL CHECK (amount >= 0),
  -- para mode <> 'manual': amount es caché del cálculo
  recalculated_at timestamptz,
  margin_pct     numeric(8,4) CHECK (margin_pct >= 0),   -- anula el de la lista/regla
  price_per_gram numeric(16,6) CHECK (price_per_gram > 0),

  min_quantity   numeric(12,3) NOT NULL DEFAULT 1 CHECK (min_quantity > 0),
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_to       timestamptz,
  created_by     bigint REFERENCES core.app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  notes          text,

  CONSTRAINT price_period CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT price_manual_has_no_cache CHECK (
    mode <> 'manual' OR recalculated_at IS NULL)
);
-- un solo precio vigente por lista + variante + escala de cantidad
CREATE UNIQUE INDEX price_current ON pricing.price
  (price_list_id, variant_id, min_quantity) WHERE valid_to IS NULL;
CREATE INDEX price_history ON pricing.price (variant_id, valid_from DESC);
CREATE INDEX price_list_idx ON pricing.price (price_list_id, variant_id);
CREATE TRIGGER trg_price_audit AFTER INSERT OR UPDATE OR DELETE ON pricing.price
  FOR EACH ROW EXECUTE FUNCTION core.audit_row();

-- -----------------------------------------------------------------------------
-- resolución del precio efectivo: una sola puerta de entrada para la app
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pricing.resolve_price(
  p_variant_id    bigint,
  p_price_list_id bigint,
  p_quantity      numeric DEFAULT 1,
  p_date          timestamptz DEFAULT now())
RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r_price   pricing.price;
  r_list    pricing.price_list;
  v_cost    numeric;
  v_margin  numeric;
  v_amount  numeric;
  v_weight  numeric;
BEGIN
  SELECT * INTO r_list FROM pricing.price_list WHERE id = p_price_list_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lista de precio % no existe', p_price_list_id;
  END IF;

  SELECT * INTO r_price
  FROM pricing.price
  WHERE variant_id = p_variant_id
    AND price_list_id = p_price_list_id
    AND min_quantity <= p_quantity
    AND valid_from <= p_date
    AND (valid_to IS NULL OR valid_to > p_date)
  ORDER BY min_quantity DESC, valid_from DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;                                     -- sin precio: la app decide qué hacer
  END IF;

  IF r_price.mode = 'manual' THEN
    RETURN r_price.amount;
  END IF;

  IF r_price.mode = 'by_weight' THEN
    SELECT COALESCE(v.weight_g, p.nominal_weight_g) INTO v_weight
    FROM catalog.variant v JOIN catalog.product p ON p.id = v.product_id
    WHERE v.id = p_variant_id;

    v_amount :=
        COALESCE(v_weight, 0)
      * COALESCE(r_price.price_per_gram,
                 (SELECT pricing.metal_rate_at(p.material_id, r_list.currency_code, p_date::date)
                  FROM catalog.variant v JOIN catalog.product p ON p.id = v.product_id
                  WHERE v.id = p_variant_id), 0)
      + pricing.calc_stone_cost(p_variant_id, r_list.currency_code, p_date::date);

    v_margin := COALESCE(r_price.margin_pct, r_list.default_margin_pct, 0);
    v_amount := v_amount * (1 + v_margin / 100.0);

  ELSE  -- by_margin
    SELECT total_cost INTO v_cost
    FROM pricing.variant_cost
    WHERE variant_id = p_variant_id
      AND valid_from <= p_date AND (valid_to IS NULL OR valid_to > p_date)
    ORDER BY valid_from DESC LIMIT 1;

    IF v_cost IS NULL THEN
      RETURN r_price.amount;                         -- sin costo: cae al caché
    END IF;

    v_margin := COALESCE(
      r_price.margin_pct,
      (SELECT pr.margin_pct
         FROM pricing.price_rule pr
         JOIN catalog.product_category pc ON pc.category_id = pr.category_id
         JOIN catalog.variant v ON v.product_id = pc.product_id
        WHERE v.id = p_variant_id
          AND pr.price_list_id = p_price_list_id
          AND pr.valid_from <= p_date::date
          AND (pr.valid_to IS NULL OR pr.valid_to >= p_date::date)
        ORDER BY pc.is_primary DESC, pr.valid_from DESC
        LIMIT 1),
      r_list.default_margin_pct,
      0);

    v_amount := v_cost * (1 + v_margin / 100.0);
  END IF;

  -- redondeo comercial de la lista
  RETURN round(v_amount / r_list.rounding_step) * r_list.rounding_step;
END $$;

-- refresca el caché `amount` de los precios calculados (para correr tras subir el oro)
CREATE OR REPLACE FUNCTION pricing.refresh_calculated_prices(p_price_list_id bigint DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_count integer := 0;
BEGIN
  WITH upd AS (
    UPDATE pricing.price p
       SET amount = COALESCE(
             pricing.resolve_price(p.variant_id, p.price_list_id, p.min_quantity, now()),
             p.amount),
           recalculated_at = now()
     WHERE p.mode <> 'manual'
       AND p.valid_to IS NULL
       AND (p_price_list_id IS NULL OR p.price_list_id = p_price_list_id)
    RETURNING 1)
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END $$;

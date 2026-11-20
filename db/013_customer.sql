-- =============================================================================
-- ERP v2 — 013: el cliente como entidad
--
-- Hasta acá el cliente era texto libre en tres lugares que no se hablaban:
--   · ops.custody_item.customer_name / customer_phone / customer_document
--   · inventory.reservation.customer_name / customer_phone
--   · inventory.reservation.customer_id, un bigint que apuntaba a una tabla
--     que no existía ("FK futura a sales.customer")
--
-- La señora que dejó un anillo en custodia, tiene un apartado y mañana compra
-- eran tres registros sin ninguna relación, cada uno con su versión del nombre.
-- Esta migración los junta en core.customer y deja de guardar el texto.
--
-- Por qué en `core` y no en `sales`: el cliente lo necesitan hoy custodia y
-- apartados, antes de que exista ventas. Si viviera en `sales`, ops dependería
-- de un módulo que todavía no está, y el núcleo no puede depender de lo que se
-- engancha después. Además core.supplier ya está acá: el cliente es su simétrico.
-- Queda sin efecto el comentario "FK futura a sales.customer" de 005.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. tipos
-- -----------------------------------------------------------------------------
CREATE TYPE core.customer_kind AS ENUM ('person', 'company');

-- Documentos del Perú. 'none' es el cliente de vitrina que compra y se va: no
-- se le va a pedir el DNI para venderle un par de aretes, y forzarlo llevaría a
-- que alguien escriba "00000000" y arruine la deduplicación.
CREATE TYPE core.document_type AS ENUM ('dni', 'ruc', 'ce', 'passport', 'none');

-- -----------------------------------------------------------------------------
-- 2. el cliente
-- -----------------------------------------------------------------------------
CREATE SEQUENCE core.customer_code_seq;

CREATE TABLE core.customer (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- lo genera el sistema (CLI-000001) y se puede editar, igual que el SKU.
  -- El DEFAULT cubre el INSERT que no lo manda (y hace que los tipos generados
  -- lo vean como opcional); el trigger de más abajo cubre el que manda ''.
  code          text NOT NULL UNIQUE
                DEFAULT 'CLI-' || lpad(nextval('core.customer_code_seq')::text, 6, '0'),
  kind          core.customer_kind NOT NULL DEFAULT 'person',

  document_type   core.document_type NOT NULL DEFAULT 'none',
  document_number text,

  -- persona: nombre completo. empresa: razón social.
  name          text NOT NULL,
  -- nombre comercial, o el nombre con el que lo conocen en la tienda
  trade_name    text,

  phone         text,
  phone_alt     text,
  email         citext,
  address_line  text,
  city          text,

  -- en una joyería el cumpleaños se usa: es la mitad de las ventas de regalo
  birth_date    date,

  notes         text,
  is_active     boolean NOT NULL DEFAULT true,
  -- para cuando se migre la cartera del ERP viejo
  legacy_code   text,

  created_by    bigint REFERENCES core.app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- sin documento no hay número; con documento, el número es obligatorio
  CONSTRAINT customer_document_pair CHECK (
    (document_type = 'none') = (document_number IS NULL)),
  -- formato por tipo: un DNI mal cargado es un cliente duplicado mañana
  CONSTRAINT customer_document_format CHECK (
    CASE document_type
      WHEN 'dni'      THEN document_number ~ '^[0-9]{8}$'
      WHEN 'ruc'      THEN document_number ~ '^[0-9]{11}$'
      WHEN 'ce'       THEN document_number ~ '^[A-Za-z0-9]{8,12}$'
      WHEN 'passport' THEN document_number ~ '^[A-Za-z0-9]{6,20}$'
      ELSE true
    END),
  -- un RUC es de una empresa (o de alguien con negocio): no de una persona suelta
  CONSTRAINT customer_ruc_is_company CHECK (
    document_type <> 'ruc' OR kind = 'company'),
  -- una empresa no tiene cumpleaños, y nadie nació mañana
  CONSTRAINT customer_birth_date_sane CHECK (
    birth_date IS NULL OR (kind = 'person' AND birth_date <= CURRENT_DATE)),
  CONSTRAINT customer_name_not_blank CHECK (btrim(name) <> '')
);

-- EL punto de todo esto: el mismo documento no puede ser dos clientes.
-- Parcial, porque los de vitrina ('none') no tienen con qué deduplicarse.
CREATE UNIQUE INDEX customer_document_once
  ON core.customer (document_type, document_number)
  WHERE document_type <> 'none';

-- así se busca en la tienda: por nombre a medias, o por teléfono
CREATE INDEX customer_name_idx  ON core.customer USING gin (name gin_trgm_ops);
CREATE INDEX customer_trade_idx ON core.customer USING gin (trade_name gin_trgm_ops)
  WHERE trade_name IS NOT NULL;
CREATE INDEX customer_phone_idx ON core.customer USING gin (phone gin_trgm_ops)
  WHERE phone IS NOT NULL;
CREATE INDEX customer_doc_idx   ON core.customer (document_number)
  WHERE document_number IS NOT NULL;
CREATE INDEX customer_legacy_idx ON core.customer (legacy_code)
  WHERE legacy_code IS NOT NULL;
-- para el saludo de cumpleaños: busca por día y mes, sin el año
CREATE INDEX customer_birthday_idx
  ON core.customer (EXTRACT(MONTH FROM birth_date), EXTRACT(DAY FROM birth_date))
  WHERE birth_date IS NOT NULL AND is_active;

COMMENT ON TABLE core.customer IS
  'Cliente, uno solo para todo el ERP: custodia, apartados y (cuando llegue) ventas.';
COMMENT ON COLUMN core.customer.document_type IS
  '"none" es el cliente de vitrina sin documento: no se deduplica, a propósito.';

CREATE TRIGGER trg_customer_touch BEFORE UPDATE ON core.customer
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER trg_customer_audit AFTER INSERT OR UPDATE OR DELETE ON core.customer
  FOR EACH ROW EXECUTE FUNCTION core.audit_row();

-- red de seguridad del DEFAULT: si llega '' o NULL explícito, igual se genera
CREATE OR REPLACE FUNCTION core.customer_code() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS NULL OR btrim(NEW.code) = '' THEN
    NEW.code := 'CLI-' || lpad(nextval('core.customer_code_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END $$;

-- Un trigger BEFORE corre antes de que se evalúen las restricciones, así que
-- `code` puede seguir siendo NOT NULL y el INSERT puede omitirlo igual.
CREATE TRIGGER trg_customer_code BEFORE INSERT ON core.customer
  FOR EACH ROW EXECUTE FUNCTION core.customer_code();

-- -----------------------------------------------------------------------------
-- 3. el cliente de vitrina
-- -----------------------------------------------------------------------------
-- Para que "no sé quién es" no obligue a inventar un cliente ni a dejar la
-- referencia en NULL. Tiene documento 'none', así que no choca con nadie.
INSERT INTO core.customer (code, kind, name, notes, created_by)
VALUES ('CLI-000000', 'person', 'Cliente de vitrina',
        'Para operaciones sin cliente identificado. No borrar ni reutilizar para otra persona.',
        NULL);

-- -----------------------------------------------------------------------------
-- 4. enganchar los apartados (inventory.reservation)
-- -----------------------------------------------------------------------------
-- Pasar el texto que hubiera a clientes de verdad, antes de exigir la FK.
INSERT INTO core.customer (kind, name, phone, notes, created_by)
SELECT 'person',
       btrim(r.customer_name),
       min(r.customer_phone),
       'Creado al normalizar los apartados (migración 013)',
       min(r.created_by)
  FROM inventory.reservation r
 WHERE r.customer_id IS NULL
   AND r.customer_name IS NOT NULL
   AND btrim(r.customer_name) <> ''
 GROUP BY btrim(r.customer_name);

UPDATE inventory.reservation r
   SET customer_id = c.id
  FROM core.customer c
 WHERE r.customer_id IS NULL
   AND r.customer_name IS NOT NULL
   AND btrim(r.customer_name) = c.name;

-- lo que quedó sin nombre va al cliente de vitrina
UPDATE inventory.reservation
   SET customer_id = (SELECT id FROM core.customer WHERE code = 'CLI-000000')
 WHERE customer_id IS NULL;

-- Las columnas de texto se borran recién en el punto 6: antes hay que sacar de
-- encima las vistas de 010 que las usan.
ALTER TABLE inventory.reservation
  ALTER COLUMN customer_id SET NOT NULL,
  ADD CONSTRAINT reservation_customer_fk
    FOREIGN KEY (customer_id) REFERENCES core.customer(id) ON DELETE RESTRICT;

CREATE INDEX reservation_customer_idx ON inventory.reservation (customer_id, reserved_at DESC);

COMMENT ON COLUMN inventory.reservation.customer_id IS
  'El cliente del apartado. Antes era texto libre; ahora es core.customer.';

-- -----------------------------------------------------------------------------
-- 5. enganchar la custodia (ops.custody_item)
-- -----------------------------------------------------------------------------
ALTER TABLE ops.custody_item ADD COLUMN customer_id bigint;

-- Mismo criterio, pero acá sí hay documento: si dos filas traen el mismo
-- documento son la misma persona, y es justo lo que antes no se podía saber.
INSERT INTO core.customer (kind, document_type, document_number, name, phone, notes, created_by)
SELECT 'person',
       CASE WHEN d.doc ~ '^[0-9]{8}$' THEN 'dni'::core.document_type
            ELSE 'none'::core.document_type END,
       CASE WHEN d.doc ~ '^[0-9]{8}$' THEN d.doc ELSE NULL END,
       d.name,
       d.phone,
       'Creado al normalizar la custodia (migración 013)',
       d.received_by
  FROM (SELECT btrim(ci.customer_name) AS name,
               nullif(btrim(COALESCE(ci.customer_document, '')), '') AS doc,
               min(ci.customer_phone) AS phone,
               min(ci.received_by)    AS received_by
          FROM ops.custody_item ci
         WHERE btrim(ci.customer_name) <> ''
         GROUP BY 1, 2) d
 WHERE NOT EXISTS (
   SELECT 1 FROM core.customer c
    WHERE c.document_type = 'dni' AND c.document_number = d.doc);

UPDATE ops.custody_item ci
   SET customer_id = c.id
  FROM core.customer c
 WHERE ci.customer_id IS NULL
   AND (
     (ci.customer_document ~ '^[0-9]{8}$'
      AND c.document_type = 'dni'
      AND c.document_number = btrim(ci.customer_document))
     OR (nullif(btrim(COALESCE(ci.customer_document, '')), '') IS NULL
         AND c.document_type = 'none'
         AND c.name = btrim(ci.customer_name)));

UPDATE ops.custody_item
   SET customer_id = (SELECT id FROM core.customer WHERE code = 'CLI-000000')
 WHERE customer_id IS NULL;

ALTER TABLE ops.custody_item
  ALTER COLUMN customer_id SET NOT NULL,
  ADD CONSTRAINT custody_customer_fk
    FOREIGN KEY (customer_id) REFERENCES core.customer(id) ON DELETE RESTRICT;

CREATE INDEX custody_customer_by_date_idx ON ops.custody_item (customer_id, received_at DESC);

-- `delivered_to` se queda y NO es el cliente: es quién retiró físicamente la
-- pieza, que puede ser el marido, la hija o un cadete. Son dos datos distintos.
COMMENT ON COLUMN ops.custody_item.delivered_to IS
  'Quién retiró la pieza en el mostrador. Puede no ser el cliente (customer_id).';

-- -----------------------------------------------------------------------------
-- 6. las vistas de 010 que leían el nombre del cliente
-- -----------------------------------------------------------------------------
-- Van con CREATE OR REPLACE y la misma lista de columnas: lo único que cambia es
-- de dónde sale el nombre. Hay que repetir la definición completa porque Postgres
-- no permite reemplazar un trozo, y 010 no se edita (las migraciones se agregan).

CREATE OR REPLACE VIEW ops.v_pieces_out AS
-- 1. piezas de clientes
SELECT 'custodia'::text              AS kind,
       c.code                        AS reference,
       c.description || ' — ' || cu.name AS detail,
       l.name                        AS location,
       u.full_name                   AS responsible,
       c.received_at                 AS since,
       (current_date - c.received_at::date) AS days_out,
       c.promised_on                 AS due_on,
       (c.promised_on IS NOT NULL AND c.promised_on < current_date) AS is_overdue
  FROM ops.custody_item c
  JOIN core.customer cu ON cu.id = c.customer_id
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

-- ya no hace falta el COALESCE '(sin nombre)': el apartado tiene cliente siempre
CREATE OR REPLACE VIEW ops.v_overdue AS
SELECT * FROM ops.v_pieces_out WHERE is_overdue
UNION ALL
SELECT 'apartado',
       'RES-' || r.id::text,
       cu.name || ' — ' || v.sku,
       l.name,
       u.full_name,
       r.reserved_at,
       (current_date - r.reserved_at::date),
       r.expires_at::date,
       true
  FROM inventory.reservation r
  JOIN core.customer cu ON cu.id = r.customer_id
  JOIN catalog.variant v ON v.id = r.variant_id
  JOIN core.location l ON l.id = r.location_id
  LEFT JOIN core.app_user u ON u.id = r.created_by
 WHERE r.status = 'active' AND r.expires_at IS NOT NULL AND r.expires_at < now();

CREATE OR REPLACE VIEW ops.v_custody_ledger AS
SELECT c.code,
       cu.name               AS customer_name,
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
  JOIN core.customer cu ON cu.id = c.customer_id
  LEFT JOIN core.location lf ON lf.id = e.from_location_id
  LEFT JOIN core.location lt ON lt.id = e.to_location_id
  LEFT JOIN core.app_user u ON u.id = e.created_by
  LEFT JOIN ops.work_order w ON w.id = e.work_order_id
 ORDER BY c.code, e.occurred_at, e.id;

CREATE OR REPLACE VIEW ops.v_layaway_balance AS
SELECT r.id            AS reservation_id,
       cu.name         AS customer_name,
       cu.phone        AS customer_phone,
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
  JOIN core.customer cu ON cu.id = r.customer_id
  JOIN catalog.variant v ON v.id = r.variant_id
  JOIN catalog.product p ON p.id = v.product_id
  JOIN core.location l ON l.id = r.location_id
  LEFT JOIN (SELECT reservation_id, sum(amount) AS total, count(*) AS payments,
                    max(paid_at) AS last_payment_at
               FROM ops.layaway_payment GROUP BY 1) pay ON pay.reservation_id = r.id
 WHERE r.kind = 'layaway';

-- -----------------------------------------------------------------------------
-- 7. ahora sí: fuera el texto libre
-- -----------------------------------------------------------------------------
ALTER TABLE inventory.reservation
  DROP COLUMN customer_name,
  DROP COLUMN customer_phone;

-- el índice de búsqueda por nombre se movió a core.customer
DROP INDEX ops.custody_customer_idx;

ALTER TABLE ops.custody_item
  DROP COLUMN customer_name,
  DROP COLUMN customer_phone,
  DROP COLUMN customer_document;

-- -----------------------------------------------------------------------------
-- 8. la vista que justifica todo esto
-- -----------------------------------------------------------------------------
CREATE VIEW core.v_customer_360 AS
WITH custody AS (
  SELECT customer_id,
         count(*)                                                   AS custody_total,
         count(*) FILTER (WHERE status <> 'delivered')               AS custody_open,
         max(received_at)                                            AS last_custody
    FROM ops.custody_item
   GROUP BY customer_id
),
layaway AS (
  SELECT r.customer_id,
         count(*)                                      AS layaway_total,
         count(*) FILTER (WHERE r.status = 'active')    AS layaway_active,
         COALESCE(sum(p.paid) FILTER (WHERE r.status = 'active'), 0) AS layaway_paid,
         max(r.reserved_at)                            AS last_layaway
    FROM inventory.reservation r
    LEFT JOIN (SELECT reservation_id, sum(amount) AS paid
                 FROM ops.layaway_payment GROUP BY 1) p
           ON p.reservation_id = r.id
   GROUP BY r.customer_id
)
SELECT c.id                                  AS customer_id,
       c.code,
       c.name,
       c.trade_name,
       c.kind,
       c.document_type,
       c.document_number,
       c.phone,
       c.email,
       c.city,
       c.birth_date,
       c.is_active,
       COALESCE(cu.custody_total, 0)         AS custody_total,
       COALESCE(cu.custody_open, 0)          AS custody_open,
       COALESCE(la.layaway_total, 0)         AS layaway_total,
       COALESCE(la.layaway_active, 0)        AS layaway_active,
       COALESCE(la.layaway_paid, 0)          AS layaway_paid,
       -- lo que nos vincula hoy con esta persona: si es > 0 no se puede archivar
       COALESCE(cu.custody_open, 0) + COALESCE(la.layaway_active, 0) AS open_items,
       greatest(cu.last_custody, la.last_layaway) AS last_activity
  FROM core.customer c
  LEFT JOIN custody cu ON cu.customer_id = c.id
  LEFT JOIN layaway la ON la.customer_id = c.id;

COMMENT ON VIEW core.v_customer_360 IS
  'Una fila por cliente con todo lo que tiene con nosotros. open_items > 0 = no se archiva.';

-- un cliente con cosas abiertas no se desactiva: la pieza sigue en la vitrina.
-- Consulta las dos tablas directo y no la vista: con el índice por customer_id
-- son dos búsquedas puntuales en lugar de agrupar todo.
CREATE OR REPLACE FUNCTION core.customer_can_deactivate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_custody integer; v_layaway integer;
BEGIN
  IF OLD.is_active AND NOT NEW.is_active THEN
    SELECT count(*) INTO v_custody FROM ops.custody_item
     WHERE customer_id = NEW.id AND status <> 'delivered';
    SELECT count(*) INTO v_layaway FROM inventory.reservation
     WHERE customer_id = NEW.id AND status = 'active';
    IF v_custody + v_layaway > 0 THEN
      RAISE EXCEPTION
        'el cliente % tiene % pieza(s) en custodia y % apartado(s) activo(s): no se puede desactivar',
        NEW.code, v_custody, v_layaway;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_customer_deactivate BEFORE UPDATE ON core.customer
  FOR EACH ROW EXECUTE FUNCTION core.customer_can_deactivate();

-- -----------------------------------------------------------------------------
-- 9. permisos
-- -----------------------------------------------------------------------------
INSERT INTO core.permission (code, module, name, description, sort_order) VALUES
  ('customers.read',  'Clientes', 'Ver clientes',    'Buscar un cliente y ver su historia', 15),
  ('customers.write', 'Clientes', 'Editar clientes', 'Crear y corregir datos del cliente',  16);

-- quien atiende en el mostrador tiene que poder crear un cliente en el momento
INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id
  FROM (VALUES
    ('vendedor', ARRAY['customers.read','customers.write']),
    ('gerente',  ARRAY['customers.read','customers.write']),
    ('almacen',  ARRAY['customers.read']),
    ('taller',   ARRAY['customers.read']),
    ('contador', ARRAY['customers.read'])
  ) AS v(role_code, codes)
  JOIN core.role r       ON r.code = v.role_code
  JOIN core.permission p ON p.code = ANY (v.codes);

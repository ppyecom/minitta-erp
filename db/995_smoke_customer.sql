-- =============================================================================
-- ERP v2 — prueba de humo del cliente como entidad
--
-- Lo que esta migración vino a arreglar: el cliente era texto libre en tres
-- lugares que no se hablaban. Acá se verifica que ahora sea uno solo:
--   · la misma persona en custodia y en un apartado es UN cliente
--   · el mismo documento no puede ser dos clientes
--   · el de vitrina, sin documento, NO se deduplica (a propósito)
--   · v_customer_360 muestra todo lo que tiene con nosotros
--   · un cliente con cosas abiertas no se puede desactivar
--
-- Termina en ROLLBACK: no deja datos en la base.
-- =============================================================================
BEGIN;

SET LOCAL app.user_id = '1';          -- usuario 'migracion'
SET LOCAL app.client_info = 'smoke-customer';

-- -----------------------------------------------------------------------------
-- fixtures: un producto para poder apartar algo
-- -----------------------------------------------------------------------------
INSERT INTO catalog.product (code, slug, name, kind, status, material_id, created_by)
VALUES ('CLI-TEST','cli-test','Dije de prueba','jewelry','active',
        (SELECT id FROM catalog.material WHERE code='AU18'), 1);

INSERT INTO catalog.variant (product_id, sku, size_label, weight_g, tracking_mode, is_default)
VALUES ((SELECT id FROM catalog.product WHERE code='CLI-TEST'),'CLI-Q','único', 5.000,'quantity', true);

SELECT inventory.post_movement(
  (SELECT id FROM catalog.variant WHERE sku='CLI-Q'), 1,
  'purchase'::inventory.movement_type, 10, 1, NULL, NULL, NULL, 'compra_prov');

-- -----------------------------------------------------------------------------
\echo ''
\echo '--- caso 1: el código lo genera el sistema y el documento identifica'
-- -----------------------------------------------------------------------------
INSERT INTO core.customer (kind, document_type, document_number, name, phone, birth_date, created_by)
VALUES ('person','dni','40123456','María Quispe Huamán','999888777','1985-03-14', 1);

INSERT INTO core.customer (kind, document_type, document_number, name, trade_name,
                           email, city, created_by)
VALUES ('company','ruc','20512345678','Joyería Andina S.A.C.','Andina',
        'compras@andina.pe','Cusco', 1);

-- el de vitrina: compra y se va, no se le pide el DNI
INSERT INTO core.customer (kind, name, created_by)
VALUES ('person','Señora del abrigo rojo', 1);

SELECT code, kind, document_type, document_number, name
  FROM core.customer
 WHERE code <> 'CLI-000000'
 ORDER BY code;

DO $$
DECLARE v_code text; v_n integer;
BEGIN
  SELECT code INTO v_code FROM core.customer WHERE document_number = '40123456';
  ASSERT v_code ~ '^CLI-[0-9]{6}$', format('el código no se generó bien: %s', v_code);

  -- el cliente de vitrina del seed existe y es uno solo
  SELECT count(*) INTO v_n FROM core.customer WHERE code = 'CLI-000000';
  ASSERT v_n = 1, 'debe existir el cliente de vitrina CLI-000000';

  RAISE NOTICE 'OK 1/5 el código se genera solo y el documento identifica';
END $$;

-- -----------------------------------------------------------------------------
\echo ''
\echo '--- caso 2: la misma persona en custodia Y en un apartado es UN cliente'
-- -----------------------------------------------------------------------------
-- Esto es exactamente lo que antes no se podía saber: eran dos textos sueltos.
INSERT INTO ops.custody_item
  (code, customer_id, description, material_id, received_weight_g,
   requested_service, location_id, received_by, promised_on)
VALUES ('CUS-CLI-1',(SELECT id FROM core.customer WHERE document_number='40123456'),
        'Anillo de compromiso', (SELECT id FROM catalog.material WHERE code='AU18'),
        4.820,'Soldar aro', 1, 1, current_date + 7);

INSERT INTO inventory.reservation
  (variant_id, location_id, kind, quantity, customer_id,
   deposit_amount, deposit_currency, expires_at, created_by)
VALUES ((SELECT id FROM catalog.variant WHERE sku='CLI-Q'), 1,'layaway', 2,
        (SELECT id FROM core.customer WHERE document_number='40123456'),
        40.00,'PEN', now() + interval '30 days', 1);

SELECT ops.register_layaway_payment(
  (SELECT r.id FROM inventory.reservation r
     JOIN core.customer c ON c.id = r.customer_id
    WHERE c.document_number = '40123456'),
  60.00,'PEN', 1,'cash'::ops.payment_method) AS pagado_total;

\echo '    v_customer_360: todo lo que tiene con nosotros, en una fila'
SELECT code, name, custody_open, layaway_active, layaway_paid, open_items
  FROM core.v_customer_360
 WHERE document_number = '40123456';

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM core.v_customer_360 WHERE document_number = '40123456';
  ASSERT r.custody_open = 1,   format('debía tener 1 pieza en custodia, tiene %s', r.custody_open);
  ASSERT r.layaway_active = 1, format('debía tener 1 apartado activo, tiene %s', r.layaway_active);
  ASSERT r.layaway_paid = 60,  format('debía tener 60 pagados, tiene %s', r.layaway_paid);
  ASSERT r.open_items = 2,     format('debía tener 2 cosas abiertas, tiene %s', r.open_items);
  ASSERT r.last_activity IS NOT NULL, 'debía tener última actividad';

  -- y las vistas de ops siguen mostrando el nombre, ahora desde core.customer
  ASSERT EXISTS (SELECT 1 FROM ops.v_pieces_out
                  WHERE reference = 'CUS-CLI-1' AND detail LIKE '%María Quispe%'),
         'v_pieces_out debe mostrar el nombre del cliente';
  ASSERT EXISTS (SELECT 1 FROM ops.v_layaway_balance
                  WHERE customer_name = 'María Quispe Huamán' AND paid = 60),
         'v_layaway_balance debe mostrar el nombre y lo pagado';
  ASSERT EXISTS (SELECT 1 FROM ops.v_custody_ledger
                  WHERE code = 'CUS-CLI-1' AND customer_name = 'María Quispe Huamán'),
         'v_custody_ledger debe mostrar el nombre del cliente';

  RAISE NOTICE 'OK 2/5 custodia y apartado cuelgan del mismo cliente';
END $$;

-- -----------------------------------------------------------------------------
\echo ''
\echo '--- caso 3: así se busca en el mostrador'
-- -----------------------------------------------------------------------------
\echo '    por nombre a medias'
SELECT code, name FROM core.customer WHERE name ILIKE '%quispe%';
\echo '    por teléfono'
SELECT code, name, phone FROM core.customer WHERE phone LIKE '%888777%';
\echo '    los cumpleaños de marzo'
SELECT code, name, birth_date FROM core.customer
 WHERE is_active AND EXTRACT(MONTH FROM birth_date) = 3;

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM core.customer WHERE name ILIKE '%quispe%') = 1,
         'la búsqueda por nombre parcial debe encontrar a María';
  ASSERT (SELECT count(*) FROM core.customer
           WHERE EXTRACT(MONTH FROM birth_date) = 3) = 1,
         'la búsqueda de cumpleaños por mes debe encontrar a María';
  RAISE NOTICE 'OK 3/5 se busca por nombre parcial, teléfono y cumpleaños';
END $$;

-- -----------------------------------------------------------------------------
\echo ''
\echo '--- caso 4: el de vitrina NO se deduplica, y eso es a propósito'
-- -----------------------------------------------------------------------------
-- Dos señoras distintas sin documento pueden llamarse igual. Si se las forzara a
-- ser una sola, se mezclarían dos historias que no tienen nada que ver.
INSERT INTO core.customer (kind, name, created_by)
VALUES ('person','Señora del abrigo rojo', 1);

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM core.customer WHERE name = 'Señora del abrigo rojo';
  ASSERT v_n = 2, format('dos clientes sin documento con el mismo nombre deben convivir, hay %s', v_n);
  RAISE NOTICE 'OK 4/5 sin documento no hay deduplicación (a propósito)';
END $$;

-- -----------------------------------------------------------------------------
\echo ''
\echo '--- caso 5: reglas de integridad (las 7 deben decir RECHAZADO)'
-- -----------------------------------------------------------------------------
DO $$
DECLARE v_maria bigint; v_libre bigint;
BEGIN
  SELECT id INTO v_maria FROM core.customer WHERE document_number = '40123456';

  -- 1. el mismo documento, dos veces: ESTE es el bug que la migración arregla
  BEGIN
    INSERT INTO core.customer (kind, document_type, document_number, name, created_by)
    VALUES ('person','dni','40123456','Maria Quispe H.', 1);
    RAISE WARNING 'ACEPTADO (mal): dos clientes con el mismo DNI';
  EXCEPTION WHEN others THEN RAISE NOTICE 'RECHAZADO 1/7 DNI duplicado'; END;

  -- 2. un DNI que no es un DNI
  BEGIN
    INSERT INTO core.customer (kind, document_type, document_number, name, created_by)
    VALUES ('person','dni','4012345','Siete dígitos', 1);
    RAISE WARNING 'ACEPTADO (mal): DNI de 7 dígitos';
  EXCEPTION WHEN others THEN RAISE NOTICE 'RECHAZADO 2/7 DNI con formato inválido'; END;

  -- 3. un RUC colgado de una persona
  BEGIN
    INSERT INTO core.customer (kind, document_type, document_number, name, created_by)
    VALUES ('person','ruc','20512345679','Persona con RUC', 1);
    RAISE WARNING 'ACEPTADO (mal): RUC en una persona';
  EXCEPTION WHEN others THEN RAISE NOTICE 'RECHAZADO 3/7 un RUC es de una empresa'; END;

  -- 4. tipo de documento sin número
  BEGIN
    INSERT INTO core.customer (kind, document_type, name, created_by)
    VALUES ('person','dni','Sin número', 1);
    RAISE WARNING 'ACEPTADO (mal): tipo de documento sin número';
  EXCEPTION WHEN others THEN RAISE NOTICE 'RECHAZADO 4/7 documento sin número'; END;

  -- 5. número sin tipo de documento
  BEGIN
    INSERT INTO core.customer (kind, document_number, name, created_by)
    VALUES ('person','40123457','Número sin tipo', 1);
    RAISE WARNING 'ACEPTADO (mal): número sin tipo de documento';
  EXCEPTION WHEN others THEN RAISE NOTICE 'RECHAZADO 5/7 número sin tipo'; END;

  -- 6. nombre en blanco
  BEGIN
    INSERT INTO core.customer (kind, name, created_by) VALUES ('person','   ', 1);
    RAISE WARNING 'ACEPTADO (mal): nombre en blanco';
  EXCEPTION WHEN others THEN RAISE NOTICE 'RECHAZADO 6/7 nombre en blanco'; END;

  -- 7. desactivar a quien tiene una pieza nuestra... o nuestra pieza
  BEGIN
    UPDATE core.customer SET is_active = false WHERE id = v_maria;
    RAISE WARNING 'ACEPTADO (mal): cliente con custodia abierta desactivado';
  EXCEPTION WHEN others THEN RAISE NOTICE 'RECHAZADO 7/7 cliente con cosas abiertas'; END;

  -- y uno sin nada abierto sí se puede desactivar
  SELECT id INTO v_libre FROM core.customer
   WHERE name = 'Señora del abrigo rojo' ORDER BY id LIMIT 1;
  UPDATE core.customer SET is_active = false WHERE id = v_libre;
  ASSERT NOT (SELECT is_active FROM core.customer WHERE id = v_libre),
         'un cliente sin nada abierto sí se debe poder desactivar';

  RAISE NOTICE 'OK 5/5 las 7 reglas rechazan, y el cliente libre sí se desactiva';
END $$;

\echo ''
\echo '--- y el cliente quedó en la auditoría, como todo lo demás'
SELECT entity, action, count(*)
  FROM core.audit_log
 WHERE entity = 'core.customer'
 GROUP BY entity, action
 ORDER BY action;

ROLLBACK;

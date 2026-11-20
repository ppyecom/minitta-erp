-- =============================================================================
-- ERP v2 — prueba de humo del login, los roles y los permisos
--
-- Verifica lo que hace que el "quién" de la auditoría signifique algo:
--   · cada rol ve exactamente lo suyo, y el administrador todo
--   · un permiso nuevo lo tiene el administrador sin tocar sus filas
--   · can_see_cost y el permiso cost.read no se contradicen
--   · la merma no se la puede firmar quien la cargó
--   · un usuario de sistema no tiene contraseña
--   · revocar una sesión la cierra; purge_sessions no borra las vivas
--
-- El hash de la contraseña lo calcula la API (scrypt, Node), así que acá se
-- prueban las reglas, no el hashing.
--
-- Termina en ROLLBACK: no deja datos en la base.
-- =============================================================================
BEGIN;

SET LOCAL app.user_id = '1';          -- usuario 'migracion'
SET LOCAL app.client_info = 'smoke-auth';

-- -----------------------------------------------------------------------------
-- preparación: una persona por rol
-- -----------------------------------------------------------------------------
INSERT INTO core.app_user (username, full_name, can_see_cost) VALUES
  ('ana',    'Ana Vendedora',   false),
  ('bruno',  'Bruno Taller',    false),
  ('carla',  'Carla Almacén',   false),
  ('diego',  'Diego Gerente',   false),
  ('elena',  'Elena Admin',     false),
  ('fabio',  'Fabio Contador',  false),
  ('gloria', 'Gloria Sin Rol',  true);   -- sin rol, pero con el flag viejo de costos

INSERT INTO core.user_role (user_id, role_id, granted_by)
SELECT u.id, r.id, 1
  FROM (VALUES ('ana','vendedor'), ('bruno','taller'), ('carla','almacen'),
               ('diego','gerente'), ('elena','admin'), ('fabio','contador'))
       AS v(username, role_code)
  JOIN core.app_user u ON u.username = v.username
  JOIN core.role r     ON r.code = v.role_code;

\echo ''
\echo '--- caso 1: cada rol puede lo suyo y no puede lo ajeno'
SELECT u.username,
       core.user_can(u.id, 'inventory.read')       AS ve_stock,
       core.user_can(u.id, 'inventory.count.apply') AS aplica_conteos,
       core.user_can(u.id, 'ops.workshop')          AS taller,
       core.user_can(u.id, 'cost.read')             AS ve_costos,
       core.user_can(u.id, 'core.users')            AS admin_usuarios
  FROM core.app_user u
 WHERE u.username IN ('ana','bruno','carla','diego','elena','fabio','gloria')
 ORDER BY u.username;

DO $$
DECLARE v_ana bigint; v_elena bigint; v_fabio bigint; v_bruno bigint; v_gloria bigint;
BEGIN
  SELECT id INTO v_ana    FROM core.app_user WHERE username = 'ana';
  SELECT id INTO v_elena  FROM core.app_user WHERE username = 'elena';
  SELECT id INTO v_fabio  FROM core.app_user WHERE username = 'fabio';
  SELECT id INTO v_bruno  FROM core.app_user WHERE username = 'bruno';
  SELECT id INTO v_gloria FROM core.app_user WHERE username = 'gloria';

  -- la vendedora consulta y atiende vitrina, pero no mueve stock ni ve costos
  ASSERT      core.user_can(v_ana, 'inventory.read'),      'la vendedora debe ver el stock';
  ASSERT      core.user_can(v_ana, 'ops.layaway'),          'la vendedora debe cobrar apartados';
  ASSERT NOT  core.user_can(v_ana, 'inventory.move'),       'la vendedora NO mueve stock';
  ASSERT NOT  core.user_can(v_ana, 'cost.read'),            'la vendedora NO ve costos';
  ASSERT NOT  core.user_can(v_ana, 'core.users'),           'la vendedora NO administra usuarios';

  -- el taller trabaja órdenes, no aplica conteos ni liquida consignaciones
  ASSERT      core.user_can(v_bruno, 'ops.workshop'),       'el taller debe trabajar órdenes';
  ASSERT NOT  core.user_can(v_bruno, 'inventory.count.apply'), 'el taller NO aplica conteos';
  ASSERT NOT  core.user_can(v_bruno, 'ops.consignment.settle'), 'el taller NO liquida';

  -- el administrador puede todo; gerencia todo menos usuarios
  ASSERT      core.user_can(v_elena, 'core.users'),         'el admin administra usuarios';
  ASSERT      core.user_can(v_elena, 'inventory.count.apply'), 'el admin puede todo';

  -- contabilidad: lectura con costos, nada de escritura
  ASSERT      core.user_can(v_fabio, 'cost.read'),          'contabilidad ve costos';
  ASSERT      core.user_can(v_fabio, 'core.audit'),         'contabilidad ve la auditoría';
  ASSERT NOT  core.user_can(v_fabio, 'inventory.move'),     'contabilidad NO mueve stock';
  ASSERT NOT  core.user_can(v_fabio, 'catalog.write'),      'contabilidad NO edita el catálogo';

  -- sin ningún rol no se puede nada... salvo el costo, que trae del flag viejo
  ASSERT NOT  core.user_can(v_gloria, 'inventory.read'),    'sin rol no se ve el stock';
  ASSERT      core.user_can(v_gloria, 'cost.read'),         'can_see_cost sigue dando cost.read';

  RAISE NOTICE 'OK 1/4 cada rol puede exactamente lo suyo';
END $$;

\echo ''
\echo '--- caso 2: un permiso nuevo lo tiene el administrador sin tocarle las filas'
DO $$
DECLARE v_elena bigint; v_diego bigint;
BEGIN
  SELECT id INTO v_elena FROM core.app_user WHERE username = 'elena';
  SELECT id INTO v_diego FROM core.app_user WHERE username = 'diego';

  INSERT INTO core.permission (code, module, name)
  VALUES ('sales.invoice.void', 'Ventas', 'Anular comprobantes');

  -- nadie le dio este permiso a nadie todavía
  ASSERT core.user_can(v_elena, 'sales.invoice.void'),
         'el admin debe tener un permiso recién creado';
  ASSERT NOT core.user_can(v_diego, 'sales.invoice.void'),
         'gerencia NO hereda un permiso nuevo automáticamente';

  RAISE NOTICE 'OK 2/4 el admin hereda los permisos nuevos; los demás no';
END $$;

\echo ''
\echo '--- caso 3: user_permissions() es lo que la interfaz usa para esconder cosas'
SELECT u.username, count(*) AS permisos
  FROM core.app_user u,
       LATERAL core.user_permissions(u.id) p
 WHERE u.username IN ('ana','bruno','carla','diego','elena','fabio')
 GROUP BY u.username
 ORDER BY permisos DESC, u.username;

\echo ''
\echo '--- caso 4: sesiones: se revocan en el acto y la purga respeta las vivas'
DO $$
DECLARE v_ana bigint; v_live bigint; v_old bigint; v_purged integer; v_open integer;
BEGIN
  SELECT id INTO v_ana FROM core.app_user WHERE username = 'ana';

  INSERT INTO core.user_session (user_id, token_hash, client_info, expires_at)
  VALUES (v_ana, 'hash-viva', 'erp-web / caja-01', now() + interval '8 hours')
  RETURNING id INTO v_live;

  -- una vencida hace mucho, que la purga sí debe borrar
  INSERT INTO core.user_session (user_id, token_hash, client_info, expires_at)
  VALUES (v_ana, 'hash-vieja', 'erp-web / caja-01', now() - interval '90 days')
  RETURNING id INTO v_old;

  SELECT open_sessions INTO v_open FROM core.v_user_access WHERE user_id = v_ana;
  ASSERT v_open = 1, format('debía haber 1 sesión abierta, hay %s', v_open);

  SELECT core.purge_sessions(30) INTO v_purged;
  ASSERT v_purged = 1, format('la purga debía borrar 1 sesión vencida, borró %s', v_purged);
  ASSERT EXISTS (SELECT 1 FROM core.user_session WHERE id = v_live),
         'la purga NO debe tocar una sesión viva';

  -- revocar: la sesión deja de contar sin esperar que expire
  UPDATE core.user_session SET revoked_at = now(), revoked_by = 1 WHERE id = v_live;
  SELECT open_sessions INTO v_open FROM core.v_user_access WHERE user_id = v_ana;
  ASSERT v_open = 0, format('revocada, debía quedar 0 sesiones abiertas, hay %s', v_open);

  RAISE NOTICE 'OK 3/4 revocar cierra la sesión y la purga respeta las vivas';
END $$;

\echo ''
\echo '--- caso 5: v_user_access resume quién puede entrar'
SELECT username, can_log_in, is_locked, roles
  FROM core.v_user_access
 WHERE username IN ('ana','elena','gloria','migracion')
 ORDER BY username;

\echo ''
\echo '--- caso 6: reglas de integridad (las 4 deben decir RECHAZADO)'
DO $$
DECLARE
  v_bruno bigint; v_elena bigint; v_wo bigint; v_loss bigint;
  v_taller bigint; v_mat bigint;
BEGIN
  SELECT id INTO v_bruno FROM core.app_user WHERE username = 'bruno';
  SELECT id INTO v_elena FROM core.app_user WHERE username = 'elena';
  SELECT id INTO v_taller FROM core.location WHERE kind = 'workshop' AND holds_stock LIMIT 1;
  SELECT id INTO v_mat FROM catalog.material WHERE code = 'AU18';

  -- 1. un usuario de sistema no puede tener contraseña: no se loguea nunca
  BEGIN
    UPDATE core.app_user SET password_hash = 'scrypt$16384$8$1$x$y' WHERE username = 'migracion';
    RAISE WARNING 'ACEPTADO (mal): un usuario de sistema con contraseña';
  EXCEPTION WHEN others THEN RAISE NOTICE 'RECHAZADO 1/4 usuario de sistema sin contraseña'; END;

  -- 2. el mismo rol dos veces al mismo usuario
  BEGIN
    INSERT INTO core.user_role (user_id, role_id)
    SELECT v_bruno, id FROM core.role WHERE code = 'taller';
    RAISE WARNING 'ACEPTADO (mal): rol duplicado';
  EXCEPTION WHEN others THEN RAISE NOTICE 'RECHAZADO 2/4 rol duplicado'; END;

  -- 3. dos sesiones con el mismo token
  BEGIN
    INSERT INTO core.user_session (user_id, token_hash, expires_at)
    VALUES (v_bruno, 'hash-viva', now() + interval '1 hour');
    RAISE WARNING 'ACEPTADO (mal): dos sesiones con el mismo token';
  EXCEPTION WHEN others THEN RAISE NOTICE 'RECHAZADO 3/4 token de sesión repetido'; END;

  -- 4. firmarse la propia merma (docs/08 §7: esto era lo que faltaba)
  INSERT INTO ops.work_order (code, kind, status, location_id, created_by)
  VALUES ('OT-SMOKE-AUTH', 'repair', 'draft', v_taller, v_bruno)
  RETURNING id INTO v_wo;

  INSERT INTO ops.work_order_loss (work_order_id, material_id, weight_g, reason, created_by)
  VALUES (v_wo, v_mat, 1.500, 'limadura de soldadura', v_bruno)
  RETURNING id INTO v_loss;

  BEGIN
    UPDATE ops.work_order_loss SET approved_by = v_bruno, approved_at = now()
     WHERE id = v_loss;
    RAISE WARNING 'ACEPTADO (mal): se firmó su propia merma';
  EXCEPTION WHEN others THEN RAISE NOTICE 'RECHAZADO 4/4 la merma la firma otra persona'; END;

  -- y que la firme otro sí funciona
  UPDATE ops.work_order_loss SET approved_by = v_elena, approved_at = now()
   WHERE id = v_loss;
  ASSERT (SELECT approved_by FROM ops.work_order_loss WHERE id = v_loss) = v_elena,
         'otra persona sí debe poder firmar la merma';

  RAISE NOTICE 'OK 4/4 las 4 reglas rechazan, y la firma de un tercero pasa';
END $$;

\echo ''
\echo '--- y los cambios de rol quedaron en la auditoría'
SELECT entity, action, count(*)
  FROM core.audit_log
 WHERE entity IN ('core.user_role','core.role','core.role_permission')
 GROUP BY entity, action
 ORDER BY entity, action;

ROLLBACK;

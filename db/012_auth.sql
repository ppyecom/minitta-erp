-- =============================================================================
-- ERP v2 — 012: login, roles y permisos
--
-- Hasta acá el "quién" de toda la auditoría era la cabecera x-user-id, que el
-- navegador elige: cualquiera podía firmar como cualquiera. Esta migración le
-- pone contraseña a core.app_user, sesiones del lado del servidor (revocables)
-- y permisos por rol, de modo que el created_by de un movimiento y la firma de
-- una merma signifiquen algo.
--
-- Decisiones:
--   * La sesión vive en la base (core.user_session), no en un token firmado.
--     Así se puede revocar al instante y se ve dónde está conectado cada uno.
--     De la cookie sólo se guarda el SHA-256: robar la tabla no da acceso.
--   * Los permisos son filas, no un enum: se pueden crear roles sin migrar.
--   * core.user_can() es la única puerta. No consultar las tablas por su cuenta.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. contraseña y bloqueo por intentos en core.app_user
-- -----------------------------------------------------------------------------
ALTER TABLE core.app_user
  ADD COLUMN password_hash        text,
  ADD COLUMN password_set_at      timestamptz,
  ADD COLUMN must_change_password boolean     NOT NULL DEFAULT false,
  ADD COLUMN failed_attempts      integer     NOT NULL DEFAULT 0,
  ADD COLUMN locked_until         timestamptz,
  ADD COLUMN last_login_at        timestamptz;

COMMENT ON COLUMN core.app_user.password_hash IS
  'scrypt$N$r$p$salt_b64$hash_b64. NULL = el usuario todavía no puede entrar.';
COMMENT ON COLUMN core.app_user.must_change_password IS
  'La clave la puso un administrador: se exige cambiarla al primer ingreso.';
COMMENT ON COLUMN core.app_user.locked_until IS
  'Bloqueo temporal por intentos fallidos. Lo levanta el tiempo o un administrador.';

-- un usuario de sistema ('migracion', 'ecommerce', 'cron') no se loguea nunca
ALTER TABLE core.app_user
  ADD CONSTRAINT app_user_system_has_no_password
  CHECK (NOT is_system OR password_hash IS NULL);

-- -----------------------------------------------------------------------------
-- 2. permisos
-- -----------------------------------------------------------------------------
CREATE TABLE core.permission (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE,            -- 'inventory.count.apply'
  module      text NOT NULL,                   -- para agrupar en la pantalla de roles
  name        text NOT NULL,                   -- etiqueta en español
  description text,
  sort_order  integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE core.permission IS
  'Catálogo de permisos. Son filas y no un enum para poder agregar uno sin migrar.';

INSERT INTO core.permission (code, module, name, description, sort_order) VALUES
  -- catálogo
  ('catalog.read',           'Catálogo',  'Ver el catálogo',            'Productos, variantes y maestros', 10),
  ('catalog.write',          'Catálogo',  'Editar el catálogo',         'Crear y modificar productos y variantes', 11),
  ('catalog.masters',        'Catálogo',  'Editar maestros',            'Materiales, piedras, categorías, tallas', 12),
  -- costos y precios
  ('cost.read',              'Precios',   'Ver costos',                 'El costo desagregado de cada variante', 20),
  ('cost.write',             'Precios',   'Cargar costos',              'Cerrar el costo vigente y cargar otro', 21),
  ('pricing.read',           'Precios',   'Ver precios',                'Listas, precios vigentes y cotizaciones', 22),
  ('pricing.write',          'Precios',   'Editar precios',             'Listas de precio, precio del gramo, tipo de cambio', 23),
  -- inventario
  ('inventory.read',         'Inventario','Ver el inventario',          'Stock, kardex y piezas serializadas', 30),
  ('inventory.move',         'Inventario','Registrar movimientos',      'Ingresos, salidas y ajustes de stock', 31),
  ('inventory.transfer',     'Inventario','Transferencias entre sedes', 'Enviar y recibir mercadería', 32),
  ('inventory.count',        'Inventario','Abrir y cargar conteos',     'Inventario físico', 33),
  ('inventory.count.apply',  'Inventario','Aplicar conteos',            'Convertir las diferencias en movimientos', 34),
  -- procesos
  ('ops.custody',            'Procesos',  'Custodia de clientes',       'Recibir, mover y entregar piezas ajenas', 40),
  ('ops.workshop',           'Procesos',  'Taller',                     'Abrir, cargar y cerrar órdenes de trabajo', 41),
  ('ops.loss.approve',       'Procesos',  'Firmar merma',               'Aprobar la merma que supera el estándar', 42),
  ('ops.consignment',        'Procesos',  'Consignaciones',             'Entregar, registrar ventas y devoluciones', 43),
  ('ops.consignment.settle', 'Procesos',  'Liquidar consignaciones',    'Cerrar la liquidación con su comisión', 44),
  ('ops.layaway',            'Procesos',  'Apartados',                  'Cobrar cuotas y liberar vencidos', 45),
  -- administración
  ('core.locations',         'Ajustes',   'Administrar sedes',          NULL, 50),
  ('core.users',             'Ajustes',   'Administrar usuarios',       'Crear usuarios, asignar roles y resetear claves', 51),
  ('core.settings',          'Ajustes',   'Ajustes del sistema',        NULL, 52),
  ('core.audit',             'Ajustes',   'Ver la auditoría',           'Quién cambió qué y cuándo', 53);

-- -----------------------------------------------------------------------------
-- 3. roles
-- -----------------------------------------------------------------------------
CREATE TABLE core.role (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  -- un rol de sistema no se borra ni se le quitan permisos desde la pantalla
  is_system   boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_role_touch BEFORE UPDATE ON core.role
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- id propio (no PK compuesta) por la convención del esquema y porque
-- core.audit_row() necesita una columna 'id' para registrar el cambio.
CREATE TABLE core.role_permission (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_id       bigint NOT NULL REFERENCES core.role(id) ON DELETE CASCADE,
  permission_id bigint NOT NULL REFERENCES core.permission(id) ON DELETE CASCADE,
  UNIQUE (role_id, permission_id)
);

CREATE TABLE core.user_role (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES core.app_user(id) ON DELETE CASCADE,
  role_id    bigint NOT NULL REFERENCES core.role(id) ON DELETE CASCADE,
  granted_by bigint REFERENCES core.app_user(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role_id)
);
CREATE INDEX user_role_role_idx ON core.user_role (role_id);

INSERT INTO core.role (code, name, description, is_system) VALUES
  ('admin',    'Administrador', 'Todo, incluido usuarios y roles',              true),
  ('gerente',  'Gerencia',      'Todo lo operativo y los costos; no toca usuarios', false),
  ('vendedor', 'Vendedor',      'Vitrina: consulta, custodia y apartados',      false),
  ('taller',   'Taller',        'Órdenes de trabajo y los movimientos que generan', false),
  ('almacen',  'Almacén',       'Stock, transferencias y conteos',              false),
  ('contador', 'Contabilidad',  'Sólo lectura, con costos a la vista',          false);

-- admin: todos los permisos, siempre (también los que se agreguen después, ver user_can)
INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id FROM core.role r CROSS JOIN core.permission p WHERE r.code = 'admin';

-- gerencia: todo menos administrar usuarios
INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id FROM core.role r CROSS JOIN core.permission p
 WHERE r.code = 'gerente' AND p.code <> 'core.users';

INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id
  FROM (VALUES
    ('vendedor', ARRAY['catalog.read','pricing.read','inventory.read',
                       'ops.custody','ops.layaway']),
    ('taller',   ARRAY['catalog.read','inventory.read','inventory.move',
                       'ops.workshop','ops.custody']),
    ('almacen',  ARRAY['catalog.read','catalog.write','inventory.read','inventory.move',
                       'inventory.transfer','inventory.count','ops.consignment']),
    ('contador', ARRAY['catalog.read','pricing.read','inventory.read',
                       'cost.read','core.audit'])
  ) AS v(role_code, codes)
  JOIN core.role r       ON r.code = v.role_code
  JOIN core.permission p ON p.code = ANY (v.codes);

-- -----------------------------------------------------------------------------
-- 4. sesiones
-- -----------------------------------------------------------------------------
CREATE TABLE core.user_session (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES core.app_user(id) ON DELETE CASCADE,
  -- SHA-256 del token que viaja en la cookie; el token en claro no se guarda
  token_hash   text   NOT NULL UNIQUE,
  client_info  text,                              -- 'erp-web / caja-02'
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  revoked_by   bigint REFERENCES core.app_user(id)
);
CREATE INDEX user_session_user_idx ON core.user_session (user_id, created_at DESC);
CREATE INDEX user_session_live_idx ON core.user_session (expires_at)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE core.user_session IS
  'Sesiones abiertas. Revocar una fila cierra la sesión en el acto, sin esperar que expire.';

-- las sesiones vencidas y revocadas no se acumulan para siempre
CREATE OR REPLACE FUNCTION core.purge_sessions(p_keep_days integer DEFAULT 30)
RETURNS integer
LANGUAGE sql AS $$
  WITH gone AS (
    DELETE FROM core.user_session
     WHERE COALESCE(revoked_at, expires_at) < now() - make_interval(days => p_keep_days)
    RETURNING 1)
  SELECT count(*)::integer FROM gone;
$$;

-- -----------------------------------------------------------------------------
-- 5. core.user_can(): la única puerta para preguntar por un permiso
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.user_can(p_user_id bigint, p_permission text)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM core.user_role ur
      JOIN core.role r            ON r.id = ur.role_id AND r.is_active
      JOIN core.role_permission rp ON rp.role_id = r.id
      JOIN core.permission p       ON p.id = rp.permission_id
     WHERE ur.user_id = p_user_id
       AND p.code = p_permission
  )
  -- el administrador puede todo, incluidos los permisos que se agreguen después
  OR EXISTS (
    SELECT 1 FROM core.user_role ur
      JOIN core.role r ON r.id = ur.role_id AND r.is_active
     WHERE ur.user_id = p_user_id AND r.code = 'admin'
  )
  -- can_see_cost quedó de antes de los roles y sigue siendo válido para el costo:
  -- un usuario lo ve por el flag propio o por su rol, nunca se contradicen porque
  -- esta función es el único lugar donde se pregunta.
  OR (p_permission = 'cost.read' AND EXISTS (
    SELECT 1 FROM core.app_user WHERE id = p_user_id AND can_see_cost));
$$;

COMMENT ON FUNCTION core.user_can IS
  'Único lugar donde se evalúa un permiso. La API pregunta siempre por acá.';

-- todos los permisos efectivos de un usuario, para que la interfaz esconda lo que no puede
CREATE OR REPLACE FUNCTION core.user_permissions(p_user_id bigint)
RETURNS SETOF text
LANGUAGE sql STABLE AS $$
  SELECT p.code
    FROM core.permission p
   WHERE core.user_can(p_user_id, p.code)
   ORDER BY p.code;
$$;

-- -----------------------------------------------------------------------------
-- 6. la firma de la merma, ahora sí
-- -----------------------------------------------------------------------------
-- docs/08 §7: con la sesión por cabecera esta regla era decorativa. Con login
-- real pasa a ser estructural: quien carga la merma no puede firmarla.
ALTER TABLE ops.work_order_loss
  ADD CONSTRAINT wo_loss_approver_is_someone_else
  CHECK (approved_by IS NULL OR approved_by <> created_by);

COMMENT ON CONSTRAINT wo_loss_approver_is_someone_else ON ops.work_order_loss IS
  'La merma la firma otra persona. No hay forma de aprobarse la propia merma.';

-- -----------------------------------------------------------------------------
-- 7. vista de control: quién tiene qué
-- -----------------------------------------------------------------------------
CREATE VIEW core.v_user_access AS
SELECT u.id                                    AS user_id,
       u.username,
       u.full_name,
       u.is_active,
       u.is_system,
       (u.password_hash IS NOT NULL)           AS can_log_in,
       u.must_change_password,
       u.locked_until IS NOT NULL
         AND u.locked_until > now()            AS is_locked,
       u.last_login_at,
       COALESCE(array_agg(DISTINCT r.code ORDER BY r.code)
                FILTER (WHERE r.code IS NOT NULL), '{}')  AS roles,
       (SELECT count(*)::integer FROM core.user_session s
         WHERE s.user_id = u.id AND s.revoked_at IS NULL
           AND s.expires_at > now())           AS open_sessions
  FROM core.app_user u
  LEFT JOIN core.user_role ur ON ur.user_id = u.id
  LEFT JOIN core.role r       ON r.id = ur.role_id AND r.is_active
 GROUP BY u.id;

COMMENT ON VIEW core.v_user_access IS
  'Una fila por usuario: si puede entrar, si está bloqueado, sus roles y sus sesiones abiertas.';

-- -----------------------------------------------------------------------------
-- 8. auditoría de los cambios de acceso
-- -----------------------------------------------------------------------------
-- Cambiar un rol es tan sensible como mover stock: queda en core.audit_log.
CREATE TRIGGER trg_user_role_audit
  AFTER INSERT OR UPDATE OR DELETE ON core.user_role
  FOR EACH ROW EXECUTE FUNCTION core.audit_row();

CREATE TRIGGER trg_role_permission_audit
  AFTER INSERT OR UPDATE OR DELETE ON core.role_permission
  FOR EACH ROW EXECUTE FUNCTION core.audit_row();

CREATE TRIGGER trg_role_audit
  AFTER INSERT OR UPDATE OR DELETE ON core.role
  FOR EACH ROW EXECUTE FUNCTION core.audit_row();

# ERP v2 — Login, roles y permisos

Hasta la migración `011`, el "quién" de todo el ERP era la cabecera HTTP `x-user-id`, que el
navegador elegía. Cualquiera con la URL de la API podía mandar `x-user-id: 1` y firmar como
otro: la auditoría, el `created_by` de cada movimiento, la firma de un conteo y la de una
merma eran todas afirmaciones del cliente. `docs/08` §7 lo decía con esta frase: *"para la
operación diaria alcanza; para una discusión seria por gramos faltantes, no"*.

Esta etapa cierra eso. No agrega funciones nuevas al negocio: hace que todo el control que
ya estaba construido signifique algo.

---

## 1. Lo que cambió, en una línea

| Antes | Ahora |
|---|---|
| `x-user-id` en la cabecera, elegida en un combo | cookie de sesión `httpOnly` que pone la API al validar la contraseña |
| cualquiera podía ser cualquiera | contraseña con `scrypt` y bloqueo a los 5 intentos |
| un solo permiso (`can_see_cost`) | 22 permisos en filas, agrupados en 6 roles |
| la merma la podía firmar quien la cargó | lo impide una restricción de la base |
| la sesión no existía | vive en `core.user_session`: se revoca en el acto |

Los controladores de la API **no cambiaron**: siguen recibiendo `@CurrentUser()`. Lo único
que cambió es de dónde sale ese usuario (`apps/api/src/common/http.ts`).

---

## 2. La sesión vive en la base, no en un token firmado

Se eligió sesión del lado del servidor (`core.user_session`) y no un JWT:

- **Se revoca al instante.** Despedir a alguien, o notar una PC olvidada abierta, es un
  `UPDATE` de una fila. Con un JWT habría que esperar a que venza o mantener una lista negra,
  que es la misma tabla pero peor.
- **Se ve dónde está conectado cada uno.** `core.v_user_access.open_sessions`, y la pantalla
  *Mi cuenta* lista cada PC con la última vez que se usó.
- **No hay secreto de firma que rotar**, ni el problema de qué hacer cuando se filtra.

De la cookie sólo se guarda el **SHA-256** (`token_hash`): robarse la tabla no da acceso a
nada. La cookie es `httpOnly`, así que el JavaScript de la página no la puede leer y un XSS
no se la lleva.

La sesión dura **12 horas sin usarse** y se renueva en cada petición: es "12 horas sin
tocarla", no "12 horas desde que entró". Una jornada de tienda entra holgada sin dejar
sesiones abiertas de un día para el otro.

> **En producción, detrás de HTTPS**, hay que poner `secure: true` en la cookie
> (`apps/api/src/auth/auth.controller.ts`). Hoy está en `false` porque el ERP corre en
> `http://localhost` en la red de la tienda, y con `secure: true` el navegador no la mandaría.

## 3. La contraseña

`scrypt`, que viene en Node. No se usó `bcrypt` ni `argon2` a propósito: los dos arrastran
compilación nativa, que en Windows es una fuente de problemas al instalar. `scrypt` es un KDF
legítimo (RFC 7914) y los parámetros van guardados dentro del hash
(`scrypt$16384$8$1$salt$hash`), así que se pueden subir más adelante sin invalidar las
contraseñas que ya existen.

- Mínimo 8 caracteres. Corto a propósito: es un ERP interno en la red de la tienda, no un
  banco, y una exigencia alta termina en un papel pegado al monitor.
- **5 intentos fallidos bloquean 15 minutos.** Un administrador puede desbloquear antes.
- El mensaje de error es **siempre el mismo** (usuario inexistente, clave errada o usuario
  inactivo), y un usuario que no existe tarda lo mismo que uno con la clave mal: así no se
  puede averiguar qué usuarios hay.
- **Un administrador nunca termina sabiendo la clave de nadie.** Pone una, la dice en
  persona, y queda `must_change_password`: la API rechaza todo lo demás hasta que el dueño la
  cambie.
- Cambiar la propia clave **cierra las otras sesiones**. Si alguien la sabía, queda afuera.

## 4. Los permisos son filas, no un enum

`core.permission` tiene 22 filas (`catalog.read`, `inventory.count.apply`, `ops.loss.approve`,
`core.users`…). Un permiso nuevo es un `INSERT`, no una migración de tipo.

`core.role` + `core.role_permission` + `core.user_role` arman quién puede qué. Vienen 6 roles:

| Rol | Para qué |
|---|---|
| `admin` | todo, incluidos usuarios y roles |
| `gerente` | todo lo operativo y los costos; no toca usuarios |
| `vendedor` | vitrina: consulta, custodia y apartados |
| `taller` | órdenes de trabajo y los movimientos que generan |
| `almacen` | stock, transferencias y conteos |
| `contador` | sólo lectura, con costos y auditoría a la vista |

**`core.user_can(user_id, permiso)` es la única puerta.** La API nunca consulta las tablas de
roles por su cuenta. Eso hace que tres cosas no se puedan contradecir:

1. El rol `admin` puede todo, **incluidos los permisos que se creen después**. Cuando llegue
   el módulo de ventas con `sales.invoice.void`, el administrador ya lo tiene sin que nadie le
   toque una fila. Los demás roles no heredan nada automáticamente, que es lo correcto.
2. `can_see_cost` (la columna que reemplazó a la `CLAVE` en letras del legacy) **sigue
   valiendo**: `user_can(u, 'cost.read')` devuelve true por el flag propio **o** por el rol.
   No hay dos fuentes de verdad porque sólo hay un lugar donde se pregunta.
3. Un rol desactivado (`is_active = false`) deja de dar permisos sin tener que borrar nada.

### Dónde se aplica

`AuthGuard` está registrado como `APP_GUARD`: **protege todos los endpoints por omisión**. Un
endpoint se abre a propósito con `@Public()` (sólo `/auth/status`, `/auth/bootstrap` y
`/auth/login`), nunca por olvido. Eso significa que agregar un controlador nuevo —ventas,
compras, caja— no puede dejar un agujero.

El permiso se declara con `@Requires('...')`, a nivel de clase para la lectura del dominio y
sobre el método para la acción:

```ts
@Requires('inventory.read')          // toda la clase: ver el inventario
@Controller('counts')
export class CountsController {
  @Get() list() { /* alcanza con inventory.read */ }

  @Requires('inventory.count')       // cargar el conteo
  @Post() create() { }

  @Requires('inventory.count.apply') // convertir las diferencias en movimientos
  @Post(':id/apply') apply() { }
}
```

Que abrir un conteo y **aplicarlo** sean permisos distintos no es un detalle: aplicarlo genera
movimientos de ajuste contra el stock real. Lo mismo con `ops.consignment` y
`ops.consignment.settle`.

La interfaz usa los mismos nombres (`can('inventory.move')`) para esconder lo que no se puede
usar, pero **eso es cortesía, no seguridad**: el corte está en la API.

## 5. La firma de la merma, ahora de verdad

`docs/08` §7 anotaba que la aprobación de la merma existía pero no se validaba que firmara
otro, porque con la sesión por cabecera habría sido decorativo. Con login real pasa a ser
**estructural**:

```sql
ALTER TABLE ops.work_order_loss
  ADD CONSTRAINT wo_loss_approver_is_someone_else
  CHECK (approved_by IS NULL OR approved_by <> created_by);
```

No hay forma de aprobarse la propia merma: ni por la API, ni por un `UPDATE` a mano, ni por un
script. Y además hace falta el permiso `ops.loss.approve`, que `vendedor` y `taller` no tienen.

## 6. Qué queda en la auditoría

Cambiar un rol es tan sensible como mover stock, así que `core.user_role`, `core.role` y
`core.role_permission` tienen el trigger `core.audit_row()`: quién le dio qué permiso a quién
y cuándo queda en `core.audit_log`, igual que todo lo demás.

`core.app_user` guarda `last_login_at`, y `core.v_user_access` resume por persona si puede
entrar, si está bloqueada, sus roles y sus sesiones abiertas.

## 7. Cómo arranca

La base recién migrada **no tiene ninguna persona**, sólo los tres usuarios de sistema
(`migracion`, `ecommerce`, `sistema`), que no se loguean nunca: una restricción les prohíbe
tener contraseña.

1. La web pregunta `GET /auth/status` y, si `needsBootstrap`, muestra la pantalla de primer
   arranque.
2. `POST /auth/bootstrap` crea el primer usuario con el rol `admin`. **Funciona una sola vez**:
   en cuanto existe una persona, deja de responder.
3. Ese administrador da de alta al resto: crea el usuario, le asigna roles y le pone una clave
   desde *Ajustes → Usuarios y accesos*.

## 8. Qué se probó

`db/996_smoke_auth.sql` (corre con `-SmokeTest`, termina en `ROLLBACK`):

- cada rol puede exactamente lo suyo, el administrador todo y alguien sin rol nada
- un permiso recién creado lo tiene el administrador y **no** lo heredan los demás
- `can_see_cost` sigue dando `cost.read`
- revocar una sesión la cierra en el acto; `purge_sessions()` no toca las vivas
- **4 reglas que deben rechazarse**: un usuario de sistema con contraseña, un rol duplicado,
  dos sesiones con el mismo token, y firmarse la propia merma

`scripts/e2e-auth.ps1` (`npm run test:auth`) levanta la API contra una base desechable y
recorre el camino real, 38 chequeos. Verifica lo que el SQL no puede: que la cookie sea
`httpOnly`, que el hash nunca salga en una respuesta, que el guard global tape los endpoints
por omisión, que un usuario inexistente dé el mismo mensaje que una clave errada, que la
vendedora reciba 403 al mover stock, y que el bloqueo a los 5 intentos funcione.

## 9. Lo que todavía falta

- **HTTPS y `secure: true` en la cookie** cuando el ERP salga de `localhost`.
- **Segundo factor**: no está, y para una red de tienda probablemente no haga falta.
- **Permisos por sede.** Hoy un vendedor con `inventory.read` ve el stock de todas las sedes.
  Falta acotar por `location_id`; el modelo lo permite (`core.location.manager_user_id` ya
  existe) pero no se implementó.
- **Expiración de contraseñas** y política de reuso: a propósito no están.
- **Revisar los roles con la gente de tienda.** Los 6 que vienen son una propuesta razonable,
  no una decisión tomada: son filas, se cambian desde la pantalla sin migrar nada.

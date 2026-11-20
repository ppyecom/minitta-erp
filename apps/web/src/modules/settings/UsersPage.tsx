import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Lock, LogOut, Plus, ShieldCheck, Unlock, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useSave } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { relative } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input } from '@/components/ui/form';
import { Badge, Card } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/overlay';
import { DataTable, EmptyState, Mono, PageHeader } from '@/components/common';

interface UserRow {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  document_id: string | null;
  can_see_cost: boolean;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
}

/** core.v_user_access: si puede entrar, si está bloqueado, sus roles y sesiones. */
interface AccessRow {
  user_id: number;
  username: string;
  full_name: string;
  is_active: boolean;
  is_system: boolean;
  can_log_in: boolean;
  must_change_password: boolean;
  is_locked: boolean;
  last_login_at: string | null;
  roles: string[];
  open_sessions: number;
}

interface RoleRow {
  id: number;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  permission_ids: number[];
  users: number;
}

const blank = { username: '', full_name: '', email: '', document_id: '', can_see_cost: false, is_active: true };

function UserDialog({ user, open, onOpenChange }: { user: UserRow | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [v, setV] = useState(blank);
  useEffect(() => {
    if (open)
      setV(
        user
          ? { username: user.username, full_name: user.full_name, email: user.email ?? '', document_id: user.document_id ?? '', can_see_cost: user.can_see_cost, is_active: user.is_active }
          : blank,
      );
  }, [open, user]);
  const save = useSave(() => (user ? api.put(`/users/${user.id}`, v) : api.post('/users', v)), {
    success: user ? 'Usuario actualizado' : 'Usuario creado',
    invalidate: [['users'], ['access-users'], ['lookups']],
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={user ? user.full_name : 'Nuevo usuario'}
      description={
        user
          ? 'Los roles y la contraseña se manejan con los botones de la fila.'
          : 'Se crea sin contraseña: todavía no puede entrar. Póngale una con “Dar clave” y asígnele un rol.'
      }
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre completo" required error={save.fields.full_name} className="sm:col-span-2">
          <Input value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} />
        </Field>
        <Field label="Usuario" required error={save.fields.username}>
          <Input value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} className="font-mono" />
        </Field>
        <Field label="DNI" hint="Para firmar conteos">
          <Input value={v.document_id} onChange={(e) => setV({ ...v, document_id: e.target.value })} />
        </Field>
        <Field label="Correo" className="sm:col-span-2">
          <Input value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </Field>
        <div className="space-y-2.5 sm:col-span-2">
          <Checkbox
            checked={v.can_see_cost}
            onCheckedChange={(x) => setV({ ...v, can_see_cost: x })}
            label="Puede ver y editar costos"
            description='Reemplaza la "CLAVE" en letras del sistema viejo. También lo da el rol.'
          />
          <Checkbox checked={v.is_active} onCheckedChange={(x) => setV({ ...v, is_active: x })} label="Activo" />
        </div>
      </div>
    </Dialog>
  );
}

/** Asignar roles a una persona. Reemplaza la lista completa. */
function RolesDialog({ user, roles, open, onOpenChange }: { user: AccessRow | null; roles: RoleRow[]; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [ids, setIds] = useState<number[]>([]);
  useEffect(() => {
    if (open && user) setIds(roles.filter((r) => user.roles.includes(r.code)).map((r) => r.id));
  }, [open, user, roles]);

  const save = useSave(() => api.put(`/access/users/${user!.user_id}/roles`, { role_ids: ids }), {
    success: 'Roles actualizados',
    invalidate: [['access-users'], ['users']],
    onSuccess: () => onOpenChange(false),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Roles de ${user?.full_name ?? ''}`}
      description="El rol define qué puede hacer. Cada cambio queda en la auditoría."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-2.5">
        {roles
          .filter((r) => r.is_active)
          .map((r) => (
            <Checkbox
              key={r.id}
              checked={ids.includes(r.id)}
              onCheckedChange={(x) => setIds((prev) => (x ? [...prev, r.id] : prev.filter((i) => i !== r.id)))}
              label={r.name}
              description={r.description ?? r.code}
            />
          ))}
        {ids.length === 0 && (
          <p className="pt-2 text-xs text-warning-foreground">
            Sin ningún rol, esta persona puede entrar pero no ve nada.
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** Un administrador le pone una clave a otro; el dueño la cambia al entrar. */
function PasswordDialog({ user, open, onOpenChange }: { user: AccessRow | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [v, setV] = useState({ new_password: '', repeat: '' });
  useEffect(() => {
    if (open) setV({ new_password: '', repeat: '' });
  }, [open]);

  const save = useSave(
    () => {
      if (v.new_password !== v.repeat) throw new Error('Las dos contraseñas no coinciden');
      return api.post(`/auth/users/${user!.user_id}/password`, { new_password: v.new_password });
    },
    {
      success: 'Clave puesta. La persona la tiene que cambiar al entrar.',
      invalidate: [['access-users']],
      onSuccess: () => onOpenChange(false),
    },
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Clave de ${user?.full_name ?? ''}`}
      description="Dígasela en persona. Al entrar, el sistema le va a exigir cambiarla: usted no termina sabiendo su clave."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="gold" loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Poner la clave
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Contraseña" required hint="Mínimo 8 caracteres." error={save.fields.new_password}>
          <Input type="text" value={v.new_password} onChange={(e) => setV({ ...v, new_password: e.target.value })} />
        </Field>
        <Field label="Repetir" required>
          <Input type="text" value={v.repeat} onChange={(e) => setV({ ...v, repeat: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}

export function UsersPage() {
  const { user: me, can } = useSession();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<UserRow | null | undefined>(undefined);
  const [rolesOf, setRolesOf] = useState<AccessRow | null>(null);
  const [passwordOf, setPasswordOf] = useState<AccessRow | null>(null);

  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserRow[]>('/users') });
  const access = useQuery({ queryKey: ['access-users'], queryFn: () => api.get<AccessRow[]>('/access/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleRow[]>('/access/roles') });

  const act = useMutation({
    mutationFn: ({ id, what }: { id: number; what: 'unlock' | 'logout' }) =>
      api.post(`/auth/users/${id}/${what}`),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['access-users'] });
      toast.success(v.what === 'unlock' ? 'Usuario desbloqueado' : 'Sesiones cerradas');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const admin = can('core.users');
  const byId = new Map(users.data?.map((u) => [u.id, u]) ?? []);

  return (
    <>
      <PageHeader
        title="Usuarios y accesos"
        description="Quién puede entrar y qué puede hacer. Todo movimiento queda firmado con el usuario de la sesión, y cada cambio de rol en la auditoría."
        actions={
          admin && (
            <Button onClick={() => setEditing(null)}>
              <Plus /> Nuevo usuario
            </Button>
          )
        }
      />
      <Card>
        <DataTable
          rows={access.data?.filter((r) => !r.is_system)}
          loading={access.isLoading}
          rowKey={(r) => r.user_id}
          columns={[
            {
              key: 'n',
              header: 'Nombre',
              cell: (r) => (
                <div className="flex items-center gap-2.5">
                  <span className="flex size-7 items-center justify-center rounded-full bg-gold-soft text-xs font-semibold text-gold-foreground">
                    {r.full_name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="font-medium">{r.full_name}</span>
                  {r.user_id === me?.id && <Badge tone="info">Usted</Badge>}
                </div>
              ),
            },
            { key: 'u', header: 'Usuario', cell: (r) => <Mono>{r.username}</Mono> },
            {
              key: 'r',
              header: 'Roles',
              cell: (r) =>
                r.roles.length ? (
                  <div className="flex flex-wrap gap-1">
                    {r.roles.map((c) => (
                      <Badge key={c} tone="outline">
                        {roles.data?.find((x) => x.code === c)?.name ?? c}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <Badge tone="warning">Sin rol</Badge>
                ),
            },
            {
              key: 'c',
              header: 'Costos',
              cell: (r) =>
                byId.get(r.user_id)?.can_see_cost ? (
                  <Badge tone="gold">
                    <Lock /> Ve costos
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
              className: 'hidden lg:table-cell',
            },
            {
              key: 'e',
              header: 'Acceso',
              cell: (r) =>
                r.is_locked ? (
                  <Badge tone="danger" dot>
                    Bloqueado
                  </Badge>
                ) : !r.can_log_in ? (
                  <Badge tone="warning" dot>
                    Sin clave
                  </Badge>
                ) : r.must_change_password ? (
                  <Badge tone="warning" dot>
                    Debe cambiarla
                  </Badge>
                ) : (
                  <Badge tone="success" dot>
                    {r.open_sessions > 0 ? `Conectado (${r.open_sessions})` : 'Puede entrar'}
                  </Badge>
                ),
            },
            {
              key: 'l',
              header: 'Último ingreso',
              cell: (r) => (
                <span className="text-muted-foreground">
                  {r.last_login_at ? relative(r.last_login_at) : 'nunca'}
                </span>
              ),
              className: 'hidden md:table-cell',
            },
            {
              key: 'x',
              header: '',
              cell: (r) =>
                admin && (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(byId.get(r.user_id) ?? null)}>
                      Editar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRolesOf(r)}>
                      <ShieldCheck /> Roles
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setPasswordOf(r)}>
                      <KeyRound /> {r.can_log_in ? 'Resetear' : 'Dar clave'}
                    </Button>
                    {r.is_locked && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => act.mutate({ id: r.user_id, what: 'unlock' })}
                      >
                        <Unlock /> Desbloquear
                      </Button>
                    )}
                    {r.open_sessions > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => act.mutate({ id: r.user_id, what: 'logout' })}
                      >
                        <LogOut /> Cerrar sesiones
                      </Button>
                    )}
                  </div>
                ),
            },
          ]}
          empty={<EmptyState icon={Users} title="Sin usuarios" />}
        />
      </Card>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Roles</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Cuántos permisos trae cada rol y cuánta gente lo tiene. El administrador siempre puede todo,
          incluidos los permisos de los módulos que vengan después.
        </p>
        <Card className="mt-3">
          <DataTable
            rows={roles.data}
            loading={roles.isLoading}
            rowKey={(r) => r.id}
            columns={[
              { key: 'n', header: 'Rol', cell: (r) => <span className="font-medium">{r.name}</span> },
              { key: 'c', header: 'Código', cell: (r) => <Mono>{r.code}</Mono> },
              {
                key: 'd',
                header: 'Para qué',
                cell: (r) => <span className="text-muted-foreground">{r.description ?? '—'}</span>,
                className: 'hidden md:table-cell',
              },
              {
                key: 'p',
                header: 'Permisos',
                cell: (r) => (r.is_system ? <Badge tone="gold">todos</Badge> : r.permission_ids.length),
              },
              { key: 'u', header: 'Personas', cell: (r) => r.users },
            ]}
            empty={<EmptyState icon={ShieldCheck} title="Sin roles" />}
          />
        </Card>
      </section>

      <UserDialog user={editing ?? null} open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} />
      <RolesDialog
        user={rolesOf}
        roles={roles.data ?? []}
        open={rolesOf !== null}
        onOpenChange={(o) => !o && setRolesOf(null)}
      />
      <PasswordDialog user={passwordOf} open={passwordOf !== null} onOpenChange={(o) => !o && setPasswordOf(null)} />
    </>
  );
}

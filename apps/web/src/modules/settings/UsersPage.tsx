import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock, Plus, Users } from 'lucide-react';
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
    invalidate: [['users'], ['lookups']],
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={user ? user.full_name : 'Nuevo usuario'}
      description="Por ahora sin contraseña: se elige en la barra superior. El login completo llega con el módulo de seguridad."
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
            description='Reemplaza la "CLAVE" en letras del sistema viejo'
          />
          <Checkbox checked={v.is_active} onCheckedChange={(x) => setV({ ...v, is_active: x })} label="Activo" />
        </div>
      </div>
    </Dialog>
  );
}

export function UsersPage() {
  const { userId } = useSession();
  const [editing, setEditing] = useState<UserRow | null | undefined>(undefined);
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserRow[]>('/users') });
  return (
    <>
      <PageHeader
        title="Usuarios"
        description="Quién registra cada cosa. Todo movimiento y todo cambio queda firmado con el usuario elegido."
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus /> Nuevo usuario
          </Button>
        }
      />
      <Card>
        <DataTable
          rows={data}
          loading={isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => !r.is_system && setEditing(r)}
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
                  {r.id === userId && <Badge tone="info">Usted</Badge>}
                </div>
              ),
            },
            { key: 'u', header: 'Usuario', cell: (r) => <Mono>{r.username}</Mono> },
            { key: 'c', header: 'Costos', cell: (r) => (r.can_see_cost ? <Badge tone="gold"><Lock /> Ve costos</Badge> : <span className="text-muted-foreground">—</span>) },
            { key: 't', header: 'Tipo', cell: (r) => (r.is_system ? <Badge>Sistema</Badge> : <Badge tone="outline">Persona</Badge>) },
            { key: 'a', header: 'Alta', cell: (r) => <span className="text-muted-foreground">{relative(r.created_at)}</span>, className: 'hidden md:table-cell' },
            { key: 's', header: 'Estado', cell: (r) => (r.is_active ? <Badge tone="success" dot>Activo</Badge> : <Badge dot>Inactivo</Badge>) },
          ]}
          empty={<EmptyState icon={Users} title="Sin usuarios" />}
        />
      </Card>
      <UserDialog user={editing ?? null} open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} />
    </>
  );
}

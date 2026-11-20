import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, MonitorSmartphone } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Badge } from '@/components/ui/misc';

interface OpenSession {
  id: number;
  client_info: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  is_current: boolean;
}

const when = (v: string) =>
  new Date(v).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function MyAccountPage() {
  const { user } = useSession();
  const qc = useQueryClient();
  const [form, setForm] = useState({ current_password: '', new_password: '', repeat: '' });

  const sessions = useQuery({
    queryKey: ['my-sessions'],
    queryFn: () => api.get<OpenSession[]>('/auth/sessions'),
  });

  const change = useMutation({
    mutationFn: async () => {
      if (form.new_password !== form.repeat) throw new Error('Las dos contraseñas no coinciden');
      await api.post('/auth/password', {
        current_password: form.current_password,
        new_password: form.new_password,
      });
    },
    onSuccess: () => {
      setForm({ current_password: '', new_password: '', repeat: '' });
      qc.invalidateQueries({ queryKey: ['my-sessions'] });
      toast.success('Contraseña cambiada. Las demás sesiones se cerraron.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mi cuenta</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {user?.full_name} · {user?.username}
        </p>
      </div>

      <section className="max-w-md rounded-xl border bg-card p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Lock className="size-4 text-gold" /> Cambiar la contraseña
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Al cambiarla se cierran las demás sesiones: si alguien más la sabía, queda afuera.
        </p>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate();
          }}
        >
          <Field label="Contraseña actual" required>
            <Input
              type="password"
              autoComplete="current-password"
              value={form.current_password}
              onChange={(e) => setForm({ ...form, current_password: e.target.value })}
            />
          </Field>
          <Field label="Contraseña nueva" required hint="Mínimo 8 caracteres.">
            <Input
              type="password"
              autoComplete="new-password"
              value={form.new_password}
              onChange={(e) => setForm({ ...form, new_password: e.target.value })}
            />
          </Field>
          <Field label="Repetir la nueva" required>
            <Input
              type="password"
              autoComplete="new-password"
              value={form.repeat}
              onChange={(e) => setForm({ ...form, repeat: e.target.value })}
            />
          </Field>
          <Button type="submit" variant="gold" loading={change.isPending}>
            Guardar
          </Button>
        </form>
      </section>

      <section className="max-w-2xl rounded-xl border bg-card p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <MonitorSmartphone className="size-4 text-gold" /> Dónde está abierta mi sesión
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          La sesión caduca a las 12 horas sin usarla. Si ve una PC que no reconoce, cambie la contraseña.
        </p>
        <div className="mt-4 divide-y text-sm">
          {sessions.data?.map((s) => (
            <div key={s.id} className="flex items-center gap-3 py-2.5">
              <span className="flex-1 font-medium">{s.client_info ?? 'erp-web'}</span>
              <span className="text-xs text-muted-foreground">
                desde {when(s.created_at)} · visto {when(s.last_seen_at)}
              </span>
              {s.is_current && <Badge tone="gold">esta PC</Badge>}
            </div>
          ))}
          {sessions.data?.length === 0 && (
            <p className="py-2 text-muted-foreground">Ninguna sesión abierta.</p>
          )}
        </div>
      </section>
    </div>
  );
}

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Gem, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { setStation, station, useSession, type Me } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';

/** Marco común de las tres pantallas sin sesión. */
function Card({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm">
        <div className="mb-6 flex size-11 items-center justify-center rounded-xl bg-stone-900 text-gold">
          <Gem className="size-5" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
        {children}
      </div>
    </div>
  );
}

/** Ingreso normal. */
export function LoginPage() {
  const { login } = useSession();
  const [form, setForm] = useState({ username: '', password: '' });
  const [pc, setPc] = useState(station());

  const m = useMutation({
    mutationFn: () => {
      setStation(pc);
      return login({ ...form, station: pc || null });
    },
    onError: (e: Error) =>
      toast.error(e instanceof ApiError && e.status === 401 ? e.message : 'No se pudo ingresar: ' + e.message),
  });

  return (
    <Card
      title="Minitta ERP"
      hint="Todo lo que registre queda firmado con su usuario: los movimientos de stock, los conteos y las firmas de merma."
    >
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Usuario" required>
          <Input
            autoFocus
            autoComplete="username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
        </Field>
        <Field label="Contraseña" required>
          <Input
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <Field label="Esta PC" hint="Queda en la auditoría junto a cada cambio. Ej: caja-02, taller.">
          <Input value={pc} onChange={(e) => setPc(e.target.value)} placeholder="caja-02" />
        </Field>
        <Button type="submit" variant="gold" className="w-full" loading={m.isPending}>
          Ingresar
        </Button>
      </form>
    </Card>
  );
}

/**
 * Primer arranque: la base está migrada pero no hay ninguna persona todavía.
 * Crea el administrador, que es el único que después puede dar de alta al resto.
 */
export function BootstrapPage() {
  const { login, refresh } = useSession();
  const [form, setForm] = useState({ username: 'admin', full_name: '', password: '', repeat: '' });

  const m = useMutation({
    mutationFn: async () => {
      if (form.password !== form.repeat) throw new Error('Las dos contraseñas no coinciden');
      const r = await api.post<{ created: boolean }>('/auth/bootstrap', {
        username: form.username,
        full_name: form.full_name,
        password: form.password,
      });
      if (!r.created) {
        // alguien más lo creó mientras esta pantalla estaba abierta
        await refresh();
        throw new Error('Ya existe un usuario: ingrese con su clave');
      }
      await login({ username: form.username, password: form.password, station: station() || null });
    },
    onSuccess: () => toast.success('Usuario administrador creado'),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card
      title="Bienvenido a Minitta ERP"
      hint="Cree el usuario administrador. Es el único que puede dar de alta a los demás y asignar roles."
    >
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Nombre completo" required>
          <Input
            autoFocus
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
        </Field>
        <Field label="Usuario" required>
          <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </Field>
        <Field label="Contraseña" required hint="Mínimo 8 caracteres.">
          <Input
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <Field label="Repetir la contraseña" required>
          <Input
            type="password"
            autoComplete="new-password"
            value={form.repeat}
            onChange={(e) => setForm({ ...form, repeat: e.target.value })}
          />
        </Field>
        <Button type="submit" variant="gold" className="w-full" loading={m.isPending}>
          Empezar
        </Button>
      </form>
    </Card>
  );
}

/**
 * La clave la puso un administrador: hay que cambiarla antes de hacer cualquier
 * otra cosa. Hasta entonces la API rechaza todo lo demás (AuthGuard).
 */
export function ChangePasswordPage() {
  const { user, refresh, logout } = useSession();
  const [form, setForm] = useState({ current_password: '', new_password: '', repeat: '' });

  const m = useMutation({
    mutationFn: async () => {
      if (form.new_password !== form.repeat) throw new Error('Las dos contraseñas no coinciden');
      await api.post('/auth/password', {
        current_password: form.current_password,
        new_password: form.new_password,
      });
      await refresh();
    },
    onSuccess: () => toast.success('Contraseña cambiada'),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card
      title="Cambie su contraseña"
      hint={`Hola ${user?.full_name ?? ''}. Su clave la puso un administrador: elija una que sólo sepa usted.`}
    >
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Contraseña actual" required>
          <Input
            autoFocus
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
        <Button type="submit" variant="gold" className="w-full" loading={m.isPending}>
          <Lock /> Guardar y continuar
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => void logout()}>
          Salir
        </Button>
      </form>
    </Card>
  );
}

/** Lo que el provider muestra mientras no hay sesión utilizable. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status, user } = useSession();
  if (status === 'loading') return <div className="min-h-screen bg-background" />;
  if (status === 'bootstrap') return <BootstrapPage />;
  if (status === 'anonymous' || !user) return <LoginPage />;
  if (user.must_change_password) return <ChangePasswordPage />;
  return <>{children}</>;
}

export type { Me };

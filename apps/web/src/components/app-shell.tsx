import { useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Boxes,
  ChevronsUpDown,
  ClipboardCheck,
  Coins,
  Gem,
  History,
  LayoutDashboard,
  ListTree,
  MapPin,
  Menu as MenuIcon,
  Moon,
  Package,
  ScanBarcode,
  Sun,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useLookups } from '@/lib/lookups';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Field, Input } from './ui/form';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from './ui/overlay';
import { Skeleton } from './ui/misc';

type NavItem = { to: string; label: string; icon: ComponentType<{ className?: string }>; end?: boolean };

const NAV: { title?: string; items: NavItem[] }[] = [
  { items: [{ to: '/', label: 'Inicio', icon: LayoutDashboard, end: true }] },
  {
    title: 'Catálogo',
    items: [
      { to: '/catalogo/productos', label: 'Productos', icon: Gem },
      { to: '/catalogo/maestros', label: 'Maestros', icon: ListTree },
    ],
  },
  {
    title: 'Inventario',
    items: [
      { to: '/inventario/stock', label: 'Stock por sede', icon: Boxes },
      { to: '/inventario/kardex', label: 'Kardex', icon: History },
      { to: '/inventario/piezas', label: 'Piezas', icon: ScanBarcode },
      { to: '/inventario/transferencias', label: 'Transferencias', icon: ArrowLeftRight },
      { to: '/inventario/conteos', label: 'Inventario físico', icon: ClipboardCheck },
    ],
  },
  { title: 'Precios', items: [{ to: '/precios', label: 'Listas y cotizaciones', icon: Coins }] },
  {
    title: 'Ajustes',
    items: [
      { to: '/ajustes/sedes', label: 'Sedes', icon: MapPin },
      { to: '/ajustes/usuarios', label: 'Usuarios', icon: Users },
    ],
  },
];

// módulos que vienen, para que se vea el camino (deshabilitados)
const SOON = ['Ventas', 'Compras', 'Caja', 'Clientes', 'Taller'];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-stone-900 text-gold shadow-sm dark:bg-stone-800">
          <Gem className="size-4" />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">Minitta</div>
          <div className="text-[11px] text-muted-foreground">ERP · Joyería</div>
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {NAV.map((g, i) => (
          <div key={i}>
            {g.title && (
              <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
                {g.title}
              </div>
            )}
            <div className="space-y-0.5">
              {g.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] font-medium text-sidebar-foreground transition-colors hover:bg-accent hover:text-foreground',
                      isActive && 'bg-card text-foreground shadow-xs ring-1 ring-border',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <it.icon className={cn('size-4 text-muted-foreground', isActive && 'text-gold')} />
                      {it.label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
        <div>
          <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Próximamente
          </div>
          {SOON.map((s) => (
            <div key={s} className="flex h-7 items-center gap-2.5 px-2 text-[13px] text-muted-foreground/50">
              <Package className="size-3.5" />
              {s}
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-sidebar-border px-4 py-3 text-[11px] text-muted-foreground">
        Base v2 · PostgreSQL · imágenes locales
      </div>
    </nav>
  );
}

function SessionBar() {
  const { data } = useLookups();
  const { userId, setUserId, locationId, setLocationId, theme, toggleTheme } = useSession();
  const user = data?.users.find((u) => u.id === userId);
  const loc = data?.locations.find((l) => l.id === locationId);
  const people = data?.users.filter((u) => u.is_active) ?? [];
  const stores = data?.locations.filter((l) => l.is_active && l.holds_stock) ?? [];

  return (
    <div className="flex items-center gap-1.5">
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
            <MapPin />
            <span className="hidden sm:inline">{loc ? loc.code : 'Todas las sedes'}</span>
            <ChevronsUpDown className="size-3.5 opacity-60" />
          </Button>
        </MenuTrigger>
        <MenuContent className="max-h-80 overflow-y-auto">
          <MenuLabel>Sede de trabajo (filtro por defecto)</MenuLabel>
          <MenuItem onSelect={() => setLocationId(null)}>Todas las sedes</MenuItem>
          <MenuSeparator />
          {stores.map((l) => (
            <MenuItem key={l.id} onSelect={() => setLocationId(l.id)}>
              <span className="w-16 font-mono text-xs">{l.code}</span>
              <span className="truncate">{l.name}</span>
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>

      <Menu>
        <MenuTrigger asChild>
          <button
            className={cn(
              'flex h-8 items-center gap-2 rounded-full border bg-card pl-1 pr-2.5 text-[13px] font-medium shadow-xs transition-colors hover:bg-accent',
              !user && 'border-warning bg-warning-soft',
            )}
          >
            <span className="flex size-6 items-center justify-center rounded-full bg-gold-soft text-[11px] font-semibold text-gold-foreground">
              {user ? user.full_name.slice(0, 1).toUpperCase() : <UserRound className="size-3.5" />}
            </span>
            <span className="max-w-32 truncate">{user ? user.full_name : 'Elegir usuario'}</span>
          </button>
        </MenuTrigger>
        <MenuContent>
          <MenuLabel>¿Quién está usando esta PC?</MenuLabel>
          {people.map((u) => (
            <MenuItem key={u.id} onSelect={() => setUserId(u.id)}>
              <UserRound />
              <span className="flex-1">{u.full_name}</span>
              {u.is_system && <span className="text-[10px] text-muted-foreground">sistema</span>}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>

      <Button variant="ghost" size="icon-sm" onClick={toggleTheme} aria-label="Cambiar tema">
        {theme === 'dark' ? <Sun /> : <Moon />}
      </Button>
    </div>
  );
}

/** Primer arranque: si no hay usuarios de personas, se crea el administrador. */
function FirstRun() {
  const qc = useQueryClient();
  const { setUserId } = useSession();
  const [form, setForm] = useState({ username: 'admin', full_name: '' });
  const m = useMutation({
    mutationFn: () => api.post<{ created: boolean; user?: { id: number } }>('/users/bootstrap', form),
    onSuccess: (r) => {
      if (r.user) setUserId(r.user.id);
      qc.invalidateQueries({ queryKey: ['lookups'] });
      toast.success('Usuario administrador creado');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm">
        <div className="mb-6 flex size-11 items-center justify-center rounded-xl bg-stone-900 text-gold">
          <Gem className="size-5" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Bienvenido a Minitta ERP</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cree su usuario administrador. Todo lo que se registre queda firmado con su nombre en la auditoría.
        </p>
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <Field label="Nombre completo" required>
            <Input autoFocus value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </Field>
          <Field label="Usuario" required>
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <Button type="submit" variant="gold" className="w-full" loading={m.isPending}>
            Empezar
          </Button>
        </form>
      </div>
    </div>
  );
}

export function AppShell() {
  const { data, isLoading, error } = useLookups();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const needsSetup = data && !data.users.some((u) => !u.is_system);

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-stone-950/40" onClick={() => setMobileOpen(false)} />
          <aside className="animate-slide-in-right absolute inset-y-0 left-0 w-64 border-r bg-sidebar">
            <button className="absolute right-3 top-4 p-1" onClick={() => setMobileOpen(false)}>
              <X className="size-4" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background/80 px-4 backdrop-blur lg:px-6">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOpen(true)}>
            <MenuIcon />
          </Button>
          <div className="hidden text-[13px] text-muted-foreground lg:block">
            {new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <SessionBar />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div key={location.pathname} className="animate-fade-in mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-8">
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-8 w-60" />
                <Skeleton className="h-64 w-full" />
              </div>
            ) : error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive-soft p-6 text-sm">
                <div className="font-semibold text-destructive">No se pudo conectar con la API</div>
                <p className="mt-1 text-muted-foreground">
                  Verifique que PostgreSQL y la API estén corriendo (<code>npm run db:start</code> y{' '}
                  <code>npm run dev</code>). Detalle: {(error as Error).message}
                </p>
              </div>
            ) : needsSetup ? (
              <FirstRun />
            ) : (
              <Outlet />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

import { useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
  ArrowLeftRight,
  Boxes,
  ChevronsUpDown,
  ClipboardCheck,
  ClipboardList,
  Contact,
  Coins,
  Gem,
  HandCoins,
  Hammer,
  History,
  LayoutDashboard,
  LogOut,
  ListTree,
  MapPin,
  Menu as MenuIcon,
  Moon,
  Package,
  PackageSearch,
  ScanBarcode,
  Store,
  Sun,
  UserRound,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useLookups } from '@/lib/lookups';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from './ui/overlay';
import { Skeleton } from './ui/misc';

type NavItem = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
  /** Permiso que habilita el ítem. Sin él, no se muestra. */
  can?: string;
};

const NAV: { title?: string; items: NavItem[] }[] = [
  { items: [{ to: '/', label: 'Inicio', icon: LayoutDashboard, end: true }] },
  {
    title: 'Catálogo',
    items: [
      { to: '/catalogo/productos', label: 'Productos', icon: Gem, can: 'catalog.read' },
      { to: '/catalogo/pendientes', label: 'Pendientes', icon: ClipboardList, can: 'catalog.read' },
      { to: '/catalogo/maestros', label: 'Maestros', icon: ListTree, can: 'catalog.masters' },
    ],
  },
  {
    title: 'Clientes',
    items: [{ to: '/clientes', label: 'Clientes', icon: Contact, can: 'customers.read' }],
  },
  {
    title: 'Inventario',
    items: [
      { to: '/inventario/stock', label: 'Stock por sede', icon: Boxes, can: 'inventory.read' },
      { to: '/inventario/kardex', label: 'Kardex', icon: History, can: 'inventory.read' },
      { to: '/inventario/piezas', label: 'Piezas', icon: ScanBarcode, can: 'inventory.read' },
      { to: '/inventario/transferencias', label: 'Transferencias', icon: ArrowLeftRight, can: 'inventory.transfer' },
      { to: '/inventario/conteos', label: 'Inventario físico', icon: ClipboardCheck, can: 'inventory.count' },
    ],
  },
  {
    title: 'Procesos',
    items: [
      { to: '/procesos/afuera', label: 'Dónde está todo', icon: PackageSearch, can: 'inventory.read' },
      { to: '/procesos/custodia', label: 'Custodia', icon: HandCoins, can: 'ops.custody' },
      { to: '/procesos/taller', label: 'Taller', icon: Hammer, can: 'ops.workshop' },
      { to: '/procesos/consignaciones', label: 'Consignaciones', icon: Store, can: 'ops.consignment' },
      { to: '/procesos/apartados', label: 'Apartados', icon: Wallet, can: 'ops.layaway' },
    ],
  },
  { title: 'Precios', items: [{ to: '/precios', label: 'Listas y cotizaciones', icon: Coins, can: 'pricing.read' }] },
  {
    title: 'Ajustes',
    items: [
      { to: '/ajustes/sedes', label: 'Sedes', icon: MapPin, can: 'core.locations' },
      { to: '/ajustes/usuarios', label: 'Usuarios', icon: Users, can: 'core.users' },
    ],
  },
];

// módulos que vienen, para que se vea el camino (deshabilitados)
const SOON = ['Ventas', 'Compras', 'Caja'];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useSession();
  // un grupo sin ningun item permitido no se dibuja: nada de titulos huerfanos
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((it) => !it.can || can(it.can)) }))
    .filter((g) => g.items.length > 0);

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
        {groups.map((g, i) => (
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
  const navigate = useNavigate();
  const { user, logout, locationId, setLocationId, theme, toggleTheme } = useSession();
  const loc = data?.locations.find((l) => l.id === locationId);
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
          <button className="flex h-8 items-center gap-2 rounded-full border bg-card pl-1 pr-2.5 text-[13px] font-medium shadow-xs transition-colors hover:bg-accent">
            <span className="flex size-6 items-center justify-center rounded-full bg-gold-soft text-[11px] font-semibold text-gold-foreground">
              {user ? user.full_name.slice(0, 1).toUpperCase() : <UserRound className="size-3.5" />}
            </span>
            <span className="max-w-32 truncate">{user?.full_name ?? ''}</span>
          </button>
        </MenuTrigger>
        <MenuContent>
          <MenuLabel>
            {user?.full_name} · {user?.username}
          </MenuLabel>
          <MenuSeparator />
          <MenuItem onSelect={() => navigate('/ajustes/mi-cuenta')}>
            <UserRound />
            <span className="flex-1">Mi cuenta y contraseña</span>
          </MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => void logout()}>
            <LogOut />
            <span className="flex-1">Cerrar sesión</span>
          </MenuItem>
        </MenuContent>
      </Menu>

      <Button variant="ghost" size="icon-sm" onClick={toggleTheme} aria-label="Cambiar tema">
        {theme === 'dark' ? <Sun /> : <Moon />}
      </Button>
    </div>
  );
}

export function AppShell() {
  const { isLoading, error } = useLookups();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

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
            ) : (
              <Outlet />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

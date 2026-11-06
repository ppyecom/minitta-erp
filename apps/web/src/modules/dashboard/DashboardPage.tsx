import type { ComponentType, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Gem,
  PackagePlus,
  ScanBarcode,
  ShieldCheck,
  TrendingDown,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useLookups } from '@/lib/lookups';
import { useSession } from '@/lib/session';
import { cn, money, qty, relative } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, Skeleton } from '@/components/ui/misc';
import { EmptyState, Mono, MovementTypeBadge, PageHeader, Thumb } from '@/components/common';

interface Dashboard {
  kpis: Record<string, number>;
  recent: {
    id: number;
    occurred_at: string;
    sku: string;
    location_code: string;
    type: string;
    quantity: number;
    created_by_username: string;
    product_name: string;
    image_url: string | null;
  }[];
  byLocation: { id: number; code: string; name: string; units: number; skus: number }[];
  metal: { id: number; code: string; name: string; price_per_gram: number; currency_code: string; valid_from: string }[];
}

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  to,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: ComponentType<{ className?: string }>;
  to?: string;
  tone?: 'warning' | 'danger' | 'success';
}) {
  const body = (
    <Card className={cn('group relative p-4 transition-shadow', to && 'hover:shadow-md')}>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        <span
          className={cn(
            'flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground',
            tone === 'warning' && 'bg-warning-soft text-warning',
            tone === 'danger' && 'bg-destructive-soft text-destructive',
            tone === 'success' && 'bg-success-soft text-success',
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>
      <div className="tabular mt-2 text-[26px] font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      {to && (
        <ArrowUpRight className="absolute bottom-3 right-3 size-4 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
      )}
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function DashboardPage() {
  const nav = useNavigate();
  const { userId } = useSession();
  const { data: lk } = useLookups();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard') });
  const user = lk?.users.find((u) => u.id === userId);
  const k = data?.kpis ?? {};
  const maxUnits = Math.max(1, ...(data?.byLocation.map((l) => Number(l.units)) ?? [1]));

  return (
    <>
      <PageHeader
        title={user ? `Hola, ${user.full_name.split(' ')[0]}` : 'Inicio'}
        description="Resumen del catálogo y del inventario en todas las sedes."
        actions={
          <>
            <Button variant="outline" onClick={() => nav('/inventario/conteos')}>
              <ClipboardCheck /> Inventario físico
            </Button>
            <Button variant="gold" onClick={() => nav('/catalogo/productos?nuevo=1')}>
              <PackagePlus /> Nuevo producto
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Productos activos" value={k.products_active} hint={`${k.products_draft} en borrador`} icon={Gem} to="/catalogo/productos" />
          <Kpi label="Variantes (SKU)" value={k.variants_active} hint="vendibles" icon={Boxes} to="/inventario/stock" />
          <Kpi label="Unidades en stock" value={qty(k.units_on_hand, 0)} hint={`${k.movements_today} movimientos hoy`} icon={Boxes} to="/inventario/kardex" />
          <Kpi label="Piezas en vitrina" value={k.serials_in_stock} hint={`${k.serials_workshop} en taller`} icon={ScanBarcode} to="/inventario/piezas" />
          <Kpi
            label="Bajo mínimo"
            value={k.below_min}
            hint="sugerencias de reposición"
            icon={TrendingDown}
            tone={k.below_min ? 'warning' : undefined}
            to="/inventario/stock?bajo=1"
          />
          <Kpi label="En tránsito" value={k.transfers_in_transit} hint="transferencias enviadas" icon={ArrowLeftRight} to="/inventario/transferencias" />
          <Kpi label="Conteos abiertos" value={k.counts_open} hint="inventarios físicos" icon={ClipboardCheck} to="/inventario/conteos" />
          <Kpi
            label="Integridad del stock"
            value={k.integrity_drift === 0 ? 'Cuadrado' : `${k.integrity_drift} descuadres`}
            hint="saldo = suma del kardex"
            icon={k.integrity_drift === 0 ? ShieldCheck : AlertTriangle}
            tone={k.integrity_drift === 0 ? 'success' : 'danger'}
          />
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Últimos movimientos"
            description="Kardex de todas las sedes"
            actions={
              <Button variant="ghost" size="sm" onClick={() => nav('/inventario/kardex')}>
                Ver kardex
              </Button>
            }
          />
          {data?.recent.length ? (
            <ul className="divide-y border-t">
              {data.recent.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-5 py-2.5">
                  <Thumb src={m.image_url} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{m.product_name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      <Mono>{m.sku}</Mono> · {m.location_code} · {m.created_by_username}
                    </div>
                  </div>
                  <MovementTypeBadge type={m.type} quantity={m.quantity} />
                  <span
                    className={cn(
                      'tabular w-14 text-right text-[13px] font-medium',
                      m.quantity > 0 ? 'text-success' : 'text-destructive',
                    )}
                  >
                    {m.quantity > 0 ? '+' : ''}
                    {qty(m.quantity)}
                  </span>
                  <span className="hidden w-24 text-right text-xs text-muted-foreground sm:block">{relative(m.occurred_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="Todavía no hay movimientos"
              description="El stock arranca con un inventario físico por sede, o al dar de alta piezas."
              icon={CheckCircle2}
            />
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Stock por sede" description="Unidades en mano" />
            <div className="space-y-2.5 px-5 pb-5">
              {data?.byLocation.slice(0, 8).map((l) => (
                <div key={l.id}>
                  <div className="mb-1 flex items-center justify-between text-[13px]">
                    <span className="truncate">
                      <Mono className="mr-1.5 text-muted-foreground">{l.code}</Mono>
                      {l.name}
                    </span>
                    <span className="tabular font-medium">{qty(l.units, 0)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-gold" style={{ width: `${(Number(l.units) / maxUnits) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader
              title="Precio del gramo"
              description="Cotización vigente"
              actions={
                <Button variant="ghost" size="sm" onClick={() => nav('/precios?tab=metal')}>
                  Actualizar
                </Button>
              }
            />
            {data?.metal.length ? (
              <ul className="divide-y border-t">
                {data.metal.map((m) => (
                  <li key={m.id} className="flex items-center justify-between px-5 py-2 text-[13px]">
                    <span>{m.name}</span>
                    <span className="tabular font-medium">{money(m.price_per_gram, m.currency_code)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 pb-5 text-[13px] text-muted-foreground">
                Sin cotizaciones cargadas. Los precios por peso las necesitan.
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

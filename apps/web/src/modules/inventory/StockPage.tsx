import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, Boxes, SlidersHorizontal, TrendingDown } from 'lucide-react';
import { type Page } from '@minitta/shared';
import { api, qs } from '@/lib/api';
import { useLookups } from '@/lib/lookups';
import { useSave } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { cn, qty, relative } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, Card, Segmented } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/overlay';
import { DataTable, EmptyState, Mono, PageHeader, Pagination, SearchInput, Thumb } from '@/components/common';
import { MovementDialog } from './MovementDialog';

interface StockRow {
  variant_id: number;
  sku: string;
  product_id: number;
  product_name: string;
  legacy_code: string | null;
  tracking_mode: string;
  image_url: string | null;
  size_label: string | null;
  location_id: number;
  location_code: string;
  location_name: string;
  on_hand: number;
  reserved: number;
  in_transit: number;
  available: number;
  min_quantity: number;
  below_min: boolean;
  last_movement_at: string | null;
  last_counted_at: string | null;
}

function LimitsDialog({ row, onClose }: { row: StockRow | null; onClose: () => void }) {
  const [v, setV] = useState({ min_quantity: '', max_quantity: '' });
  useEffect(() => {
    if (row) setV({ min_quantity: String(row.min_quantity), max_quantity: '' });
  }, [row]);
  const save = useSave(
    () => api.put(`/stock/${row!.variant_id}/${row!.location_id}/limits`, { min_quantity: v.min_quantity || 0, max_quantity: v.max_quantity }),
    { success: 'Mínimo actualizado', invalidate: [['stock'], ['dashboard']], onSuccess: onClose },
  );
  return (
    <Dialog
      open={!!row}
      onOpenChange={(o) => !o && onClose()}
      title="Stock mínimo y máximo"
      description={row && `${row.sku} en ${row.location_code}. Por sede: el sistema viejo tenía uno solo, siempre 1.`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Mínimo" error={save.fields.min_quantity}>
          <Input autoFocus value={v.min_quantity} onChange={(e) => setV({ ...v, min_quantity: e.target.value })} inputMode="decimal" />
        </Field>
        <Field label="Máximo" hint="Opcional" error={save.fields.max_quantity}>
          <Input value={v.max_quantity} onChange={(e) => setV({ ...v, max_quantity: e.target.value })} inputMode="decimal" />
        </Field>
      </div>
    </Dialog>
  );
}

export function StockPage() {
  const { data: lk } = useLookups();
  const { locationId } = useSession();
  const [sp, setSp] = useSearchParams();
  const [moving, setMoving] = useState(false);
  const [limits, setLimits] = useState<StockRow | null>(null);
  const f = {
    q: sp.get('q') ?? '',
    location_id: sp.get('sede') ?? (locationId ? String(locationId) : ''),
    view: sp.get('bajo') === '1' ? 'below' : sp.get('todo') === '1' ? 'all' : 'stock',
    page: Number(sp.get('page') ?? 1),
  };
  const setF = (patch: Record<string, string | number>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v === 1) n.delete(k);
      else n.set(k, String(v));
    }
    if (!('page' in patch)) n.delete('page');
    setSp(n, { replace: true });
  };

  const { data, isFetching } = useQuery({
    queryKey: ['stock', f],
    queryFn: () =>
      api.get<Page<StockRow> & { units: number }>(
        `/stock${qs({ q: f.q, location_id: f.location_id, below_min: f.view === 'below', with_stock: f.view === 'all' ? 'false' : '', page: f.page })}`,
      ),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Stock por sede"
        description="Saldo calculado del kardex: nunca se escribe a mano. Para cambiarlo, registre un movimiento."
        actions={
          <Button onClick={() => setMoving(true)}>
            <ArrowRightLeft /> Registrar movimiento
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <SearchInput value={f.q} onChange={(q) => setF({ q })} placeholder="SKU, producto o código viejo" />
          <Select className="w-56" value={f.location_id} onChange={(e) => setF({ sede: e.target.value })}>
            <option value="">Todas las sedes</option>
            {lk?.locations
              .filter((l) => l.is_active && l.holds_stock)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
          </Select>
          <Segmented
            value={f.view}
            onChange={(v) => setF({ bajo: v === 'below' ? '1' : '', todo: v === 'all' ? '1' : '' })}
            options={[
              { value: 'stock', label: 'Con stock' },
              { value: 'below', label: 'Bajo mínimo' },
              { value: 'all', label: 'Todo' },
            ]}
          />
          {data && (
            <span className="ml-auto text-[13px] text-muted-foreground">
              <span className="tabular font-medium text-foreground">{qty(data.units, 0)}</span> unidades
            </span>
          )}
        </div>
        <DataTable
          rows={data?.items}
          loading={isFetching}
          rowKey={(r) => `${r.variant_id}-${r.location_id}`}
          columns={[
            {
              key: 'p',
              header: 'Producto',
              cell: (r) => (
                <Link to={`/catalogo/productos/${r.product_id}`} className="flex items-center gap-3 hover:underline">
                  <Thumb src={r.image_url} size={34} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.product_name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      <Mono>{r.sku}</Mono>
                      {r.legacy_code && ` · ${r.legacy_code}`}
                    </div>
                  </div>
                </Link>
              ),
            },
            { key: 'loc', header: 'Sede', cell: (r) => <Mono>{r.location_code}</Mono> },
            {
              key: 'oh',
              header: 'En mano',
              align: 'right',
              cell: (r) => (
                <span className={cn('tabular font-semibold', r.on_hand < 0 && 'text-destructive')}>
                  {qty(r.on_hand)}
                  {r.tracking_mode === 'serial' && <Badge tone="gold" className="ml-1.5">pzs</Badge>}
                </span>
              ),
            },
            { key: 'res', header: 'Apartado', align: 'right', cell: (r) => <span className="tabular text-muted-foreground">{r.reserved ? qty(r.reserved) : '—'}</span>, className: 'hidden md:table-cell' },
            { key: 'tr', header: 'Tránsito', align: 'right', cell: (r) => <span className="tabular text-muted-foreground">{r.in_transit ? qty(r.in_transit) : '—'}</span>, className: 'hidden md:table-cell' },
            { key: 'av', header: 'Disponible', align: 'right', cell: (r) => <span className="tabular">{qty(r.available)}</span> },
            {
              key: 'min',
              header: 'Mínimo',
              align: 'right',
              cell: (r) => (
                <button
                  onClick={() => setLimits(r)}
                  className={cn(
                    'tabular inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent',
                    r.below_min ? 'font-semibold text-warning' : 'text-muted-foreground',
                  )}
                >
                  {r.below_min && <TrendingDown className="size-3.5" />}
                  {qty(r.min_quantity)}
                  <SlidersHorizontal className="size-3 opacity-40" />
                </button>
              ),
            },
            { key: 'last', header: 'Últ. mov.', cell: (r) => <span className="text-xs text-muted-foreground">{relative(r.last_movement_at)}</span>, className: 'hidden lg:table-cell' },
            {
              key: 'k',
              header: '',
              align: 'right',
              cell: (r) => (
                <Link to={`/inventario/kardex?variant=${r.variant_id}&sede=${r.location_id}`} className="text-xs text-muted-foreground hover:text-foreground">
                  Kardex
                </Link>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon={Boxes}
              title={f.view === 'below' ? 'Nada bajo el mínimo' : 'Sin stock para mostrar'}
              description="El stock arranca con el inventario físico de apertura de cada sede."
              action={
                <Button variant="outline" onClick={() => setMoving(true)}>
                  Registrar movimiento
                </Button>
              }
            />
          }
        />
        {data && data.total > 0 && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setF({ page })} />}
      </Card>
      <MovementDialog open={moving} onOpenChange={setMoving} />
      <LimitsDialog row={limits} onClose={() => setLimits(null)} />
    </>
  );
}

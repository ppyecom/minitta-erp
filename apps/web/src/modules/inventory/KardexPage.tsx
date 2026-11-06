import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, History, X } from 'lucide-react';
import { MovementType, type Page } from '@minitta/shared';
import { api, qs } from '@/lib/api';
import { useLookups } from '@/lib/lookups';
import { cn, dateTime, money, qty } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Badge, Card } from '@/components/ui/misc';
import { DataTable, EmptyState, Mono, MovementTypeBadge, PageHeader, Pagination, Thumb } from '@/components/common';
import { VariantPicker, type VariantHit } from '@/components/variant-picker';
import { MovementDialog } from './MovementDialog';

// documento que originó el movimiento (movement.doc_type)
const DOC_LABEL: Record<string, string> = {
  transfer: 'transferencia',
  count: 'conteo',
  serial: 'alta de pieza',
  sale: 'venta',
  purchase: 'compra',
};

interface KardexRow {
  id: number;
  occurred_at: string;
  variant_id: number;
  sku: string;
  legacy_code: string | null;
  product_id: number;
  product_name: string;
  image_url: string | null;
  location_code: string;
  location_name: string;
  type: string;
  reason_code: string | null;
  reason_name: string | null;
  quantity: number;
  running_balance: number;
  unit_cost: number | null;
  currency_code: string | null;
  doc_type: string | null;
  doc_id: number | null;
  serial_code: string | null;
  created_by_username: string;
  notes: string | null;
}

export function KardexPage() {
  const { data: lk } = useLookups();
  const [sp, setSp] = useSearchParams();
  const [moving, setMoving] = useState(false);
  const [variant, setVariant] = useState<VariantHit | null>(null);
  const f = {
    variant_id: sp.get('variant') ?? '',
    location_id: sp.get('sede') ?? '',
    type: sp.get('tipo') ?? '',
    from: sp.get('desde') ?? '',
    to: sp.get('hasta') ?? '',
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
    queryKey: ['kardex', f],
    queryFn: () =>
      api.get<Page<KardexRow>>(`/kardex${qs({ variant_id: f.variant_id, location_id: f.location_id, type: f.type, from: f.from, to: f.to, page: f.page })}`),
    placeholderData: keepPreviousData,
  });
  const single = f.variant_id && f.location_id;
  const first = data?.items[0];

  return (
    <>
      <PageHeader
        title="Kardex"
        description="Cada entrada y salida con su autor y su saldo corrido. Es de solo lectura: un error se corrige con un ajuste."
        actions={
          <Button onClick={() => setMoving(true)}>
            <ArrowRightLeft /> Registrar movimiento
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <div className="w-full sm:w-80">
            {f.variant_id && !variant && first ? (
              <div className="flex h-9 items-center gap-2 rounded-md border bg-card px-2.5 text-sm">
                <Mono className="flex-1 truncate">{first.sku}</Mono>
                <button onClick={() => setF({ variant: '' })}>
                  <X className="size-4 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <VariantPicker
                value={variant}
                onChange={(v) => {
                  setVariant(v);
                  setF({ variant: v ? v.variant_id : '' });
                }}
                placeholder="Todas las variantes"
              />
            )}
          </div>
          <Select className="w-48" value={f.location_id} onChange={(e) => setF({ sede: e.target.value })}>
            <option value="">Todas las sedes</option>
            {lk?.locations
              .filter((l) => l.holds_stock)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
          </Select>
          <Select className="w-48" value={f.type} onChange={(e) => setF({ tipo: e.target.value })}>
            <option value="">Todo tipo</option>
            {MovementType.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Input type="date" className="w-40" value={f.from} onChange={(e) => setF({ desde: e.target.value })} title="Desde" />
          <Input type="date" className="w-40" value={f.to} onChange={(e) => setF({ hasta: e.target.value })} title="Hasta" />
          {(f.variant_id || f.location_id || f.type || f.from || f.to) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setVariant(null);
                setSp(new URLSearchParams(), { replace: true });
              }}
            >
              Limpiar
            </Button>
          )}
        </div>
        {!single && (
          <div className="border-b bg-muted/30 px-5 py-2 text-xs text-muted-foreground">
            El saldo corrido es por variante y sede. Filtre ambas para leer el kardex de un artículo.
          </div>
        )}
        <DataTable
          rows={data?.items}
          loading={isFetching}
          rowKey={(r) => r.id}
          dense
          columns={[
            { key: 'd', header: 'Fecha', cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{dateTime(r.occurred_at)}</span> },
            {
              key: 'p',
              header: 'Artículo',
              cell: (r) => (
                <Link to={`/catalogo/productos/${r.product_id}`} className="flex items-center gap-2.5 hover:underline">
                  <Thumb src={r.image_url} size={28} />
                  <span className="min-w-0">
                    <span className="block max-w-56 truncate">{r.product_name}</span>
                    <Mono className="text-muted-foreground">{r.sku}</Mono>
                  </span>
                </Link>
              ),
            },
            { key: 'l', header: 'Sede', cell: (r) => <Mono>{r.location_code}</Mono> },
            {
              key: 't',
              header: 'Movimiento',
              cell: (r) => (
                <div className="flex flex-col items-start gap-0.5">
                  <MovementTypeBadge type={r.type} quantity={r.quantity} />
                  {(r.reason_name || r.serial_code || r.doc_type) && (
                    <span className="text-[11px] text-muted-foreground">
                      {[r.reason_name, r.serial_code && `pieza ${r.serial_code}`, r.doc_type && r.doc_type !== 'manual' && `${DOC_LABEL[r.doc_type] ?? r.doc_type} #${r.doc_id}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: 'q',
              header: 'Cantidad',
              align: 'right',
              cell: (r) => (
                <span className={cn('tabular font-semibold', r.quantity > 0 ? 'text-success' : 'text-destructive')}>
                  {r.quantity > 0 ? '+' : ''}
                  {qty(r.quantity)}
                </span>
              ),
            },
            { key: 'b', header: 'Saldo', align: 'right', cell: (r) => <span className="tabular font-medium">{qty(r.running_balance)}</span> },
            { key: 'c', header: 'Costo', align: 'right', cell: (r) => <span className="tabular text-muted-foreground">{r.unit_cost != null ? money(r.unit_cost, r.currency_code ?? 'PEN') : '—'}</span>, className: 'hidden lg:table-cell' },
            {
              key: 'u',
              header: 'Usuario',
              cell: (r) => (
                <div className="max-w-40">
                  <span className="text-[12.5px]">{r.created_by_username}</span>
                  {r.notes && <div className="truncate text-[11px] text-muted-foreground" title={r.notes}>{r.notes}</div>}
                </div>
              ),
              className: 'hidden md:table-cell',
            },
          ]}
          empty={<EmptyState icon={History} title="Sin movimientos" description="Con estos filtros no hay movimientos en el kardex." />}
        />
        {data && data.total > 0 && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setF({ page })} />}
      </Card>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Badge tone="success">+</Badge> entra · <Badge tone="danger">−</Badge> sale · los movimientos de transferencias y conteos los generan sus pantallas.
      </p>
      <MovementDialog open={moving} onOpenChange={setMoving} />
    </>
  );
}

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Coins, DollarSign, ListOrdered, Pencil, Plus, RefreshCw, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { PriceMode, type Page } from '@minitta/shared';
import { api, qs } from '@/lib/api';
import { useLookups, type PriceList } from '@/lib/lookups';
import { useSave } from '@/lib/forms';
import { cn, date, dateTime, grams, money, today } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Badge, Card, CardHeader, Segmented, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/overlay';
import { Confirm, DataTable, EmptyState, Mono, PageHeader, Pagination, SearchInput, Thumb } from '@/components/common';

interface ListRow extends PriceList {
  prices: number;
  calculated: number;
  location_ids: number[];
}

function ListDialog({ list, onClose }: { list: ListRow | null; onClose: () => void }) {
  const { data: lk } = useLookups();
  const [v, setV] = useState({ name: '', default_margin_pct: '', rounding_step: '', is_active: true, location_ids: [] as number[] });
  useEffect(() => {
    if (list)
      setV({
        name: list.name,
        default_margin_pct: list.default_margin_pct != null ? String(list.default_margin_pct) : '',
        rounding_step: String(list.rounding_step),
        is_active: list.is_active,
        location_ids: list.location_ids,
      });
  }, [list]);
  const save = useSave(() => api.put(`/pricing/lists/${list!.id}`, v), {
    success: 'Lista actualizada',
    invalidate: [['price-lists'], ['lookups']],
    onSuccess: onClose,
  });
  return (
    <Dialog
      open={!!list}
      onOpenChange={(o) => !o && onClose()}
      title={`Lista ${list?.name ?? ''}`}
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" className="sm:col-span-2" error={save.fields.name}>
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="Margen por defecto" hint="Para precios por peso o por margen">
          <Input value={v.default_margin_pct} onChange={(e) => setV({ ...v, default_margin_pct: e.target.value })} inputMode="decimal" suffix="%" />
        </Field>
        <Field label="Redondeo" hint="0.10 → 236.10 · 1 → 236">
          <Input value={v.rounding_step} onChange={(e) => setV({ ...v, rounding_step: e.target.value })} inputMode="decimal" />
        </Field>
        <Field label="Solo en estas sedes" hint="Ninguna marcada = vale en todas" className="sm:col-span-2">
          <div className="grid max-h-48 grid-cols-2 gap-1.5 overflow-y-auto rounded-md border p-2">
            {lk?.locations
              .filter((l) => l.is_active && l.sells)
              .map((l) => (
                <Checkbox
                  key={l.id}
                  checked={v.location_ids.includes(l.id)}
                  onCheckedChange={(x) => setV({ ...v, location_ids: x ? [...v.location_ids, l.id] : v.location_ids.filter((i) => i !== l.id) })}
                  label={`${l.code} · ${l.name}`}
                />
              ))}
          </div>
        </Field>
        <Checkbox checked={v.is_active} onCheckedChange={(x) => setV({ ...v, is_active: x })} label="Lista activa" />
      </div>
    </Dialog>
  );
}

function ListsTab() {
  const [editing, setEditing] = useState<ListRow | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('');
  const [page, setPage] = useState(1);
  const { data: lists } = useQuery({ queryKey: ['price-lists'], queryFn: () => api.get<ListRow[]>('/pricing/lists') });
  const current = selected ?? lists?.[0]?.id ?? null;
  const prices = useQuery({
    queryKey: ['list-prices', current, q, mode, page],
    queryFn: () =>
      api.get<Page<{ id: number; variant_id: number; product_id: number; sku: string; product_name: string; legacy_code: string | null; image_url: string | null; mode: string; amount: number; effective: number | null; weight_g: number | null; margin_pct: number | null; valid_from: string }>>(
        `/pricing/lists/${current}/prices${qs({ q, mode, page })}`,
      ),
    enabled: !!current,
    placeholderData: keepPreviousData,
  });
  const cur = lists?.find((l) => l.id === current);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {lists?.map((l) => (
          <button
            key={l.id}
            onClick={() => {
              setSelected(l.id);
              setPage(1);
            }}
            className={cn(
              'group rounded-xl border bg-card p-4 text-left shadow-xs transition-all hover:shadow-md',
              current === l.id && 'border-gold ring-2 ring-gold/20',
            )}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold">{l.name}</div>
                <Mono className="text-muted-foreground">{l.code}</Mono>
              </div>
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(l);
                }}
                className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
              >
                <Pencil className="size-3.5" />
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone="outline">{l.prices} precios</Badge>
              {l.default_margin_pct != null && <Badge tone="gold">margen {l.default_margin_pct}%</Badge>}
              {l.location_ids.length > 0 && <Badge tone="info">{l.location_ids.length} sedes</Badge>}
              {!l.is_active && <Badge>inactiva</Badge>}
            </div>
          </button>
        ))}
      </div>
      <Card>
        <CardHeader title={`Precios vigentes · ${cur?.name ?? ''}`} description="Se editan desde cada producto. El efectivo sale de pricing.resolve_price()." />
        <div className="flex flex-wrap items-center gap-2 border-y px-4 py-3">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="SKU, producto o código viejo"
          />
          <Segmented
            value={mode}
            onChange={(v) => {
              setMode(v);
              setPage(1);
            }}
            options={[{ value: '', label: 'Todos' }, ...PriceMode.options]}
          />
        </div>
        <DataTable
          rows={prices.data?.items}
          loading={prices.isFetching}
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'p',
              header: 'Artículo',
              cell: (r) => (
                <Link to={`/catalogo/productos/${r.product_id}`} className="flex items-center gap-2.5 hover:underline">
                  <Thumb src={r.image_url} size={30} />
                  <div>
                    <div className="max-w-72 truncate">{r.product_name}</div>
                    <Mono className="text-muted-foreground">{r.sku}</Mono>
                  </div>
                </Link>
              ),
            },
            { key: 'm', header: 'Modo', cell: (r) => <Badge tone={r.mode === 'manual' ? 'neutral' : 'gold'}>{PriceMode.label(r.mode as never)}</Badge> },
            { key: 'w', header: 'Peso', align: 'right', cell: (r) => <span className="tabular text-muted-foreground">{grams(r.weight_g)}</span>, className: 'hidden md:table-cell' },
            { key: 'a', header: 'Guardado', align: 'right', cell: (r) => <span className="tabular text-muted-foreground">{money(r.amount)}</span>, className: 'hidden md:table-cell' },
            { key: 'e', header: 'Efectivo hoy', align: 'right', cell: (r) => <span className="tabular font-semibold">{money(r.effective ?? r.amount, cur?.currency_code)}</span> },
            { key: 'f', header: 'Desde', cell: (r) => <span className="text-xs text-muted-foreground">{dateTime(r.valid_from)}</span>, className: 'hidden lg:table-cell' },
          ]}
          empty={<EmptyState icon={Coins} title="Esta lista no tiene precios" description="Los precios se cargan desde el detalle de cada producto, por variante." />}
        />
        {prices.data && prices.data.total > 0 && <Pagination page={prices.data.page} pageSize={prices.data.pageSize} total={prices.data.total} onPage={setPage} />}
      </Card>
      <ListDialog list={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function MetalTab() {
  const { data: lk } = useLookups();
  const [v, setV] = useState({ material_id: '', price_per_gram: '', currency_code: 'PEN', valid_from: today(), source: 'manual' });
  const [refresh, setRefresh] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['metal-rates'],
    queryFn: () => api.get<{ id: number; material_name: string; material_code: string; price_per_gram: number; currency_code: string; valid_from: string; source: string | null; created_by_name: string | null; is_current: boolean }[]>('/pricing/metal-rates'),
  });
  const add = useSave(() => api.post('/pricing/metal-rates', v), {
    success: 'Cotización registrada',
    invalidate: [['metal-rates'], ['dashboard']],
    onSuccess: () => {
      setV((p) => ({ ...p, price_per_gram: '' }));
      setRefresh(true);
    },
  });
  const recalc = useSave(() => api.post<{ updated: number }>('/pricing/refresh', {}), {
    invalidate: [['list-prices'], ['product'], ['products']],
    onSuccess: (r) => {
      setRefresh(false);
      toast.success(`${r.updated} precio(s) recalculados`);
    },
  });
  const weightMaterials = lk?.materials.filter((m) => m.is_priced_by_weight) ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="h-fit p-5">
        <h3 className="mb-1 text-[15px] font-semibold">Nueva cotización</h3>
        <p className="mb-4 text-[13px] text-muted-foreground">Precio del gramo por material y fecha. Antes era una columna suelta que se sobrescribía.</p>
        <div className="space-y-3">
          <Field label="Material" required error={add.fields.material_id}>
            <Select value={v.material_id} onChange={(e) => setV({ ...v, material_id: e.target.value })}>
              <option value="">Elegir…</option>
              {weightMaterials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <Field label="Precio por gramo" required error={add.fields.price_per_gram}>
              <Input value={v.price_per_gram} onChange={(e) => setV({ ...v, price_per_gram: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="Moneda">
              <Select value={v.currency_code} onChange={(e) => setV({ ...v, currency_code: e.target.value })}>
                {lk?.currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Vigente desde" required error={add.fields.valid_from}>
            <Input type="date" value={v.valid_from} onChange={(e) => setV({ ...v, valid_from: e.target.value })} />
          </Field>
          <Field label="Fuente">
            <Select value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })}>
              <option value="manual">Manual</option>
              <option value="proveedor">Proveedor</option>
              <option value="bolsa">Bolsa</option>
            </Select>
          </Field>
          <Button className="w-full" loading={add.isPending} onClick={() => add.mutate(undefined)}>
            <Plus /> Registrar
          </Button>
        </div>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader
          title="Historial de cotizaciones"
          actions={
            <Button variant="outline" size="sm" onClick={() => setRefresh(true)}>
              <RefreshCw /> Recalcular precios
            </Button>
          }
        />
        <DataTable
          rows={data}
          loading={isLoading}
          rowKey={(r) => r.id}
          columns={[
            { key: 'm', header: 'Material', cell: (r) => <span className="font-medium">{r.material_name}</span> },
            { key: 'p', header: 'Por gramo', align: 'right', cell: (r) => <span className="tabular font-semibold">{money(r.price_per_gram, r.currency_code)}</span> },
            { key: 'f', header: 'Desde', cell: (r) => date(r.valid_from) },
            { key: 's', header: 'Fuente', cell: (r) => <span className="text-muted-foreground">{r.source ?? '—'}</span>, className: 'hidden md:table-cell' },
            { key: 'u', header: 'Registró', cell: (r) => <span className="text-muted-foreground">{r.created_by_name ?? '—'}</span>, className: 'hidden md:table-cell' },
            { key: 'c', header: '', cell: (r) => (r.is_current ? <Badge tone="success" dot>Vigente</Badge> : null) },
          ]}
          empty={<EmptyState icon={Scale} title="Sin cotizaciones" description="Registre el precio del gramo de oro y plata para habilitar los precios por peso." />}
        />
      </Card>
      <Confirm
        open={refresh}
        onOpenChange={setRefresh}
        title="¿Recalcular los precios por peso y por margen?"
        description="Actualiza el monto guardado de todos los precios calculados con la cotización vigente. Los precios manuales no se tocan."
        confirmLabel="Recalcular"
        loading={recalc.isPending}
        onConfirm={() => recalc.mutate(undefined)}
      />
    </div>
  );
}

function ExchangeTab() {
  const [v, setV] = useState({ currency_code: 'USD', rate_date: today(), buy: '', sell: '', source: 'SUNAT' });
  const { data, isLoading } = useQuery({
    queryKey: ['exchange-rates'],
    queryFn: () => api.get<{ currency_code: string; rate_date: string; buy: number; sell: number; source: string | null }[]>('/pricing/exchange-rates'),
  });
  const add = useSave(() => api.post('/pricing/exchange-rates', v), { success: 'Tipo de cambio registrado', invalidate: [['exchange-rates']] });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="h-fit p-5">
        <h3 className="mb-4 text-[15px] font-semibold">Tipo de cambio del día</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Moneda">
              <Select value={v.currency_code} onChange={(e) => setV({ ...v, currency_code: e.target.value })}>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </Select>
            </Field>
            <Field label="Fecha">
              <Input type="date" value={v.rate_date} onChange={(e) => setV({ ...v, rate_date: e.target.value })} />
            </Field>
            <Field label="Compra" error={add.fields.buy}>
              <Input value={v.buy} onChange={(e) => setV({ ...v, buy: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="Venta" error={add.fields.sell}>
              <Input value={v.sell} onChange={(e) => setV({ ...v, sell: e.target.value })} inputMode="decimal" />
            </Field>
          </div>
          <Field label="Fuente">
            <Select value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })}>
              <option>SUNAT</option>
              <option>SBS</option>
              <option>manual</option>
            </Select>
          </Field>
          <Button className="w-full" loading={add.isPending} onClick={() => add.mutate(undefined)}>
            <Plus /> Registrar
          </Button>
        </div>
      </Card>
      <Card className="lg:col-span-2">
        <DataTable
          rows={data}
          loading={isLoading}
          rowKey={(r) => `${r.currency_code}-${r.rate_date}`}
          columns={[
            { key: 'd', header: 'Fecha', cell: (r) => date(r.rate_date) },
            { key: 'c', header: 'Moneda', cell: (r) => <Mono>{r.currency_code}</Mono> },
            { key: 'b', header: 'Compra', align: 'right', cell: (r) => <span className="tabular">{Number(r.buy).toFixed(3)}</span> },
            { key: 's', header: 'Venta', align: 'right', cell: (r) => <span className="tabular font-medium">{Number(r.sell).toFixed(3)}</span> },
            { key: 'f', header: 'Fuente', cell: (r) => <span className="text-muted-foreground">{r.source}</span> },
          ]}
          empty={<EmptyState icon={DollarSign} title="Sin tipos de cambio" description="Se usan para convertir costos de piedras en dólares." />}
        />
      </Card>
    </div>
  );
}

export function PricingPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'listas';
  return (
    <>
      <PageHeader title="Precios" description="Listas de precio, precio del gramo y tipo de cambio. Los precios nunca se sobrescriben: quedan con historia." />
      <Tabs value={tab} onValueChange={(t) => setSp({ tab: t }, { replace: true })}>
        <TabsList className="mb-5">
          <TabsTrigger value="listas">
            <ListOrdered /> Listas de precio
          </TabsTrigger>
          <TabsTrigger value="metal">
            <Scale /> Precio del gramo
          </TabsTrigger>
          <TabsTrigger value="cambio">
            <DollarSign /> Tipo de cambio
          </TabsTrigger>
        </TabsList>
        <TabsContent value="listas">
          <ListsTab />
        </TabsContent>
        <TabsContent value="metal">
          <MetalTab />
        </TabsContent>
        <TabsContent value="cambio">
          <ExchangeTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

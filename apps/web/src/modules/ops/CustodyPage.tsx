import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { HandCoins, Plus } from 'lucide-react';
import { CustodyStatus, type Page } from '@minitta/shared';
import { api, qs } from '@/lib/api';
import { useLookups } from '@/lib/lookups';
import { CustomerPicker } from '@/modules/customers/CustomerPicker';
import { useSave } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { date, grams } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, Segmented } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/overlay';
import { DataTable, EmptyState, Mono, PageHeader, Pagination, SearchInput } from '@/components/common';

export interface CustodyRow {
  id: number;
  code: string;
  status: string;
  customer_id: number;
  customer_code: string;
  customer_name: string;
  customer_phone: string | null;
  description: string;
  requested_service: string;
  received_weight_g: number;
  received_at: string;
  promised_on: string | null;
  location_code: string;
  location_name: string;
  is_overdue: boolean;
  open_work_order: string | null;
}

export function CustodyStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'delivered'
      ? 'success'
      : status === 'in_workshop'
        ? 'info'
        : status === 'ready'
          ? 'gold'
          : status === 'abandoned'
            ? 'danger'
            : 'neutral';
  return <Badge tone={tone as never}>{CustodyStatus.label(status as never)}</Badge>;
}

const EMPTY = {
  customer_id: null as number | null,
  description: '',
  requested_service: '',
  material_id: '',
  received_weight_g: '',
  stone_notes: '',
  condition_notes: '',
  location_id: '',
  promised_on: '',
  notes: '',
};

/** Recepción: el peso de entrada es obligatorio, es la prueba de lo que recibimos. */
function ReceiveSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const nav = useNavigate();
  const { data: lk } = useLookups();
  const { locationId } = useSession();
  const [f, setF] = useState(EMPTY);
  useEffect(() => {
    if (open) setF({ ...EMPTY, location_id: locationId ? String(locationId) : '' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useSave(() => api.post<{ id: number }>('/ops/custody', f), {
    success: 'Pieza recibida en custodia',
    invalidate: [['custody'], ['pieces-out']],
    onSuccess: (r) => {
      onOpenChange(false);
      nav(`/procesos/custodia/${r.id}`);
    },
  });

  const set =
    (k: keyof typeof EMPTY) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF((p) => ({ ...p, [k]: e.target.value }));

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width="max-w-xl"
      title="Recibir pieza de un cliente"
      description="No entra al inventario: queda en custodia y toda su historia se registra con el peso."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Recibir
          </Button>
        </>
      }
    >
      <Field
        label="Cliente"
        required
        error={save.fields.customer_id}
        hint="Si ya dejó algo antes, va a aparecer con su historia. Si no está, se crea acá."
      >
        <CustomerPicker
          value={f.customer_id}
          onChange={(id) => setF((p) => ({ ...p, customer_id: id }))}
          autoFocus
        />
      </Field>

      <div className="mt-5 grid gap-4">
        <Field label="Qué es la pieza" required error={save.fields.description}>
          <Input value={f.description} onChange={set('description')} placeholder="Anillo de compromiso, oro amarillo" />
        </Field>
        <Field label="Qué pidió el cliente" required error={save.fields.requested_service}>
          <Input value={f.requested_service} onChange={set('requested_service')} placeholder="Soldar aro y ajustar engaste" />
        </Field>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Peso al recibirla (g)" required error={save.fields.received_weight_g} hint="Pesar delante del cliente">
          <Input value={f.received_weight_g} onChange={set('received_weight_g')} inputMode="decimal" />
        </Field>
        <Field label="Material">
          <Select value={f.material_id} onChange={set('material_id')}>
            <option value="">Sin determinar</option>
            {lk?.materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Piedras que trae" className="sm:col-span-2">
          <Input value={f.stone_notes} onChange={set('stone_notes')} placeholder="1 brillante central, 2 laterales" />
        </Field>
        <Field label="En qué estado llegó" className="sm:col-span-2">
          <Textarea value={f.condition_notes} onChange={set('condition_notes')} rows={2} placeholder="Aro abierto, piedra floja" />
        </Field>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Sede" required error={save.fields.location_id}>
          <Select value={f.location_id} onChange={set('location_id')}>
            <option value="">Elegir…</option>
            {lk?.locations
              .filter((l) => l.is_active)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Se entrega el">
          <Input type="date" value={f.promised_on} onChange={set('promised_on')} />
        </Field>
      </div>
    </Sheet>
  );
}

export function CustodyPage() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const status = sp.get('estado') ?? '';
  const q = sp.get('q') ?? '';
  const page = Number(sp.get('page') ?? 1);

  const { data, isFetching } = useQuery({
    queryKey: ['custody', status, q, page],
    queryFn: () => api.get<Page<CustodyRow>>(`/ops/custody${qs({ status, q, page })}`),
    placeholderData: keepPreviousData,
  });

  const upd = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    n.delete('page');
    setSp(n, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Custodia"
        description="Piezas de clientes bajo nuestra responsabilidad. No son inventario y nunca mueven stock."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Recibir pieza
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <Segmented
            value={status}
            onChange={(v) => upd('estado', v)}
            options={[{ value: '', label: 'Todas' }, ...CustodyStatus.options]}
          />
          <SearchInput className="w-64" value={q} onChange={(v) => upd('q', v)} placeholder="Cliente, código, descripción…" />
        </div>
        <DataTable
          rows={data?.items}
          loading={isFetching}
          rowKey={(r) => r.id}
          onRowClick={(r) => nav(`/procesos/custodia/${r.id}`)}
          columns={[
            { key: 'c', header: 'Código', cell: (r) => <Mono className="font-medium">{r.code}</Mono> },
            {
              key: 'cl',
              header: 'Cliente',
              cell: (r) => (
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{r.customer_name}</div>
                  <div className="truncate text-xs text-muted-foreground">{r.description}</div>
                </div>
              ),
            },
            { key: 's', header: 'Servicio', cell: (r) => <span className="text-[13px]">{r.requested_service}</span>, className: 'hidden lg:table-cell' },
            { key: 'w', header: 'Peso', align: 'right', cell: (r) => <span className="tabular">{grams(r.received_weight_g)}</span> },
            { key: 'l', header: 'Sede', cell: (r) => <Mono>{r.location_code}</Mono>, className: 'hidden md:table-cell' },
            {
              key: 'p',
              header: 'Se entrega',
              cell: (r) =>
                r.promised_on ? (
                  <Badge tone={r.is_overdue ? 'danger' : 'neutral'}>{date(r.promised_on)}</Badge>
                ) : (
                  <span className="text-muted-foreground">sin plazo</span>
                ),
            },
            { key: 'e', header: 'Estado', cell: (r) => <CustodyStatusBadge status={r.status} /> },
          ]}
          empty={
            <EmptyState
              icon={HandCoins}
              title="Sin piezas en custodia"
              description="Cuando un cliente deja una joya para reparar, se recibe acá."
              action={
                <Button onClick={() => setCreating(true)}>
                  <Plus /> Recibir pieza
                </Button>
              }
            />
          }
        />
        {data && data.total > 0 && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => upd('page', String(p))} />
        )}
      </Card>
      <ReceiveSheet open={creating} onOpenChange={setCreating} />
    </>
  );
}

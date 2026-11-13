import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Hammer, Plus } from 'lucide-react';
import { WorkOrderKind, WorkOrderStatus, type Page } from '@minitta/shared';
import { api, qs } from '@/lib/api';
import { useLookups } from '@/lib/lookups';
import { useSave } from '@/lib/forms';
import { date, grams } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, Segmented } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/overlay';
import { DataTable, EmptyState, Mono, PageHeader, Pagination } from '@/components/common';

export interface WorkOrderRow {
  id: number;
  code: string;
  kind: string;
  status: string;
  location_code: string;
  location_name: string;
  assigned_user_name: string | null;
  assigned_supplier_name: string | null;
  custody_code: string | null;
  customer_name: string | null;
  promised_on: string | null;
  opened_at: string;
  input_g: number;
  output_g: number;
  loss_g: number;
  diff_g: number;
  loss_pct: number | null;
  max_loss_pct: number | null;
  balanced: boolean;
  is_overdue: boolean;
}

export function WorkOrderStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'closed'
      ? 'success'
      : status === 'in_progress'
        ? 'info'
        : status === 'finished'
          ? 'gold'
          : status === 'cancelled'
            ? 'danger'
            : 'neutral';
  return <Badge tone={tone as never}>{WorkOrderStatus.label(status as never)}</Badge>;
}

const EMPTY = {
  kind: 'repair',
  location_id: '',
  custody_item_id: '',
  assigned_user_id: '',
  assigned_supplier_id: '',
  promised_on: '',
  notes: '',
};

function NewOrderSheet({
  open,
  onOpenChange,
  custodyId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  custodyId?: string;
}) {
  const nav = useNavigate();
  const { data: lk } = useLookups();
  const [f, setF] = useState(EMPTY);
  useEffect(() => {
    if (open) setF({ ...EMPTY, custody_item_id: custodyId ?? '' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = useQuery({
    queryKey: ['custody', 'pending'],
    queryFn: () =>
      api.get<Page<{ id: number; code: string; customer_name: string; description: string }>>(
        '/ops/custody?pending=1&pageSize=100',
      ),
    enabled: open,
  });

  const save = useSave(() => api.post<{ id: number }>('/ops/work-orders', f), {
    success: 'Orden abierta',
    invalidate: [['work-orders'], ['pieces-out']],
    onSuccess: (r) => {
      onOpenChange(false);
      nav(`/procesos/taller/${r.id}`);
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
      title="Nueva orden de taller"
      description="Después se cargan las piezas que entran. Al cerrarla, los gramos tienen que cuadrar."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Abrir orden
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Trabajo" required>
          <Select value={f.kind} onChange={set('kind')}>
            {WorkOrderKind.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Taller" required error={save.fields.location_id} hint="Solo sedes de tipo taller">
          <Select value={f.location_id} onChange={set('location_id')}>
            <option value="">Elegir…</option>
            {lk?.locations
              .filter((l) => l.is_active && (l.kind === 'workshop' || l.kind === 'consignment'))
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Pieza de un cliente" className="sm:col-span-2" hint="Dejar vacío si es una pieza nuestra">
          <Select value={f.custody_item_id} onChange={set('custody_item_id')}>
            <option value="">Es una pieza del inventario</option>
            {pending.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.customer_name} · {c.description}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quién lo hace">
          <Select value={f.assigned_user_id} onChange={set('assigned_user_id')}>
            <option value="">Sin asignar</option>
            {lk?.users
              .filter((u) => u.is_active)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Taller externo">
          <Select value={f.assigned_supplier_id} onChange={set('assigned_supplier_id')}>
            <option value="">—</option>
            {lk?.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Se compromete para el">
          <Input type="date" value={f.promised_on} onChange={set('promised_on')} />
        </Field>
        <Field label="Notas" className="sm:col-span-2">
          <Textarea value={f.notes} onChange={set('notes')} rows={2} />
        </Field>
      </div>
    </Sheet>
  );
}

export function WorkOrdersPage() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const status = sp.get('estado') ?? '';
  const page = Number(sp.get('page') ?? 1);

  const { data, isFetching } = useQuery({
    queryKey: ['work-orders', status, page],
    queryFn: () => api.get<Page<WorkOrderRow>>(`/ops/work-orders${qs({ status, page })}`),
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
        title="Taller"
        description="Reparaciones, ajustes y fabricación. Al cerrar una orden, los gramos que entran tienen que coincidir con los que salen más la merma."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Nueva orden
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <Segmented
            value={status}
            onChange={(v) => upd('estado', v)}
            options={[{ value: '', label: 'Todas' }, ...WorkOrderStatus.options.filter((o) => o.value !== 'cancelled')]}
          />
        </div>
        <DataTable
          rows={data?.items}
          loading={isFetching}
          rowKey={(r) => r.id}
          onRowClick={(r) => nav(`/procesos/taller/${r.id}`)}
          columns={[
            { key: 'c', header: 'Código', cell: (r) => <Mono className="font-medium">{r.code}</Mono> },
            {
              key: 'k',
              header: 'Trabajo',
              cell: (r) => (
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">{WorkOrderKind.label(r.kind as never)}</div>
                  {r.custody_code && (
                    <div className="truncate text-xs text-muted-foreground">
                      Cliente: {r.customer_name}
                    </div>
                  )}
                </div>
              ),
            },
            { key: 'l', header: 'Taller', cell: (r) => <Mono>{r.location_code}</Mono>, className: 'hidden md:table-cell' },
            {
              key: 'a',
              header: 'Responsable',
              cell: (r) => (
                <span className="text-muted-foreground">{r.assigned_user_name ?? r.assigned_supplier_name ?? '—'}</span>
              ),
              className: 'hidden lg:table-cell',
            },
            {
              key: 'g',
              header: 'Gramos',
              align: 'right',
              cell: (r) => (
                <span className="tabular text-[12.5px]">
                  {grams(r.input_g)} → {grams(r.output_g)}
                </span>
              ),
              className: 'hidden sm:table-cell',
            },
            {
              key: 'm',
              header: 'Merma',
              align: 'right',
              cell: (r) =>
                r.loss_pct == null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <Badge tone={r.max_loss_pct != null && r.loss_pct > r.max_loss_pct ? 'danger' : 'neutral'}>
                    {Number(r.loss_pct).toFixed(2)}%
                  </Badge>
                ),
            },
            {
              key: 'p',
              header: 'Para el',
              cell: (r) =>
                r.promised_on ? (
                  <Badge tone={r.is_overdue ? 'danger' : 'neutral'}>{date(r.promised_on)}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
              className: 'hidden md:table-cell',
            },
            { key: 's', header: 'Estado', cell: (r) => <WorkOrderStatusBadge status={r.status} /> },
          ]}
          empty={
            <EmptyState
              icon={Hammer}
              title="Sin órdenes de taller"
              description="Abra una para mandar una pieza a reparar, ajustar o fundir."
              action={
                <Button onClick={() => setCreating(true)}>
                  <Plus /> Nueva orden
                </Button>
              }
            />
          }
        />
        {data && data.total > 0 && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => upd('page', String(p))} />
        )}
      </Card>
      <NewOrderSheet open={creating} onOpenChange={setCreating} />
    </>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Store, Trash2 } from 'lucide-react';
import { ConsignmentStatus, type Page } from '@minitta/shared';
import { api, qs } from '@/lib/api';
import { useLookups } from '@/lib/lookups';
import { useSave } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { date, qty } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, Segmented } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/overlay';
import { DataTable, EmptyState, Mono, PageHeader, Pagination, Thumb } from '@/components/common';
import { VariantPicker, type VariantHit } from '@/components/variant-picker';

export interface ConsignmentRow {
  id: number;
  code: string;
  status: string;
  partner_name: string;
  partner_code: string;
  partner_location_name: string;
  from_code: string;
  commission_pct: number;
  currency_code: string;
  started_on: string;
  due_on: string | null;
  responsible_name: string | null;
  lines: number;
  units_sent: number;
  units_pending: number;
  is_overdue: boolean;
}

export function ConsignmentStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'active' ? 'info' : status === 'closed' ? 'success' : status === 'cancelled' ? 'danger' : 'neutral';
  return <Badge tone={tone as never}>{ConsignmentStatus.label(status as never)}</Badge>;
}

interface Line {
  variant: VariantHit;
  quantity_sent: string;
  unit_price: string;
}

const EMPTY = {
  partner_location_id: '',
  partner_name: '',
  partner_contact: '',
  from_location_id: '',
  commission_pct: '0',
  currency_code: 'PEN',
  due_on: '',
  responsible_user_id: '',
  notes: '',
};

function NewConsignmentSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const nav = useNavigate();
  const { data: lk } = useLookups();
  const { locationId } = useSession();
  const [h, setH] = useState(EMPTY);
  const [lines, setLines] = useState<Line[]>([]);
  const [picker, setPicker] = useState<VariantHit | null>(null);
  useEffect(() => {
    if (open) {
      setH({ ...EMPTY, from_location_id: locationId ? String(locationId) : '' });
      setLines([]);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useSave(
    () =>
      api.post<{ id: number }>('/ops/consignments', {
        ...h,
        lines: lines.map((l) => ({
          variant_id: l.variant.variant_id,
          quantity_sent: l.variant.tracking_mode === 'serial' ? 1 : l.quantity_sent,
          unit_price: l.unit_price,
        })),
      }),
    {
      success: 'Consignación creada en borrador',
      invalidate: [['consignments']],
      onSuccess: (r) => {
        onOpenChange(false);
        nav(`/procesos/consignaciones/${r.id}`);
      },
    },
  );

  const set =
    (k: keyof typeof EMPTY) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setH((p) => ({ ...p, [k]: e.target.value }));

  const partners = lk?.locations.filter((l) => l.is_active && l.is_third_party) ?? [];

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width="max-w-2xl"
      title="Nueva consignación"
      description="La mercadería pasa a poder de un tercero, pero sigue siendo nuestra hasta que la venda."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)} disabled={!lines.length}>
            Crear borrador
          </Button>
        </>
      }
    >
      {partners.length === 0 && (
        <p className="mb-4 rounded-lg border border-warning/40 bg-warning-soft/50 px-3 py-2 text-[13px]">
          No hay sedes de terceros cargadas. Cree una en Ajustes › Sedes con tipo “Consignación” y la
          marca “es de un tercero”.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Consignatario" required error={save.fields.partner_location_id}>
          <Select
            value={h.partner_location_id}
            onChange={(e) => {
              const l = partners.find((p) => String(p.id) === e.target.value);
              setH((p) => ({ ...p, partner_location_id: e.target.value, partner_name: l?.name ?? p.partner_name }));
            }}
          >
            <option value="">Elegir…</option>
            {partners.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="A nombre de" required error={save.fields.partner_name}>
          <Input value={h.partner_name} onChange={set('partner_name')} />
        </Field>
        <Field label="Sale de" required error={save.fields.from_location_id}>
          <Select value={h.from_location_id} onChange={set('from_location_id')}>
            <option value="">Elegir…</option>
            {lk?.locations
              .filter((l) => l.is_active && l.holds_stock && !l.is_third_party)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Contacto">
          <Input value={h.partner_contact} onChange={set('partner_contact')} />
        </Field>
        <Field label="Comisión (%)">
          <Input value={h.commission_pct} onChange={set('commission_pct')} inputMode="decimal" />
        </Field>
        <Field label="Moneda">
          <Select value={h.currency_code} onChange={set('currency_code')}>
            {lk?.currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vence el" hint="Después de esta fecha aparece en los vencidos">
          <Input type="date" value={h.due_on} onChange={set('due_on')} />
        </Field>
        <Field label="Responsable">
          <Select value={h.responsible_user_id} onChange={set('responsible_user_id')}>
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
      </div>

      <div className="mt-6">
        <h4 className="mb-2 text-[13px] font-semibold">Qué se entrega</h4>
        <VariantPicker
          value={picker}
          locationId={Number(h.from_location_id) || null}
          placeholder="Agregar artículo…"
          onChange={(v) => {
            if (v) setLines((ls) => [...ls, { variant: v, quantity_sent: '1', unit_price: '' }]);
            setPicker(null);
          }}
        />
        {save.fields.lines && <p className="mt-1 text-xs text-destructive">{save.fields.lines[0]}</p>}
        {lines.length > 0 && (
          <ul className="mt-3 divide-y rounded-lg border">
            {lines.map((l, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2">
                <Thumb src={l.variant.image_url} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{l.variant.product_name}</div>
                  <Mono className="text-muted-foreground">{l.variant.sku}</Mono>
                </div>
                <Input
                  className="w-20 text-right"
                  value={l.quantity_sent}
                  inputMode="decimal"
                  disabled={l.variant.tracking_mode === 'serial'}
                  onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity_sent: e.target.value } : x)))}
                />
                <Input
                  className="w-24 text-right"
                  value={l.unit_price}
                  placeholder="precio"
                  inputMode="decimal"
                  onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unit_price: e.target.value } : x)))}
                />
                <Button variant="ghost" size="icon-xs" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Field label="Notas" className="mt-4">
        <Textarea value={h.notes} onChange={set('notes')} rows={2} />
      </Field>
    </Sheet>
  );
}

export function ConsignmentsPage() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const status = sp.get('estado') ?? '';
  const page = Number(sp.get('page') ?? 1);

  const { data, isFetching } = useQuery({
    queryKey: ['consignments', status, page],
    queryFn: () => api.get<Page<ConsignmentRow>>(`/ops/consignments${qs({ status, page })}`),
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
        title="Consignaciones"
        description="Mercadería en poder de un tercero: qué tiene, qué vendió y cuánto nos corresponde."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Nueva consignación
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <Segmented
            value={status}
            onChange={(v) => upd('estado', v)}
            options={[{ value: '', label: 'Todas' }, ...ConsignmentStatus.options.filter((o) => o.value !== 'cancelled')]}
          />
        </div>
        <DataTable
          rows={data?.items}
          loading={isFetching}
          rowKey={(r) => r.id}
          onRowClick={(r) => nav(`/procesos/consignaciones/${r.id}`)}
          columns={[
            { key: 'c', header: 'Código', cell: (r) => <Mono className="font-medium">{r.code}</Mono> },
            {
              key: 'p',
              header: 'Consignatario',
              cell: (r) => (
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{r.partner_name}</div>
                  <div className="truncate text-xs text-muted-foreground">desde {r.from_code}</div>
                </div>
              ),
            },
            { key: 'l', header: 'Líneas', align: 'right', cell: (r) => <span className="tabular">{r.lines}</span>, className: 'hidden sm:table-cell' },
            { key: 'u', header: 'Entregado', align: 'right', cell: (r) => <span className="tabular">{qty(r.units_sent)}</span> },
            {
              key: 'pe',
              header: 'En su poder',
              align: 'right',
              cell: (r) => <span className="tabular font-medium">{qty(r.units_pending)}</span>,
            },
            { key: 'co', header: 'Comisión', align: 'right', cell: (r) => `${Number(r.commission_pct)}%`, className: 'hidden md:table-cell' },
            {
              key: 'd',
              header: 'Vence',
              cell: (r) =>
                r.due_on ? (
                  <Badge tone={r.is_overdue ? 'danger' : 'neutral'}>{date(r.due_on)}</Badge>
                ) : (
                  <span className="text-muted-foreground">sin plazo</span>
                ),
            },
            { key: 's', header: 'Estado', cell: (r) => <ConsignmentStatusBadge status={r.status} /> },
          ]}
          empty={
            <EmptyState
              icon={Store}
              title="Sin consignaciones"
              description="Cree una cuando entregue mercadería a una feria o a otra tienda."
              action={
                <Button onClick={() => setCreating(true)}>
                  <Plus /> Nueva consignación
                </Button>
              }
            />
          }
        />
        {data && data.total > 0 && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => upd('page', String(p))} />
        )}
      </Card>
      <NewConsignmentSheet open={creating} onOpenChange={setCreating} />
    </>
  );
}

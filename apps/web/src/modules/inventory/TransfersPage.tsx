import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, ArrowRight, Plus, Trash2 } from 'lucide-react';
import { TransferPurpose, TransferStatus, type Page } from '@minitta/shared';
import { api, qs } from '@/lib/api';
import { useLookups } from '@/lib/lookups';
import { useSave } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { dateTime, qty } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Card, Segmented } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/overlay';
import { DataTable, EmptyState, Mono, PageHeader, Pagination, Thumb, TransferStatusBadge } from '@/components/common';
import { VariantPicker, type VariantHit } from '@/components/variant-picker';

interface TransferRow {
  id: number;
  code: string;
  status: string;
  purpose: string;
  from_code: string;
  from_name: string;
  to_code: string;
  to_name: string;
  lines: number;
  units: number;
  created_at: string;
  sent_at: string | null;
  received_at: string | null;
  sent_by_name: string | null;
}

interface Line {
  variant: VariantHit;
  quantity: string;
  serial_id: string;
}

function NewTransferSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const nav = useNavigate();
  const { data: lk } = useLookups();
  const { locationId } = useSession();
  const [head, setHead] = useState({ from_location_id: '', to_location_id: '', purpose: 'restock', carrier: '', notes: '' });
  const [lines, setLines] = useState<Line[]>([]);
  const [picker, setPicker] = useState<VariantHit | null>(null);
  useEffect(() => {
    if (open) {
      setHead({ from_location_id: locationId ? String(locationId) : '', to_location_id: '', purpose: 'restock', carrier: '', notes: '' });
      setLines([]);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const serialIds = lines.filter((l) => l.variant.tracking_mode === 'serial').map((l) => l.variant.variant_id);
  const serials = useQuery({
    queryKey: ['transfer-serials', head.from_location_id, serialIds.join(',')],
    queryFn: () =>
      api.get<Page<{ serial_id: number; serial_code: string; variant_id: number; actual_weight_g: number | null }>>(
        `/serials${qs({ location_id: head.from_location_id, status: 'in_stock', pageSize: 200 })}`,
      ),
    enabled: open && !!head.from_location_id && serialIds.length > 0,
  });

  const save = useSave(
    () =>
      api.post<{ id: number }>('/transfers', {
        ...head,
        lines: lines.map((l) => ({ variant_id: l.variant.variant_id, quantity_sent: l.variant.tracking_mode === 'serial' ? 1 : l.quantity, serial_id: l.serial_id })),
      }),
    {
      success: 'Transferencia creada en borrador',
      invalidate: [['transfers']],
      onSuccess: (r) => {
        onOpenChange(false);
        nav(`/inventario/transferencias/${r.id}`);
      },
    },
  );
  if (!lk) return null;
  const locs = lk.locations.filter((l) => l.is_active && l.holds_stock);
  const set = (k: keyof typeof head) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setHead((p) => ({ ...p, [k]: e.target.value }));

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width="max-w-2xl"
      title="Nueva transferencia"
      description="Queda en borrador. Al enviarla sale del origen; al recibirla entra al destino."
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
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr]">
        <Field label="Desde" required error={save.fields.from_location_id}>
          <Select value={head.from_location_id} onChange={set('from_location_id')}>
            <option value="">Elegir…</option>
            {locs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <ArrowRight className="mt-8 hidden size-4 text-muted-foreground sm:block" />
        <Field label="Hacia" required error={save.fields.to_location_id}>
          <Select value={head.to_location_id} onChange={set('to_location_id')}>
            <option value="">Elegir…</option>
            {locs
              .filter((l) => String(l.id) !== head.from_location_id)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
          </Select>
        </Field>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Motivo">
          <Select value={head.purpose} onChange={set('purpose')}>
            {TransferPurpose.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quién la lleva">
          <Input value={head.carrier} onChange={set('carrier')} />
        </Field>
      </div>

      <div className="mt-6">
        <h4 className="mb-2 text-[13px] font-semibold">Artículos</h4>
        <VariantPicker
          value={picker}
          locationId={Number(head.from_location_id) || null}
          placeholder="Agregar artículo…"
          onChange={(v) => {
            if (v) setLines((ls) => [...ls, { variant: v, quantity: '1', serial_id: '' }]);
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
                  <div className="text-xs text-muted-foreground">
                    <Mono>{l.variant.sku}</Mono>
                    {l.variant.on_hand != null && ` · hay ${qty(l.variant.on_hand)}`}
                  </div>
                </div>
                {l.variant.tracking_mode === 'serial' ? (
                  <Select
                    className="w-48"
                    value={l.serial_id}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, serial_id: e.target.value } : x)))}
                  >
                    <option value="">Elegir pieza…</option>
                    {serials.data?.items
                      .filter((s) => s.variant_id === l.variant.variant_id)
                      .map((s) => (
                        <option key={s.serial_id} value={s.serial_id}>
                          {s.serial_code} {s.actual_weight_g ? `· ${s.actual_weight_g} g` : ''}
                        </option>
                      ))}
                  </Select>
                ) : (
                  <Input
                    className="w-24 text-right"
                    value={l.quantity}
                    inputMode="decimal"
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                  />
                )}
                <Button variant="ghost" size="icon-xs" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Field label="Notas" className="mt-4">
        <Textarea value={head.notes} onChange={set('notes')} rows={2} />
      </Field>
    </Sheet>
  );
}

export function TransfersPage() {
  const nav = useNavigate();
  const { data: lk } = useLookups();
  const [sp, setSp] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const status = sp.get('estado') ?? '';
  const loc = sp.get('sede') ?? '';
  const page = Number(sp.get('page') ?? 1);
  const { data, isFetching } = useQuery({
    queryKey: ['transfers', status, loc, page],
    queryFn: () => api.get<Page<TransferRow>>(`/transfers${qs({ status, location_id: loc, page })}`),
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
        title="Transferencias"
        description="Movimientos de mercadería entre sedes: reposición, exhibición, reparación."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Nueva transferencia
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <Segmented
            value={status}
            onChange={(v) => upd('estado', v)}
            options={[{ value: '', label: 'Todas' }, ...TransferStatus.options.filter((o) => o.value !== 'cancelled')]}
          />
          <Select className="w-52" value={loc} onChange={(e) => upd('sede', e.target.value)}>
            <option value="">Todas las sedes</option>
            {lk?.locations
              .filter((l) => l.holds_stock)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
          </Select>
        </div>
        <DataTable
          rows={data?.items}
          loading={isFetching}
          rowKey={(r) => r.id}
          onRowClick={(r) => nav(`/inventario/transferencias/${r.id}`)}
          columns={[
            { key: 'c', header: 'Código', cell: (r) => <Mono className="font-medium">{r.code}</Mono> },
            {
              key: 'r',
              header: 'Ruta',
              cell: (r) => (
                <span className="flex items-center gap-1.5">
                  <Mono>{r.from_code}</Mono>
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                  <Mono>{r.to_code}</Mono>
                </span>
              ),
            },
            { key: 'p', header: 'Motivo', cell: (r) => TransferPurpose.label(r.purpose as never), className: 'hidden md:table-cell' },
            { key: 'l', header: 'Líneas', align: 'right', cell: (r) => <span className="tabular">{r.lines}</span> },
            { key: 'u', header: 'Unidades', align: 'right', cell: (r) => <span className="tabular">{qty(r.units)}</span> },
            { key: 'd', header: 'Creada', cell: (r) => <span className="text-muted-foreground">{dateTime(r.created_at)}</span>, className: 'hidden lg:table-cell' },
            { key: 's', header: 'Estado', cell: (r) => <TransferStatusBadge status={r.status} /> },
          ]}
          empty={
            <EmptyState
              icon={ArrowLeftRight}
              title="Sin transferencias"
              description="Cree una para mover mercadería de una sede a otra."
              action={
                <Button onClick={() => setCreating(true)}>
                  <Plus /> Nueva transferencia
                </Button>
              }
            />
          }
        />
        {data && data.total > 0 && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => upd('page', String(p))} />}
      </Card>
      <NewTransferSheet open={creating} onOpenChange={setCreating} />
    </>
  );
}

import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Hammer, PackageCheck } from 'lucide-react';
import { CustodyEventKind } from '@minitta/shared';
import { api } from '@/lib/api';
import { useLookups } from '@/lib/lookups';
import { useSave } from '@/lib/forms';
import { date, dateTime, grams, money } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, CardHeader, Skeleton } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/overlay';
import { Mono, PageHeader, Stat } from '@/components/common';
import { CustodyStatusBadge } from './CustodyPage';

interface Event {
  id: number;
  kind: string;
  occurred_at: string;
  weight_g: number | null;
  weight_diff_g: number | null;
  from_location: string | null;
  to_location: string | null;
  registered_by: string | null;
  work_order: string | null;
  notes: string | null;
}

interface Detail {
  id: number;
  code: string;
  status: string;
  customer_id: number;
  customer_code: string;
  customer_name: string;
  customer_phone: string | null;
  document_type: string;
  document_number: string | null;
  description: string;
  requested_service: string;
  material_name: string | null;
  received_weight_g: number;
  delivered_weight_g: number | null;
  stone_notes: string | null;
  condition_notes: string | null;
  location_code: string;
  location_name: string;
  received_at: string;
  received_by_name: string | null;
  promised_on: string | null;
  delivered_at: string | null;
  delivered_to: string | null;
  delivered_by_name: string | null;
  quoted_amount: number | null;
  quoted_currency: string | null;
  notes: string | null;
  events: Event[];
  work_orders: { id: number; code: string; kind: string; status: string; promised_on: string | null }[];
}

function MoveDialog({ item, open, onOpenChange }: { item: Detail; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: lk } = useLookups();
  const [f, setF] = useState({ to_location_id: '', kind: 'moved', weight_g: '', notes: '' });
  const save = useSave(() => api.post(`/ops/custody/${item.id}/move`, f), {
    success: 'Movimiento registrado',
    invalidate: [['custody', item.id], ['custody'], ['pieces-out']],
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Mover la pieza"
      description="Queda un eslabón en la cadena de custodia, con quién la movió y a dónde."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Registrar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="A dónde" required error={save.fields.to_location_id}>
          <Select value={f.to_location_id} onChange={(e) => setF((p) => ({ ...p, to_location_id: e.target.value }))}>
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
        <Field label="Motivo">
          <Select value={f.kind} onChange={(e) => setF((p) => ({ ...p, kind: e.target.value }))}>
            {CustodyEventKind.options
              .filter((o) => !['received', 'delivered'].includes(o.value))
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Peso ahora (g)" hint="Opcional, pero conviene pesarla en cada paso">
          <Input value={f.weight_g} onChange={(e) => setF((p) => ({ ...p, weight_g: e.target.value }))} inputMode="decimal" />
        </Field>
        <Field label="Nota">
          <Textarea value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}

function DeliverDialog({ item, open, onOpenChange }: { item: Detail; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [f, setF] = useState({ delivered_to: item.customer_name, weight_g: '', notes: '' });
  const save = useSave(() => api.post(`/ops/custody/${item.id}/deliver`, f), {
    success: 'Pieza entregada',
    invalidate: [['custody', item.id], ['custody'], ['pieces-out']],
    onSuccess: () => onOpenChange(false),
  });
  const diff = f.weight_g ? Number(f.weight_g) - item.received_weight_g : null;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Entregar al cliente"
      description="Se pesa delante del cliente y se registra quién la retira."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Entregar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Quién la retira" required error={save.fields.delivered_to}>
          <Input value={f.delivered_to} onChange={(e) => setF((p) => ({ ...p, delivered_to: e.target.value }))} />
        </Field>
        <Field label="Peso de salida (g)" required error={save.fields.weight_g}>
          <Input value={f.weight_g} onChange={(e) => setF((p) => ({ ...p, weight_g: e.target.value }))} inputMode="decimal" autoFocus />
        </Field>
        {diff !== null && Number.isFinite(diff) && Math.abs(diff) > 0.05 && (
          <p className="rounded-lg border border-warning/40 bg-warning-soft/60 px-3 py-2 text-[13px]">
            Entró con {grams(item.received_weight_g)} y sale con {grams(Number(f.weight_g))}:{' '}
            <strong>{diff > 0 ? '+' : ''}{diff.toFixed(3)} g</strong>. La diferencia queda registrada en la cadena.
          </p>
        )}
        <Field label="Nota">
          <Textarea value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}

export function CustodyDetailPage() {
  const { id } = useParams();
  const [moving, setMoving] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const { data: c } = useQuery({
    queryKey: ['custody', Number(id)],
    queryFn: () => api.get<Detail>(`/ops/custody/${id}`),
  });

  if (!c) return <Skeleton className="h-96 w-full" />;
  const delivered = c.status === 'delivered';
  const openOrder = c.work_orders.find((w) => !['closed', 'cancelled'].includes(w.status));

  return (
    <>
      <PageHeader
        back={{ to: '/procesos/custodia', label: 'Custodia' }}
        title={c.description}
        description={`${c.customer_name}${c.customer_phone ? ` · ${c.customer_phone}` : ''}`}
        meta={
          <>
            <Mono className="font-medium">{c.code}</Mono>
            <CustodyStatusBadge status={c.status} />
            {c.promised_on && !delivered && (
              <Badge tone={new Date(c.promised_on) < new Date() ? 'danger' : 'neutral'}>
                Se entrega el {date(c.promised_on)}
              </Badge>
            )}
          </>
        }
        actions={
          !delivered && (
            <>
              <Button variant="outline" onClick={() => setMoving(true)}>
                <ArrowRight /> Mover
              </Button>
              <Button onClick={() => setDelivering(true)} disabled={!!openOrder}>
                <PackageCheck /> Entregar
              </Button>
            </>
          )
        }
      />

      {openOrder && (
        <Card className="mb-5 border-info/40 bg-info-soft/40 px-4 py-3 text-[13px]">
          <Hammer className="mr-1.5 inline size-3.5" />
          Tiene la orden de taller{' '}
          <Link className="font-medium underline" to={`/procesos/taller/${openOrder.id}`}>
            {openOrder.code}
          </Link>{' '}
          abierta. No se puede entregar hasta cerrarla.
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="La pieza" />
          <dl className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
            <Stat label="Servicio pedido" value={c.requested_service} />
            <Stat label="Material" value={c.material_name} />
            <Stat label="Peso al recibirla" value={grams(c.received_weight_g)} mono />
            <Stat label="Peso al entregarla" value={c.delivered_weight_g ? grams(c.delivered_weight_g) : '—'} mono />
            <Stat label="Piedras" value={c.stone_notes} />
            <Stat label="Estado al llegar" value={c.condition_notes} />
            <Stat label="Dónde está" value={`${c.location_code} · ${c.location_name}`} />
            <Stat label="Recibida por" value={c.received_by_name} />
            <Stat label="Recibida el" value={dateTime(c.received_at)} />
            {c.quoted_amount != null && (
              <Stat label="Cotizado" value={money(c.quoted_amount, c.quoted_currency ?? 'PEN')} />
            )}
            {c.delivered_at && <Stat label="Entregada a" value={`${c.delivered_to} · ${dateTime(c.delivered_at)}`} />}
            <Stat label="Documento" value={c.document_number ?? "—"} />
          </dl>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Cadena de custodia"
            description="Cada mano que tocó la pieza, con su peso. No se puede editar ni borrar."
          />
          <ol className="px-5 pb-5">
            {c.events.map((e, i) => (
              <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
                {i < c.events.length - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-border" />}
                <span className="mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full border bg-card">
                  <Check className="size-3 text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">{CustodyEventKind.label(e.kind as never)}</span>
                    {e.weight_g != null && <Mono>{grams(e.weight_g)}</Mono>}
                    {e.weight_diff_g != null && Math.abs(e.weight_diff_g) > 0.05 && (
                      <Badge tone={e.weight_diff_g < 0 ? 'warning' : 'info'}>
                        {e.weight_diff_g > 0 ? '+' : ''}
                        {Number(e.weight_diff_g).toFixed(3)} g
                      </Badge>
                    )}
                    {e.work_order && <Badge tone="info">{e.work_order}</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {dateTime(e.occurred_at)}
                    {e.to_location && ` · ${e.from_location ? `${e.from_location} → ` : ''}${e.to_location}`}
                    {e.registered_by && ` · ${e.registered_by}`}
                  </div>
                  {e.notes && <p className="mt-1 text-[13px]">{e.notes}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <MoveDialog item={c} open={moving} onOpenChange={setMoving} />
      <DeliverDialog item={c} open={delivering} onOpenChange={setDelivering} />
    </>
  );
}

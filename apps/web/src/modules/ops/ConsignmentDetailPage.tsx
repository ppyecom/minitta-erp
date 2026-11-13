import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Receipt, Send, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useSave } from '@/lib/forms';
import { date, dateTime, money, qty, today } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Badge, Card, CardHeader, Skeleton } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/overlay';
import { DataTable, Mono, PageHeader, Stat, Thumb } from '@/components/common';
import { ConsignmentStatusBadge } from './ConsignmentsPage';

interface Line {
  id: number;
  variant_id: number;
  sku: string;
  product_name: string;
  image_url: string | null;
  serial_code: string | null;
  quantity_sent: number;
  quantity_sold: number;
  quantity_returned: number;
  quantity_pending: number;
  unit_price: number | null;
}

interface Settlement {
  id: number;
  period_from: string;
  period_to: string;
  gross_amount: number;
  commission_amount: number;
  net_amount: number;
  currency_code: string;
  settled_at: string;
  settled_by_name: string | null;
}

interface Detail {
  id: number;
  code: string;
  status: string;
  partner_name: string;
  partner_code: string;
  partner_location_name: string;
  partner_contact: string | null;
  from_code: string;
  from_name: string;
  commission_pct: number;
  currency_code: string;
  started_on: string;
  due_on: string | null;
  responsible_name: string | null;
  notes: string | null;
  lines: Line[];
  settlements: Settlement[];
}

function MoveDialog({
  c,
  line,
  kind,
  onClose,
}: {
  c: Detail;
  line: Line;
  kind: 'sale' | 'return';
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState('1');
  const save = useSave(() => api.post(`/ops/consignments/${c.id}/lines/${line.id}/${kind}`, { quantity }), {
    success: kind === 'sale' ? 'Venta registrada' : 'Devolución registrada',
    invalidate: [['consignment', c.id], ['consignments'], ['pieces-out'], ['stock']],
    onSuccess: onClose,
  });
  return (
    <Dialog
      open
      onOpenChange={onClose}
      size="sm"
      title={kind === 'sale' ? 'El tercero vendió' : 'Devuelve mercadería'}
      description={`${line.product_name} · quedan ${qty(line.quantity_pending)} en su poder`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Registrar
          </Button>
        </>
      }
    >
      <Field label="Cantidad" required error={save.fields.quantity}>
        <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" autoFocus />
      </Field>
    </Dialog>
  );
}

function SettleDialog({ c, open, onOpenChange }: { c: Detail; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [f, setF] = useState({ period_from: c.started_on, period_to: today() });
  const save = useSave(() => api.post(`/ops/consignments/${c.id}/settle`, f), {
    success: 'Liquidación generada',
    invalidate: [['consignment', c.id]],
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Liquidar el período"
      description={`Suma lo vendido y descuenta la comisión del ${Number(c.commission_pct)}%.`}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Liquidar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Desde" required error={save.fields.period_from}>
          <Input type="date" value={f.period_from} onChange={(e) => setF((p) => ({ ...p, period_from: e.target.value }))} />
        </Field>
        <Field label="Hasta" required error={save.fields.period_to}>
          <Input type="date" value={f.period_to} onChange={(e) => setF((p) => ({ ...p, period_to: e.target.value }))} />
        </Field>
      </div>
    </Dialog>
  );
}

export function ConsignmentDetailPage() {
  const { id } = useParams();
  const [moving, setMoving] = useState<{ line: Line; kind: 'sale' | 'return' } | null>(null);
  const [settling, setSettling] = useState(false);
  const { data: c } = useQuery({
    queryKey: ['consignment', Number(id)],
    queryFn: () => api.get<Detail>(`/ops/consignments/${id}`),
  });

  const send = useSave(() => api.post(`/ops/consignments/${id}/send`), {
    success: 'Mercadería entregada al consignatario',
    invalidate: [['consignment', Number(id)], ['consignments'], ['pieces-out'], ['stock']],
  });

  if (!c) return <Skeleton className="h-96 w-full" />;
  const active = c.status === 'active' || c.status === 'settling';

  return (
    <>
      <PageHeader
        back={{ to: '/procesos/consignaciones', label: 'Consignaciones' }}
        title={c.partner_name}
        description={`${c.from_code} · ${c.from_name} → ${c.partner_code} · ${c.partner_location_name}`}
        meta={
          <>
            <Mono className="font-medium">{c.code}</Mono>
            <ConsignmentStatusBadge status={c.status} />
            {c.due_on && (
              <Badge tone={new Date(c.due_on) < new Date() && active ? 'danger' : 'neutral'}>
                Vence el {date(c.due_on)}
              </Badge>
            )}
          </>
        }
        actions={
          <>
            {c.status === 'draft' && (
              <Button loading={send.isPending} onClick={() => send.mutate(undefined)}>
                <Send /> Entregar
              </Button>
            )}
            {active && (
              <Button variant="outline" onClick={() => setSettling(true)}>
                <Receipt /> Liquidar
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-5">
        <Card>
          <CardHeader title="Qué tiene el consignatario" />
          <DataTable
            rows={c.lines}
            rowKey={(l) => l.id}
            columns={[
              {
                key: 'p',
                header: 'Artículo',
                cell: (l) => (
                  <div className="flex items-center gap-3">
                    <Thumb src={l.image_url} size={32} />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium">{l.product_name}</div>
                      <Mono className="text-muted-foreground">{l.serial_code ?? l.sku}</Mono>
                    </div>
                  </div>
                ),
              },
              { key: 's', header: 'Entregado', align: 'right', cell: (l) => <span className="tabular">{qty(l.quantity_sent)}</span> },
              { key: 'v', header: 'Vendido', align: 'right', cell: (l) => <span className="tabular">{qty(l.quantity_sold)}</span> },
              { key: 'd', header: 'Devuelto', align: 'right', cell: (l) => <span className="tabular">{qty(l.quantity_returned)}</span> },
              {
                key: 'pe',
                header: 'Pendiente',
                align: 'right',
                cell: (l) => <span className="tabular font-medium">{qty(l.quantity_pending)}</span>,
              },
              {
                key: 'pr',
                header: 'Precio',
                align: 'right',
                cell: (l) => (l.unit_price ? money(l.unit_price, c.currency_code) : '—'),
                className: 'hidden md:table-cell',
              },
              {
                key: 'a',
                header: '',
                align: 'right',
                cell: (l) =>
                  active && l.quantity_pending > 0 ? (
                    <div className="flex justify-end gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => setMoving({ line: l, kind: 'sale' })}>
                        Vendió
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setMoving({ line: l, kind: 'return' })}>
                        <Undo2 /> Devuelve
                      </Button>
                    </div>
                  ) : null,
              },
            ]}
          />
        </Card>

        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader title="El acuerdo" />
            <dl className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
              <Stat label="Comisión" value={`${Number(c.commission_pct)}%`} />
              <Stat label="Moneda" value={c.currency_code} />
              <Stat label="Desde" value={date(c.started_on)} />
              <Stat label="Vence" value={c.due_on ? date(c.due_on) : '—'} />
              <Stat label="Responsable" value={c.responsible_name} />
              <Stat label="Contacto" value={c.partner_contact} />
              <Stat label="Notas" value={c.notes} />
            </dl>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader title="Liquidaciones" description="Lo vendido en el período, menos la comisión" />
            {c.settlements.length === 0 ? (
              <p className="px-5 pb-5 text-[13px] text-muted-foreground">Todavía no se liquidó nada.</p>
            ) : (
              <DataTable
                rows={c.settlements}
                rowKey={(s) => s.id}
                columns={[
                  { key: 'p', header: 'Período', cell: (s) => `${date(s.period_from)} – ${date(s.period_to)}` },
                  { key: 'g', header: 'Vendido', align: 'right', cell: (s) => money(s.gross_amount, s.currency_code) },
                  { key: 'c', header: 'Comisión', align: 'right', cell: (s) => money(s.commission_amount, s.currency_code) },
                  {
                    key: 'n',
                    header: 'Nos corresponde',
                    align: 'right',
                    cell: (s) => <span className="font-medium">{money(s.net_amount, s.currency_code)}</span>,
                  },
                  {
                    key: 'd',
                    header: 'Liquidada',
                    cell: (s) => <span className="text-muted-foreground">{dateTime(s.settled_at)}</span>,
                    className: 'hidden lg:table-cell',
                  },
                ]}
              />
            )}
          </Card>
        </div>
      </div>

      {moving && <MoveDialog c={c} line={moving.line} kind={moving.kind} onClose={() => setMoving(null)} />}
      <SettleDialog c={c} open={settling} onOpenChange={setSettling} />
    </>
  );
}

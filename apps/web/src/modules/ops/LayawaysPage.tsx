import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Coins, Wallet } from 'lucide-react';
import { PaymentMethod } from '@minitta/shared';
import { api } from '@/lib/api';
import { useLookups } from '@/lib/lookups';
import { useSave } from '@/lib/forms';
import { dateTime, money, qty } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, Card } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/overlay';
import { Confirm, DataTable, EmptyState, Mono, PageHeader } from '@/components/common';

interface Layaway {
  reservation_id: number;
  customer_name: string | null;
  customer_phone: string | null;
  sku: string;
  product_name: string;
  location: string;
  quantity: number;
  status: string;
  reserved_at: string;
  expires_at: string | null;
  deposit: number;
  paid: number;
  payment_count: number;
  last_payment_at: string | null;
  is_overdue: boolean;
}

interface Payment {
  id: number;
  amount: number;
  currency_code: string;
  method: string;
  paid_at: string;
  receipt_no: string | null;
  received_by_name: string | null;
}

function PaymentsDialog({ row, onClose }: { row: Layaway; onClose: () => void }) {
  const { data: lk } = useLookups();
  const [f, setF] = useState({ amount: '', currency_code: 'PEN', method: 'cash', receipt_no: '' });
  const { data, refetch } = useQuery({
    queryKey: ['layaway-payments', row.reservation_id],
    queryFn: () => api.get<{ items: Payment[] }>(`/ops/layaways/${row.reservation_id}/payments`),
  });
  const save = useSave(() => api.post(`/ops/layaways/${row.reservation_id}/payments`, f), {
    success: 'Cuota registrada',
    invalidate: [['layaways']],
    onSuccess: () => {
      setF((p) => ({ ...p, amount: '', receipt_no: '' }));
      refetch();
    },
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      size="md"
      title={`Apartado de ${row.customer_name ?? 'cliente'}`}
      description={`${row.product_name} · ${row.sku}`}
      footer={
        <Button variant="outline" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-lg border bg-muted/40 px-4 py-3 text-[13px]">
        <span>
          Pagado: <strong className="tabular">{money(row.paid)}</strong>
        </span>
        <span className="text-muted-foreground">
          {row.payment_count} cuota(s)
          {row.last_payment_at && ` · última ${dateTime(row.last_payment_at)}`}
        </span>
      </div>

      {row.status === 'active' && (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto]">
          <Field label="Monto" error={save.fields.amount}>
            <Input value={f.amount} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} inputMode="decimal" />
          </Field>
          <Field label="Moneda">
            <Select value={f.currency_code} onChange={(e) => setF((p) => ({ ...p, currency_code: e.target.value }))}>
              {lk?.currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Forma de pago">
            <Select value={f.method} onChange={(e) => setF((p) => ({ ...p, method: e.target.value }))}>
              {PaymentMethod.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button loading={save.isPending} onClick={() => save.mutate(undefined)} disabled={!f.amount}>
              Cobrar
            </Button>
          </div>
        </div>
      )}

      <ul className="mt-5 divide-y rounded-lg border">
        {data?.items.length === 0 && (
          <li className="px-4 py-3 text-[13px] text-muted-foreground">Sin cuotas registradas.</li>
        )}
        {data?.items.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
            <Coins className="size-3.5 text-muted-foreground" />
            <span className="tabular font-medium">{money(p.amount, p.currency_code)}</span>
            <Badge tone="neutral">{PaymentMethod.label(p.method as never)}</Badge>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {dateTime(p.paid_at)}
              {p.received_by_name && ` · ${p.received_by_name}`}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        Las cuotas no se editan ni se borran: una cuota mal cargada se corrige con otra.
      </p>
    </Dialog>
  );
}

export function LayawaysPage() {
  const [open, setOpen] = useState<Layaway | null>(null);
  const [expiring, setExpiring] = useState(false);
  const { data, isFetching } = useQuery({
    queryKey: ['layaways'],
    queryFn: () => api.get<{ items: Layaway[] }>('/ops/layaways'),
  });
  const expire = useSave(() => api.post<{ expired: number }>('/ops/layaways/expire'), {
    invalidate: [['layaways'], ['stock']],
    onSuccess: () => setExpiring(false),
  });

  const overdue = data?.items.filter((r) => r.is_overdue).length ?? 0;

  return (
    <>
      <PageHeader
        title="Apartados"
        description="Piezas separadas para un cliente, con sus cuotas. La reserva no deja venderlas mientras esté activa."
        meta={overdue > 0 ? <Badge tone="danger">{overdue} vencido(s)</Badge> : null}
        actions={
          overdue > 0 && (
            <Button variant="outline" onClick={() => setExpiring(true)}>
              <CalendarClock /> Liberar vencidos
            </Button>
          )
        }
      />
      <Card>
        <DataTable
          rows={data?.items}
          loading={isFetching}
          rowKey={(r) => r.reservation_id}
          onRowClick={(r) => setOpen(r)}
          columns={[
            {
              key: 'c',
              header: 'Cliente',
              cell: (r) => (
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{r.customer_name ?? '—'}</div>
                  <div className="truncate text-xs text-muted-foreground">{r.customer_phone}</div>
                </div>
              ),
            },
            {
              key: 'p',
              header: 'Artículo',
              cell: (r) => (
                <div className="min-w-0">
                  <div className="truncate text-[13px]">{r.product_name}</div>
                  <Mono className="text-muted-foreground">{r.sku}</Mono>
                </div>
              ),
            },
            { key: 'q', header: 'Cant.', align: 'right', cell: (r) => <span className="tabular">{qty(r.quantity)}</span> },
            { key: 'l', header: 'Sede', cell: (r) => r.location, className: 'hidden md:table-cell' },
            {
              key: 'pa',
              header: 'Pagado',
              align: 'right',
              cell: (r) => <span className="tabular font-medium">{money(r.paid)}</span>,
            },
            {
              key: 'n',
              header: 'Cuotas',
              align: 'right',
              cell: (r) => <span className="tabular">{r.payment_count}</span>,
              className: 'hidden sm:table-cell',
            },
            {
              key: 'v',
              header: 'Vence',
              cell: (r) =>
                r.expires_at ? (
                  <Badge tone={r.is_overdue ? 'danger' : 'neutral'}>{dateTime(r.expires_at)}</Badge>
                ) : (
                  <span className="text-muted-foreground">sin plazo</span>
                ),
            },
            {
              key: 's',
              header: 'Estado',
              cell: (r) => (
                <Badge tone={r.status === 'active' ? 'info' : r.status === 'fulfilled' ? 'success' : 'neutral'}>
                  {r.status === 'active'
                    ? 'Activo'
                    : r.status === 'fulfilled'
                      ? 'Entregado'
                      : r.status === 'expired'
                        ? 'Vencido'
                        : 'Anulado'}
                </Badge>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon={Wallet}
              title="Sin apartados"
              description="Un apartado se crea reservando una pieza para un cliente."
            />
          }
        />
      </Card>

      {open && <PaymentsDialog row={open} onClose={() => setOpen(null)} />}
      <Confirm
        open={expiring}
        onOpenChange={setExpiring}
        title="Liberar los apartados vencidos"
        description="Las piezas vuelven a estar disponibles para la venta. Las cuotas cobradas quedan registradas."
        confirmLabel="Liberar"
        loading={expire.isPending}
        onConfirm={() => expire.mutate(undefined)}
      />
    </>
  );
}

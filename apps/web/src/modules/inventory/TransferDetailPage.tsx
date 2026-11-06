import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, PackageCheck, Send, XCircle } from 'lucide-react';
import { TransferPurpose } from '@minitta/shared';
import { api } from '@/lib/api';
import { useSave } from '@/lib/forms';
import { cn, dateTime, qty } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Card, CardHeader, Skeleton } from '@/components/ui/misc';
import { Confirm, DataTable, Mono, PageHeader, Stat, Thumb, TransferStatusBadge } from '@/components/common';

interface TransferDetail {
  id: number;
  code: string;
  status: string;
  purpose: string;
  from_code: string;
  from_name: string;
  to_code: string;
  to_name: string;
  carrier: string | null;
  notes: string | null;
  created_at: string;
  sent_at: string | null;
  received_at: string | null;
  sent_by_name: string | null;
  received_by_name: string | null;
  lines: {
    id: number;
    variant_id: number;
    sku: string;
    product_name: string;
    image_url: string | null;
    serial_code: string | null;
    quantity_sent: number;
    quantity_received: number | null;
  }[];
}

export function TransferDetailPage() {
  const id = Number(useParams().id);
  const { data: t } = useQuery({ queryKey: ['transfer', id], queryFn: () => api.get<TransferDetail>(`/transfers/${id}`) });
  const [confirm, setConfirm] = useState<'send' | 'receive' | 'cancel' | null>(null);
  const [received, setReceived] = useState<Record<number, string>>({});
  useEffect(() => {
    if (t) setReceived(Object.fromEntries(t.lines.map((l) => [l.id, String(l.quantity_received ?? l.quantity_sent)])));
  }, [t?.id, t?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const inv = [['transfer', id], ['transfers'], ['stock'], ['kardex'], ['dashboard'], ['serials']];
  const send = useSave(() => api.post(`/transfers/${id}/send`), { success: 'Transferencia enviada: salió del origen', invalidate: inv, onSuccess: () => setConfirm(null) });
  const receive = useSave(
    () => api.post(`/transfers/${id}/receive`, { lines: Object.entries(received).map(([lid, q]) => ({ id: Number(lid), quantity_received: q || 0 })) }),
    { success: 'Transferencia recibida: entró al destino', invalidate: inv, onSuccess: () => setConfirm(null) },
  );
  const cancel = useSave(() => api.post(`/transfers/${id}/cancel`), { success: 'Transferencia anulada', invalidate: inv, onSuccess: () => setConfirm(null) });

  if (!t) return <Skeleton className="h-72" />;
  const missing = t.lines.reduce((a, l) => a + Math.max(0, l.quantity_sent - Number(received[l.id] ?? l.quantity_sent)), 0);

  return (
    <>
      <PageHeader
        back={{ to: '/inventario/transferencias', label: 'Transferencias' }}
        title={<Mono className="text-[22px]">{t.code}</Mono>}
        meta={<TransferStatusBadge status={t.status} />}
        actions={
          <>
            {t.status === 'draft' && (
              <>
                <Button variant="outline" onClick={() => setConfirm('cancel')}>
                  <XCircle /> Anular
                </Button>
                <Button onClick={() => setConfirm('send')}>
                  <Send /> Enviar
                </Button>
              </>
            )}
            {t.status === 'sent' && (
              <Button variant="gold" onClick={() => setConfirm('receive')}>
                <PackageCheck /> Confirmar recepción
              </Button>
            )}
          </>
        }
      />
      <div className="mb-5 grid gap-4 rounded-xl border bg-card px-5 py-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex items-center gap-3 lg:col-span-2">
          <div>
            <div className="text-xs text-muted-foreground">Desde</div>
            <div className="font-medium">
              <Mono>{t.from_code}</Mono> {t.from_name}
            </div>
          </div>
          <ArrowRight className="size-4 text-gold" />
          <div>
            <div className="text-xs text-muted-foreground">Hacia</div>
            <div className="font-medium">
              <Mono>{t.to_code}</Mono> {t.to_name}
            </div>
          </div>
        </div>
        <Stat label="Motivo" value={TransferPurpose.label(t.purpose as never)} />
        <Stat label="Enviada" value={t.sent_at ? `${dateTime(t.sent_at)} · ${t.sent_by_name}` : '—'} />
        <Stat label="Recibida" value={t.received_at ? `${dateTime(t.received_at)} · ${t.received_by_name}` : '—'} />
      </div>

      <Card>
        <CardHeader
          title="Artículos"
          description={t.status === 'sent' ? 'Indique lo que llegó. Lo que falte vuelve al origen como ajuste, con nota.' : `${t.lines.length} líneas`}
        />
        <DataTable
          rows={t.lines}
          rowKey={(l) => l.id}
          columns={[
            {
              key: 'p',
              header: 'Artículo',
              cell: (l) => (
                <div className="flex items-center gap-2.5">
                  <Thumb src={l.image_url} size={32} />
                  <div>
                    <div className="font-medium">{l.product_name}</div>
                    <div className="text-xs text-muted-foreground">
                      <Mono>{l.sku}</Mono>
                      {l.serial_code && ` · pieza ${l.serial_code}`}
                    </div>
                  </div>
                </div>
              ),
            },
            { key: 's', header: 'Enviado', align: 'right', cell: (l) => <span className="tabular font-medium">{qty(l.quantity_sent)}</span> },
            {
              key: 'r',
              header: 'Recibido',
              align: 'right',
              cell: (l) =>
                t.status === 'sent' ? (
                  <Input
                    className="ml-auto w-24 text-right"
                    value={received[l.id] ?? ''}
                    onChange={(e) => setReceived({ ...received, [l.id]: e.target.value })}
                    inputMode="decimal"
                  />
                ) : (
                  <span className={cn('tabular', l.quantity_received != null && l.quantity_received < l.quantity_sent && 'font-semibold text-warning')}>
                    {l.quantity_received != null ? qty(l.quantity_received) : '—'}
                  </span>
                ),
            },
          ]}
        />
      </Card>
      {t.notes && <p className="mt-3 text-[13px] text-muted-foreground">Notas: {t.notes}</p>}

      <Confirm
        open={confirm === 'send'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="¿Enviar la transferencia?"
        description={`Se descuenta el stock de ${t.from_code} y queda en tránsito hacia ${t.to_code}. No se puede deshacer: si hay un error, se corrige con otra transferencia.`}
        confirmLabel="Enviar"
        loading={send.isPending}
        onConfirm={() => send.mutate(undefined)}
      />
      <Confirm
        open={confirm === 'receive'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="¿Confirmar la recepción?"
        description={
          missing > 0
            ? `Faltan ${qty(missing)} unidades: quedan registradas como faltante y vuelven a ${t.from_code} con un ajuste.`
            : `Todo llegó completo a ${t.to_code}.`
        }
        confirmLabel="Confirmar recepción"
        loading={receive.isPending}
        onConfirm={() => receive.mutate(undefined)}
      />
      <Confirm
        open={confirm === 'cancel'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="¿Anular la transferencia?"
        description="Está en borrador: no movió stock. Queda registrada como anulada."
        confirmLabel="Anular"
        destructive
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate(undefined)}
      />
    </>
  );
}

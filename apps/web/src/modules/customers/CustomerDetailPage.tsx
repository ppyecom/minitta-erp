import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Cake, HandCoins, Pencil, Wallet } from 'lucide-react';
import { DocumentType } from '@minitta/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { money, relative } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, Skeleton } from '@/components/ui/misc';
import { DataTable, EmptyState, Mono, PageHeader, Stat } from '@/components/common';
import { CustomerDialog } from './CustomerDialog';
import type { CustomerDetail } from './types';

const date = (v: string | null) =>
  v ? new Date(v).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

export function CustomerDetailPage() {
  const { id } = useParams();
  const { can } = useSession();
  const [editing, setEditing] = useState(false);

  const { data: c, isLoading } = useQuery({
    queryKey: ['customer', Number(id)],
    queryFn: () => api.get<CustomerDetail>(`/customers/${id}`),
  });

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (!c) return <EmptyState icon={HandCoins} title="Cliente no encontrado" />;

  return (
    <>
      <PageHeader
        title={c.name}
        description={
          <>
            {c.code}
            {c.document_type !== 'none' && ` · ${DocumentType.label(c.document_type)} ${c.document_number}`}
            {c.trade_name && ` · ${c.trade_name}`}
            {!c.is_active && ' · inactivo'}
          </>
        }
        actions={
          can('customers.write') && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Editar
            </Button>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Teléfono" value={c.phone ?? '—'} />
            <Stat label="Otro teléfono" value={c.phone_alt ?? '—'} />
            <Stat label="Correo" value={c.email ?? '—'} />
            <Stat label="Ciudad" value={c.city ?? '—'} />
            <Stat
              label={
                <span className="inline-flex items-center gap-1">
                  <Cake className="size-3" /> Cumpleaños
                </span>
              }
              value={date(c.birth_date)}
            />
            <Stat label="Cliente desde" value={date(c.created_at)} />
          </div>
          {c.address_line && (
            <p className="mt-4 text-sm text-muted-foreground">{c.address_line}</p>
          )}
          {c.notes && <p className="mt-2 text-sm">{c.notes}</p>}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold">Lo que tiene con nosotros</h2>
          <div className="mt-3 space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Piezas en custodia</span>
              <span className="font-medium">
                {c.custody_open > 0 ? (
                  <Badge tone="warning">{c.custody_open} abierta(s)</Badge>
                ) : (
                  <span className="text-muted-foreground">ninguna</span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Apartados activos</span>
              <span className="font-medium">
                {c.layaway_active > 0 ? (
                  <Badge tone="info">{c.layaway_active}</Badge>
                ) : (
                  <span className="text-muted-foreground">ninguno</span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Pagado en apartados</span>
              <span className="tabular font-medium">{money(c.layaway_paid)}</span>
            </div>
            <div className="flex items-center justify-between border-t pt-2.5">
              <span className="text-muted-foreground">Histórico</span>
              <span className="text-xs text-muted-foreground">
                {c.custody_total} custodia(s) · {c.layaway_total} apartado(s)
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Última vez</span>
              <span className="text-xs">{c.last_activity ? relative(c.last_activity) : '—'}</span>
            </div>
          </div>
        </Card>
      </div>

      <section className="mt-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <HandCoins className="size-4 text-gold" /> Piezas en custodia
        </h2>
        <Card className="mt-2">
          <DataTable
            rows={c.custody}
            rowKey={(r) => r.id}
            columns={[
              {
                key: 'c',
                header: 'Etiqueta',
                cell: (r) => (
                  <Link to={`/procesos/custodia/${r.id}`} className="font-medium hover:underline">
                    <Mono>{r.code}</Mono>
                  </Link>
                ),
              },
              { key: 'd', header: 'Pieza', cell: (r) => r.description },
              { key: 'p', header: 'Peso', cell: (r) => <span className="tabular">{r.received_weight_g} g</span> },
              { key: 'l', header: 'Dónde', cell: (r) => r.location_name, className: 'hidden md:table-cell' },
              {
                key: 's',
                header: 'Estado',
                cell: (r) =>
                  r.status === 'delivered' ? (
                    <Badge tone="success" dot>
                      Entregada
                    </Badge>
                  ) : r.is_overdue ? (
                    <Badge tone="danger" dot>
                      Vencida
                    </Badge>
                  ) : (
                    <Badge tone="warning" dot>
                      En custodia
                    </Badge>
                  ),
              },
              {
                key: 'f',
                header: 'Recibida',
                cell: (r) => <span className="text-muted-foreground">{relative(r.received_at)}</span>,
                className: 'hidden lg:table-cell',
              },
            ]}
            empty={<EmptyState icon={HandCoins} title="Nunca dejó una pieza" />}
          />
        </Card>
      </section>

      <section className="mt-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Wallet className="size-4 text-gold" /> Apartados
        </h2>
        <Card className="mt-2">
          <DataTable
            rows={c.layaways}
            rowKey={(r) => r.id}
            columns={[
              { key: 's', header: 'SKU', cell: (r) => <Mono>{r.sku}</Mono> },
              { key: 'p', header: 'Producto', cell: (r) => r.product_name },
              { key: 'q', header: 'Cant.', cell: (r) => <span className="tabular">{r.quantity}</span> },
              { key: 'd', header: 'Adelanto', cell: (r) => <span className="tabular">{money(r.deposit)}</span> },
              { key: 'g', header: 'Pagado', cell: (r) => <span className="tabular font-medium">{money(r.paid)}</span> },
              {
                key: 'e',
                header: 'Estado',
                cell: (r) =>
                  r.status === 'active' ? (
                    <Badge tone="info" dot>
                      Activo
                    </Badge>
                  ) : (
                    <Badge dot>{r.status}</Badge>
                  ),
              },
              {
                key: 'v',
                header: 'Vence',
                cell: (r) => <span className="text-muted-foreground">{date(r.expires_at)}</span>,
                className: 'hidden lg:table-cell',
              },
            ]}
            empty={<EmptyState icon={Wallet} title="Nunca apartó nada" />}
          />
        </Card>
      </section>

      <CustomerDialog customer={c} open={editing} onOpenChange={setEditing} />
    </>
  );
}

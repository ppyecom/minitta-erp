import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Cake, Plus, Users } from 'lucide-react';
import { DocumentType } from '@minitta/shared';
import { api, qs } from '@/lib/api';
import { useSession } from '@/lib/session';
import { relative } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, Segmented } from '@/components/ui/misc';
import { DataTable, EmptyState, Mono, PageHeader, Pagination, SearchInput } from '@/components/common';
import { CustomerDialog } from './CustomerDialog';
import type { CustomerRow } from './types';

const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

export function CustomersPage() {
  const { can } = useSession();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'todos' | 'abiertos'>('todos');
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: ['customers', q, page, filter],
    queryFn: () =>
      api.get<{ items: CustomerRow[]; total: number; pageSize: number }>(
        `/customers${qs({ q, page, with_open: filter === 'abiertos' ? 1 : '' })}`,
      ),
  });

  const month = new Date().getMonth() + 1;
  const birthdays = useQuery({
    queryKey: ['customers', 'birthdays', month],
    queryFn: () =>
      api.get<{ id: number; code: string; name: string; phone: string | null; day: number }[]>(
        `/customers/birthdays${qs({ month })}`,
      ),
  });

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Uno solo para todo el ERP: la misma persona en custodia, en un apartado y en una venta es la misma ficha."
        actions={
          can('customers.write') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Nuevo cliente
            </Button>
          )
        }
      />

      {birthdays.data && birthdays.data.length > 0 && (
        <Card className="mb-4 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Cake className="size-4 text-gold" /> Cumpleaños de {MONTHS[month - 1]}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {birthdays.data.map((b) => (
              <button
                key={b.id}
                onClick={() => navigate(`/clientes/${b.id}`)}
                className="rounded-full border bg-card px-2.5 py-1 text-xs transition-colors hover:bg-accent"
              >
                <span className="font-medium">{b.day}</span> · {b.name}
                {b.phone && <span className="text-muted-foreground"> · {b.phone}</span>}
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="Nombre, teléfono o documento…"
          className="max-w-sm flex-1"
        />
        <Segmented
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
          options={[
            { value: 'todos', label: 'Todos' },
            { value: 'abiertos', label: 'Con algo abierto' },
          ]}
        />
      </div>

      <Card>
        <DataTable
          rows={list.data?.items}
          loading={list.isLoading}
          rowKey={(r) => r.customer_id}
          onRowClick={(r) => navigate(`/clientes/${r.customer_id}`)}
          columns={[
            {
              key: 'n',
              header: 'Cliente',
              cell: (r) => (
                <div className="flex items-center gap-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gold-soft text-xs font-semibold text-gold-foreground">
                    {r.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.code}
                      {r.trade_name && ` · ${r.trade_name}`}
                    </div>
                  </div>
                  {!r.is_active && <Badge>Inactivo</Badge>}
                </div>
              ),
            },
            {
              key: 'd',
              header: 'Documento',
              cell: (r) =>
                r.document_type === 'none' ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="text-xs">
                    {DocumentType.label(r.document_type)} <Mono>{r.document_number}</Mono>
                  </span>
                ),
            },
            {
              key: 'c',
              header: 'Contacto',
              cell: (r) => (
                <span className="text-xs text-muted-foreground">
                  {r.phone ?? '—'}
                  {r.city && ` · ${r.city}`}
                </span>
              ),
              className: 'hidden md:table-cell',
            },
            {
              key: 'o',
              header: 'Abierto',
              cell: (r) =>
                r.open_items === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <div className="flex gap-1">
                    {r.custody_open > 0 && <Badge tone="warning">{r.custody_open} en custodia</Badge>}
                    {r.layaway_active > 0 && <Badge tone="info">{r.layaway_active} apartado(s)</Badge>}
                  </div>
                ),
            },
            {
              key: 'a',
              header: 'Última vez',
              cell: (r) => (
                <span className="text-muted-foreground">
                  {r.last_activity ? relative(r.last_activity) : '—'}
                </span>
              ),
              className: 'hidden lg:table-cell',
            },
          ]}
          empty={
            <EmptyState
              icon={Users}
              title={q ? `Ningún cliente con «${q}»` : 'Todavía no hay clientes'}
              description={
                q
                  ? 'Pruebe con parte del nombre, el teléfono o el número de documento.'
                  : 'Se crean al recibir una pieza en custodia o al hacer un apartado, o desde acá.'
              }
            />
          }
        />
        {list.data && (
          <Pagination
            page={page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            onPage={setPage}
          />
        )}
      </Card>

      <CustomerDialog customer={null} open={creating} onOpenChange={setCreating} />
    </>
  );
}

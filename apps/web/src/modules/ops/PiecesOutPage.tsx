import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, PackageSearch } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { date, dateTime } from '@/lib/utils';
import { Badge, Card, Segmented } from '@/components/ui/misc';
import { DataTable, EmptyState, Mono, PageHeader } from '@/components/common';

interface PieceOut {
  kind: string;
  reference: string;
  detail: string;
  location: string;
  responsible: string | null;
  since: string;
  days_out: number;
  due_on: string | null;
  is_overdue: boolean;
}

interface Summary {
  kind: string;
  items: number;
  overdue: number;
  max_days: number;
}

const TONES: Record<string, 'gold' | 'info' | 'warning' | 'neutral'> = {
  custodia: 'gold',
  taller: 'info',
  consignación: 'warning',
  exhibición: 'warning',
  tránsito: 'neutral',
};

/**
 * La pregunta que el ERP viejo no podía contestar: ¿dónde está todo?
 * Una fila por cada cosa que en este momento no está en una sede.
 */
export function PiecesOutPage() {
  const [sp, setSp] = useSearchParams();
  const kind = sp.get('tipo') ?? '';
  const overdue = sp.get('vencidos') === '1';

  const { data, isFetching } = useQuery({
    queryKey: ['pieces-out', kind, overdue],
    queryFn: () =>
      api.get<{ items: PieceOut[]; summary: Summary[] }>(
        `/ops/pieces-out${qs({ kind, overdue: overdue ? '1' : '' })}`,
      ),
    refetchInterval: 60_000,
  });

  const upd = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };

  const totalOverdue = data?.summary.reduce((a, s) => a + s.overdue, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Dónde está todo"
        description="Mercadería y piezas de clientes que en este momento no están en una sede."
        meta={
          totalOverdue > 0 ? (
            <Badge tone="danger">
              <AlertTriangle /> {totalOverdue} fuera de plazo
            </Badge>
          ) : null
        }
      />

      {data && data.summary.length > 0 && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.summary.map((s) => (
            <Card key={s.kind} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <Badge tone={TONES[s.kind] ?? 'neutral'}>{s.kind}</Badge>
                {s.overdue > 0 && <Badge tone="danger">{s.overdue} vencida(s)</Badge>}
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="tabular text-2xl font-semibold">{s.items}</span>
                <span className="text-[13px] text-muted-foreground">
                  {s.max_days > 0 ? `hasta ${s.max_days} día(s) afuera` : 'desde hoy'}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <Segmented
            value={kind}
            onChange={(v) => upd('tipo', v)}
            options={[
              { value: '', label: 'Todo' },
              { value: 'custodia', label: 'Custodia' },
              { value: 'taller', label: 'Taller' },
              { value: 'consignación', label: 'Consignación' },
              { value: 'tránsito', label: 'Tránsito' },
            ]}
          />
          <Segmented
            value={overdue ? '1' : ''}
            onChange={(v) => upd('vencidos', v)}
            options={[
              { value: '', label: 'Todas' },
              { value: '1', label: 'Solo vencidas' },
            ]}
          />
        </div>
        <DataTable
          rows={data?.items}
          loading={isFetching}
          rowKey={(r) => `${r.kind}-${r.reference}-${r.detail}`}
          columns={[
            {
              key: 'k',
              header: 'Tipo',
              cell: (r) => <Badge tone={TONES[r.kind] ?? 'neutral'}>{r.kind}</Badge>,
            },
            { key: 'r', header: 'Documento', cell: (r) => <Mono className="font-medium">{r.reference}</Mono> },
            { key: 'd', header: 'Qué', cell: (r) => <span className="text-[13px]">{r.detail}</span> },
            { key: 'l', header: 'Dónde está', cell: (r) => r.location, className: 'hidden md:table-cell' },
            {
              key: 'u',
              header: 'Responsable',
              cell: (r) => <span className="text-muted-foreground">{r.responsible ?? '—'}</span>,
              className: 'hidden lg:table-cell',
            },
            {
              key: 's',
              header: 'Desde',
              cell: (r) => <span className="text-muted-foreground">{dateTime(r.since)}</span>,
              className: 'hidden lg:table-cell',
            },
            {
              key: 'dd',
              header: 'Días',
              align: 'right',
              cell: (r) => <span className="tabular">{r.days_out}</span>,
            },
            {
              key: 'v',
              header: 'Vence',
              cell: (r) =>
                r.due_on ? (
                  <Badge tone={r.is_overdue ? 'danger' : 'neutral'}>{date(r.due_on)}</Badge>
                ) : (
                  <span className="text-muted-foreground">sin plazo</span>
                ),
            },
          ]}
          empty={
            <EmptyState
              icon={PackageSearch}
              title="Todo está en su sede"
              description="No hay piezas en taller, en custodia, en consignación ni en tránsito."
            />
          }
        />
      </Card>
    </>
  );
}

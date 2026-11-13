import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList } from 'lucide-react';
import { PendingReason } from '@minitta/shared';
import { api, qs } from '@/lib/api';
import { grams, money } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, Segmented } from '@/components/ui/misc';
import { DataTable, EmptyState, Mono, PageHeader, Pagination, SearchInput, Thumb } from '@/components/common';

interface Row {
  variant_id: number;
  sku: string;
  legacy_code: string | null;
  product_id: number;
  product_code: string;
  product_name: string;
  product_status: string;
  material_name: string | null;
  category_name: string | null;
  weight_g: number | null;
  price: number | null;
  image_url: string | null;
  reasons: string[];
  blocks_sale: boolean;
}

interface Resp {
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
  summary: { reason: string; items: number; blocking: number }[];
  totals: { pending: number; blocking: number; sellable: number };
}

/**
 * Lo que el personal tiene que completar. La migración trae del ERP viejo lo que
 * está bien formado; lo dudoso entra como borrador y aparece acá con el motivo.
 * Cuando alguien carga el dato, la fila desaparece sola.
 */
export function PendingPage() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const reason = sp.get('motivo') ?? '';
  const blocking = sp.get('bloquean') === '1';
  const q = sp.get('q') ?? '';
  const page = Number(sp.get('page') ?? 1);

  const { data, isFetching } = useQuery({
    queryKey: ['pending', reason, blocking, q, page],
    queryFn: () => api.get<Resp>(`/pending${qs({ reason, blocking: blocking ? '1' : '', q, page })}`),
    placeholderData: keepPreviousData,
  });

  const upd = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    n.delete('page');
    setSp(n, { replace: true });
  };

  const t = data?.totals;

  return (
    <>
      <PageHeader
        title="Pendientes de completar"
        description="Artículos que entraron del sistema viejo sin algún dato. Al cargarlo, la fila se va sola de esta lista."
        meta={
          t ? (
            <>
              <Badge tone={t.blocking > 0 ? 'danger' : 'neutral'}>{t.blocking} no se pueden vender</Badge>
              <Badge tone="neutral">{t.pending} por completar</Badge>
              <Badge tone="success">{t.sellable} listos</Badge>
            </>
          ) : null
        }
      />

      {data && data.summary.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {data.summary.map((s) => (
            <button
              key={s.reason}
              onClick={() => upd('motivo', reason === s.reason ? '' : s.reason)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent ${
                reason === s.reason ? 'border-gold bg-gold-soft/50' : 'bg-card'
              }`}
            >
              <div className="text-[13px] font-medium">{PendingReason.label(s.reason as never)}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                <span className="tabular">{s.items}</span> artículo(s)
                {s.blocking > 0 && ` · ${s.blocking} bloqueado(s)`}
              </div>
            </button>
          ))}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <Segmented
            value={blocking ? '1' : ''}
            onChange={(v) => upd('bloquean', v)}
            options={[
              { value: '', label: 'Todos' },
              { value: '1', label: 'Solo los que no se pueden vender' },
            ]}
          />
          <SearchInput className="w-64" value={q} onChange={(v) => upd('q', v)} placeholder="SKU, nombre, código viejo…" />
          {reason && (
            <Button variant="ghost" size="sm" onClick={() => upd('motivo', '')}>
              Quitar filtro: {PendingReason.label(reason as never)}
            </Button>
          )}
        </div>

        <DataTable
          rows={data?.items}
          loading={isFetching}
          rowKey={(r) => r.variant_id}
          onRowClick={(r) => nav(`/catalogo/productos/${r.product_id}`)}
          columns={[
            {
              key: 'p',
              header: 'Artículo',
              cell: (r) => (
                <div className="flex items-center gap-3">
                  <Thumb src={r.image_url} size={32} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">{r.product_name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      <Mono>{r.sku}</Mono>
                      {r.legacy_code && ` · viejo: ${r.legacy_code}`}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              key: 'r',
              header: 'Qué le falta',
              cell: (r) => (
                <div className="flex flex-wrap gap-1">
                  {r.reasons.map((x) => (
                    <Badge key={x} tone={x === 'peso_vs_precio' ? 'warning' : 'neutral'}>
                      {PendingReason.label(x as never)}
                    </Badge>
                  ))}
                </div>
              ),
            },
            {
              key: 'w',
              header: 'Peso',
              align: 'right',
              cell: (r) => (r.weight_g ? <span className="tabular">{grams(r.weight_g)}</span> : <span className="text-muted-foreground">—</span>),
              className: 'hidden md:table-cell',
            },
            {
              key: 'pr',
              header: 'Precio',
              align: 'right',
              cell: (r) => (r.price != null ? money(r.price) : <span className="text-muted-foreground">—</span>),
              className: 'hidden md:table-cell',
            },
            {
              key: 's',
              header: '',
              cell: (r) => (r.blocks_sale ? <Badge tone="danger">No se vende</Badge> : null),
            },
          ]}
          empty={
            <EmptyState
              icon={q || reason ? ClipboardList : CheckCircle2}
              title={q || reason ? 'Nada con ese filtro' : 'No queda nada por completar'}
              description={
                q || reason
                  ? 'Probá quitando el filtro.'
                  : 'Todos los artículos tienen peso, precio, material, categoría y foto.'
              }
            />
          }
        />
        {data && data.total > 0 && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => upd('page', String(p))} />
        )}
      </Card>
    </>
  );
}

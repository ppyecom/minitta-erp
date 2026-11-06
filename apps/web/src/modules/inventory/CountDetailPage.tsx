import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCheck, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { useLookups } from '@/lib/lookups';
import { useSave } from '@/lib/forms';
import { cn, dateTime, qty } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, Segmented, Skeleton } from '@/components/ui/misc';
import { Confirm, CountStatusBadge, EmptyState, Mono, PageHeader, Pagination, SearchInput, Stat, Thumb } from '@/components/common';

interface Line {
  id: number;
  variant_id: number;
  sku: string;
  legacy_code: string | null;
  product_name: string;
  image_url: string | null;
  tracking_mode: string;
  size_label: string | null;
  system_qty: number;
  counted_qty: number | null;
  difference: number | null;
  reason_code: string | null;
}
interface CountDetail {
  id: number;
  code: string;
  status: string;
  is_opening: boolean;
  location_id: number;
  location_code: string;
  location_name: string;
  created_by_name: string;
  approved_by_name: string | null;
  started_at: string;
  applied_at: string | null;
  summary: { lines: number; counted: number; serial_lines: number; differences: number; surplus: number; shortage: number };
  lines: { items: Line[]; total: number; page: number; pageSize: number };
}

/** Una fila de conteo: se escribe la cantidad y Enter guarda y salta a la siguiente. */
function CountInput({ countId, line, editable, onSaved }: { countId: number; line: Line; editable: boolean; onSaved: (id: number) => void }) {
  const [v, setV] = useState(line.counted_qty != null ? String(line.counted_qty) : '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setV(line.counted_qty != null ? String(line.counted_qty) : ''), [line.counted_qty]);

  const commit = async () => {
    const next = v.trim() === '' ? null : Number(v);
    if (next === line.counted_qty || (next !== null && Number.isNaN(next))) return;
    setState('saving');
    try {
      await api.put(`/counts/${countId}/lines/${line.id}`, { counted_qty: next, reason_code: line.reason_code });
      setState('saved');
      qc.invalidateQueries({ queryKey: ['count', countId] });
      onSaved(line.id);
    } catch (e) {
      setState('idle');
      toast.error((e as Error).message);
    }
  };

  if (line.tracking_mode === 'serial') {
    return (
      <Link to={`/inventario/piezas?variant=${line.variant_id}`} className="text-xs text-gold-foreground hover:underline">
        Por pieza →
      </Link>
    );
  }
  return (
    <div className="relative ml-auto w-28">
      <input
        ref={ref}
        data-count-input
        disabled={!editable}
        value={v}
        inputMode="decimal"
        onChange={(e) => {
          setV(e.target.value);
          setState('idle');
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const all = Array.from(document.querySelectorAll<HTMLInputElement>('[data-count-input]:not(:disabled)'));
            const i = all.indexOf(ref.current!);
            all[i + 1]?.focus();
            all[i + 1]?.select();
          }
        }}
        className={cn(
          'h-8 w-full rounded-md border border-input bg-card pr-7 text-right text-sm tabular-nums shadow-xs outline-none transition-[border,box-shadow] focus:border-ring focus:ring-[3px] focus:ring-ring/25 disabled:opacity-60',
          line.counted_qty != null && 'border-success/50 bg-success-soft/40',
        )}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
        {state === 'saving' ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : line.counted_qty != null ? (
          <Check className="size-3.5 text-success" />
        ) : null}
      </span>
    </div>
  );
}

export function CountDetailPage() {
  const id = Number(useParams().id);
  const { data: lk } = useLookups();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'' | 'pending' | 'diff' | 'counted'>('');
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<'apply' | 'cancel' | null>(null);
  const { data: c } = useQuery({
    queryKey: ['count', id, q, filter, page],
    queryFn: () => api.get<CountDetail>(`/counts/${id}${qs({ q, filter, page })}`),
    placeholderData: keepPreviousData,
  });
  const inv = [['count', id], ['counts'], ['stock'], ['kardex'], ['dashboard']];
  const apply = useSave(() => api.post<{ movements: number }>(`/counts/${id}/apply`), {
    invalidate: inv,
    onSuccess: (r) => {
      setConfirm(null);
      toast.success(`Conteo aplicado: ${r.movements} movimiento(s) generados en el kardex`);
    },
  });
  const cancel = useSave(() => api.post(`/counts/${id}/cancel`), { success: 'Conteo anulado', invalidate: inv, onSuccess: () => setConfirm(null) });
  const setReason = useSave((b: { line: Line; reason: string }) => api.put(`/counts/${id}/lines/${b.line.id}`, { counted_qty: b.line.counted_qty, reason_code: b.reason }), {
    invalidate: [['count', id]],
  });

  if (!c) return <Skeleton className="h-96" />;
  const editable = c.status === 'open' || c.status === 'counting';
  const s = c.summary;
  const countable = s.lines - s.serial_lines;
  const reasons = lk?.reasons.filter((r) => r.type === (c.is_opening ? 'opening' : 'count')) ?? [];

  return (
    <>
      <PageHeader
        back={{ to: '/inventario/conteos', label: 'Inventario físico' }}
        title={<Mono className="text-[22px]">{c.code}</Mono>}
        description={`${c.location_code} · ${c.location_name} — abierto por ${c.created_by_name}, ${dateTime(c.started_at)}`}
        meta={
          <>
            <CountStatusBadge status={c.status} />
            {c.is_opening && <Badge tone="gold">Apertura</Badge>}
          </>
        }
        actions={
          editable && (
            <>
              <Button variant="outline" onClick={() => setConfirm('cancel')}>
                <XCircle /> Anular
              </Button>
              <Button variant="gold" onClick={() => setConfirm('apply')} disabled={!s.counted}>
                <CheckCheck /> Aplicar conteo
              </Button>
            </>
          )
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 rounded-xl border bg-card px-5 py-4 sm:grid-cols-5">
        <div className="col-span-2 sm:col-span-1">
          <div className="text-xs text-muted-foreground">Avance</div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-gold transition-[width]" style={{ width: `${countable ? (s.counted / countable) * 100 : 0}%` }} />
            </div>
            <span className="tabular text-[13px] font-medium">
              {s.counted}/{countable}
            </span>
          </div>
        </div>
        <Stat label="Con diferencia" value={s.differences} />
        <Stat label="Sobrante" value={<span className="text-success">+{qty(s.surplus)}</span>} />
        <Stat label="Faltante" value={<span className="text-destructive">{qty(s.shortage)}</span>} />
        <Stat label="Serializadas" value={`${s.serial_lines} (por pieza)`} />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Escanear código de barras o buscar"
            autoFocus
          />
          <Segmented
            value={filter}
            onChange={(v) => {
              setFilter(v);
              setPage(1);
            }}
            options={[
              { value: '', label: 'Todas' },
              { value: 'pending', label: 'Pendientes' },
              { value: 'diff', label: 'Con diferencia' },
              { value: 'counted', label: 'Contadas' },
            ]}
          />
          {editable && <span className="ml-auto text-xs text-muted-foreground">Enter guarda y pasa a la siguiente</span>}
        </div>
        {c.lines.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b bg-muted/40 text-[11.5px] uppercase tracking-wide text-muted-foreground">
                  <th className="h-9 pl-5 text-left font-medium">Artículo</th>
                  <th className="px-3 text-right font-medium">{c.is_opening ? 'Sistema viejo' : 'Sistema'}</th>
                  <th className="px-3 text-right font-medium">Contado</th>
                  <th className="px-3 text-right font-medium">Diferencia</th>
                  <th className="hidden px-3 pr-5 text-left font-medium md:table-cell">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {c.lines.items.map((l) => (
                  <tr key={l.id} className={cn('border-b last:border-0', l.counted_qty == null && l.tracking_mode !== 'serial' && 'bg-card', l.difference && 'bg-warning-soft/30')}>
                    <td className="py-2 pl-5">
                      <div className="flex items-center gap-2.5">
                        <Thumb src={l.image_url} size={30} />
                        <div className="min-w-0">
                          <div className="max-w-72 truncate font-medium">{l.product_name}</div>
                          <div className="text-xs text-muted-foreground">
                            <Mono>{l.sku}</Mono>
                            {l.legacy_code && ` · ${l.legacy_code}`}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="tabular px-3 text-right text-muted-foreground">{qty(l.system_qty)}</td>
                    <td className="px-3 py-1.5">
                      <CountInput countId={id} line={l} editable={editable} onSaved={() => undefined} />
                    </td>
                    <td className="px-3 text-right">
                      {l.difference != null && l.difference !== 0 ? (
                        <span className={cn('tabular font-semibold', l.difference > 0 ? 'text-success' : 'text-destructive')}>
                          {l.difference > 0 ? '+' : ''}
                          {qty(l.difference)}
                        </span>
                      ) : l.difference === 0 ? (
                        <span className="text-xs text-muted-foreground">cuadra</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="hidden px-3 pr-5 md:table-cell">
                      {l.difference ? (
                        <select
                          disabled={!editable}
                          value={l.reason_code ?? ''}
                          onChange={(e) => setReason.mutate({ line: l, reason: e.target.value })}
                          className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                        >
                          <option value="">Sin motivo</option>
                          {reasons.map((r) => (
                            <option key={r.code} value={r.code}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin líneas con este filtro" description={s.lines === 0 ? 'No hay variantes activas en el alcance de este conteo.' : undefined} />
        )}
        {c.lines.total > c.lines.pageSize && (
          <Pagination page={c.lines.page} pageSize={c.lines.pageSize} total={c.lines.total} onPage={setPage} />
        )}
      </Card>

      <Confirm
        open={confirm === 'apply'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="¿Aplicar el conteo?"
        description={`${s.differences} línea(s) con diferencia se convierten en movimientos ${c.is_opening ? 'de apertura' : 'de inventario'}, firmados por usted. Las líneas sin contar no se tocan. No se puede deshacer.`}
        confirmLabel="Aplicar"
        loading={apply.isPending}
        onConfirm={() => apply.mutate(undefined)}
      />
      <Confirm
        open={confirm === 'cancel'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="¿Anular el conteo?"
        description="No genera movimientos. Lo contado queda guardado como referencia."
        confirmLabel="Anular"
        destructive
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate(undefined)}
      />
    </>
  );
}

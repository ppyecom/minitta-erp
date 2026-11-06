import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Info, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useLookups } from '@/lib/lookups';
import { useSave } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { dateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Select } from '@/components/ui/form';
import { Badge, Card } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/overlay';
import { CountStatusBadge, DataTable, EmptyState, Mono, PageHeader } from '@/components/common';
import { categoryOptions } from '@/modules/catalog/ProductForm';

interface CountRow {
  id: number;
  code: string;
  status: string;
  is_opening: boolean;
  location_code: string;
  location_name: string;
  category_name: string | null;
  created_by_name: string;
  started_at: string;
  applied_at: string | null;
  lines: number;
  counted: number;
  differences: number;
}

function OpenCountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const nav = useNavigate();
  const { data: lk } = useLookups();
  const { locationId } = useSession();
  const [v, setV] = useState({ location_id: locationId ? String(locationId) : '', is_opening: true, category_id: '' });
  const save = useSave(() => api.post<{ id: number }>('/counts', v), {
    success: 'Conteo abierto: el saldo del sistema quedó congelado como referencia',
    invalidate: [['counts'], ['dashboard']],
    onSuccess: (r) => {
      onOpenChange(false);
      nav(`/inventario/conteos/${r.id}`);
    },
  });
  if (!lk) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Abrir inventario físico"
      description="Se congela el saldo actual de cada variante. La sede puede seguir vendiendo mientras se cuenta."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Abrir conteo
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Sede" required error={save.fields.location_id}>
          <Select value={v.location_id} onChange={(e) => setV({ ...v, location_id: e.target.value })}>
            <option value="">Elegir…</option>
            {lk.locations
              .filter((l) => l.is_active && l.holds_stock)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Alcance" hint="Vacío = todo el catálogo activo">
          <Select value={v.category_id} onChange={(e) => setV({ ...v, category_id: e.target.value })}>
            <option value="">Todas las categorías</option>
            {categoryOptions(lk.categories).map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox
          checked={v.is_opening}
          onCheckedChange={(x) => setV({ ...v, is_opening: x })}
          label="Es el conteo de apertura"
          description="Arranque del ERP: las diferencias entran como movimientos de apertura."
        />
        <div className="flex gap-2 rounded-lg bg-info-soft px-3 py-2.5 text-[13px]">
          <Info className="mt-0.5 size-4 shrink-0 text-info" />
          <span>
            Las variantes <b>serializadas</b> no se cuentan aquí: cada pieza se registra en <b>Piezas</b>, con su peso real.
          </span>
        </div>
      </div>
    </Dialog>
  );
}

export function CountsPage() {
  const nav = useNavigate();
  const [opening, setOpening] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['counts'], queryFn: () => api.get<CountRow[]>('/counts') });
  return (
    <>
      <PageHeader
        title="Inventario físico"
        description="Así arranca el stock de cada sede: se cuenta, y al aplicar, cada diferencia queda como movimiento firmado."
        actions={
          <Button onClick={() => setOpening(true)}>
            <Plus /> Abrir conteo
          </Button>
        }
      />
      <Card>
        <DataTable
          rows={data}
          loading={isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => nav(`/inventario/conteos/${r.id}`)}
          columns={[
            {
              key: 'c',
              header: 'Conteo',
              cell: (r) => (
                <div>
                  <Mono className="font-medium">{r.code}</Mono>
                  {r.is_opening && <Badge tone="gold" className="ml-2">Apertura</Badge>}
                </div>
              ),
            },
            { key: 'l', header: 'Sede', cell: (r) => `${r.location_code} · ${r.location_name}` },
            { key: 'a', header: 'Alcance', cell: (r) => r.category_name ?? 'Todo', className: 'hidden md:table-cell' },
            {
              key: 'p',
              header: 'Avance',
              cell: (r) => (
                <div className="flex w-36 items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-gold" style={{ width: `${r.lines ? (r.counted / r.lines) * 100 : 0}%` }} />
                  </div>
                  <span className="tabular text-xs text-muted-foreground">
                    {r.counted}/{r.lines}
                  </span>
                </div>
              ),
            },
            { key: 'd', header: 'Diferencias', align: 'right', cell: (r) => <span className="tabular">{r.differences}</span> },
            { key: 'u', header: 'Abierto por', cell: (r) => <span className="text-muted-foreground">{r.created_by_name} · {dateTime(r.started_at)}</span>, className: 'hidden lg:table-cell' },
            { key: 's', header: 'Estado', cell: (r) => <CountStatusBadge status={r.status} /> },
          ]}
          empty={
            <EmptyState
              icon={ClipboardCheck}
              title="Ningún conteo todavía"
              description="El primer paso para arrancar el stock: abrir el conteo de apertura de cada sede."
              action={
                <Button onClick={() => setOpening(true)}>
                  <Plus /> Abrir conteo de apertura
                </Button>
              }
            />
          }
        />
      </Card>
      <OpenCountDialog open={opening} onOpenChange={setOpening} />
    </>
  );
}

import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, Check, Flame, Play, Scale } from 'lucide-react';
import { WorkItemSource, WorkOrderKind } from '@minitta/shared';
import { api } from '@/lib/api';
import { useLookups } from '@/lib/lookups';
import { useSave } from '@/lib/forms';
import { date, dateTime, grams } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Badge, Card, CardHeader, Skeleton } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/overlay';
import { Confirm, Mono, PageHeader, Stat, Thumb } from '@/components/common';
import { VariantPicker, type VariantHit } from '@/components/variant-picker';
import { WorkOrderStatusBadge } from './WorkOrdersPage';

interface Item {
  id: number;
  source?: string;
  variant_id: number | null;
  serial_id: number | null;
  custody_item_id: number | null;
  quantity: number;
  weight_g: number;
  sku: string | null;
  product_name: string | null;
  image_url: string | null;
  serial_code: string | null;
  custody_code: string | null;
  custody_description: string | null;
  material_name: string | null;
  from_location_code?: string | null;
  to_location_code?: string | null;
  notes: string | null;
}

interface Loss {
  id: number;
  weight_g: number;
  is_recovered: boolean;
  reason: string;
  material_name: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  created_by_name: string | null;
}

interface Detail {
  id: number;
  code: string;
  kind: string;
  status: string;
  location_code: string;
  location_name: string;
  assigned_user_name: string | null;
  assigned_supplier_name: string | null;
  custody_item_id: number | null;
  custody_code: string | null;
  customer_name: string | null;
  custody_description: string | null;
  opened_at: string;
  promised_on: string | null;
  started_at: string | null;
  closed_at: string | null;
  notes: string | null;
  input_g: number;
  output_g: number;
  recovered_g: number;
  loss_g: number;
  diff_g: number;
  loss_pct: number | null;
  max_loss_pct: number | null;
  balanced: boolean;
  inputs: Item[];
  outputs: Item[];
  losses: Loss[];
}

/** El tablero de gramos: lo primero que se ve, porque es lo que define si la orden puede cerrar. */
function Balance({ w }: { w: Detail }) {
  const over = w.max_loss_pct != null && w.loss_pct != null && w.loss_pct > w.max_loss_pct;
  const missing = Number(w.diff_g);
  return (
    <Card className={w.balanced ? 'border-success/40' : 'border-warning/50'}>
      <CardHeader
        title="Cuadre de gramos"
        description="Lo que entra tiene que salir, o estar declarado como merma."
        actions={
          w.balanced ? (
            <Badge tone="success">
              <Check /> Cuadra
            </Badge>
          ) : (
            <Badge tone="warning">
              <Scale /> Faltan {missing.toFixed(3)} g
            </Badge>
          )
        }
      />
      <div className="grid grid-cols-2 gap-4 px-5 pb-5 sm:grid-cols-4">
        <Stat label="Entró" value={grams(w.input_g)} mono />
        <Stat label="Salió" value={grams(w.output_g)} mono />
        <Stat label="Recuperado" value={grams(w.recovered_g)} mono />
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Merma</dt>
          <dd className="mt-0.5 flex items-center gap-2">
            <span className="font-mono text-[12.5px] font-medium">{grams(w.loss_g)}</span>
            {w.loss_pct != null && (
              <Badge tone={over ? 'danger' : 'neutral'}>
                {Number(w.loss_pct).toFixed(2)}%
                {w.max_loss_pct != null && ` de ${Number(w.max_loss_pct).toFixed(1)}%`}
              </Badge>
            )}
          </dd>
        </div>
      </div>
      {over && (
        <p className="border-t bg-destructive-soft/40 px-5 py-2.5 text-[13px]">
          La merma supera el estándar para este trabajo: necesita que un segundo usuario la apruebe
          antes de cerrar la orden.
        </p>
      )}
    </Card>
  );
}

function ItemDialog({
  w,
  kind,
  open,
  onOpenChange,
}: {
  w: Detail;
  kind: 'input' | 'output';
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data: lk } = useLookups();
  const isInput = kind === 'input';
  const [source, setSource] = useState<'stock' | 'custody' | 'material'>(
    w.custody_item_id && isInput ? 'custody' : 'stock',
  );
  const [variant, setVariant] = useState<VariantHit | null>(null);
  const [f, setF] = useState({ location_id: '', serial_id: '', material_id: '', quantity: '1', weight_g: '', notes: '' });

  const serials = useQuery({
    queryKey: ['wo-serials', variant?.variant_id, f.location_id],
    queryFn: () =>
      api.get<{ items: { serial_id: number; serial_code: string; variant_id: number; actual_weight_g: number | null }[] }>(
        `/serials?pageSize=200&variant_id=${variant?.variant_id}`,
      ),
    enabled: open && variant?.tracking_mode === 'serial',
  });

  const body = isInput
    ? {
        source,
        variant_id: source === 'stock' ? variant?.variant_id : null,
        serial_id: source === 'stock' ? f.serial_id : null,
        custody_item_id: source === 'custody' ? w.custody_item_id : null,
        material_id: source === 'material' ? f.material_id : null,
        from_location_id: source === 'stock' ? f.location_id : null,
        quantity: f.quantity,
        weight_g: f.weight_g,
        notes: f.notes,
      }
    : {
        variant_id: source === 'stock' ? variant?.variant_id : null,
        serial_id: source === 'stock' ? f.serial_id : null,
        custody_item_id: source === 'custody' ? w.custody_item_id : null,
        to_location_id: source === 'stock' ? f.location_id : null,
        quantity: f.quantity,
        weight_g: f.weight_g,
        notes: f.notes,
      };

  const save = useSave(() => api.post(`/ops/work-orders/${w.id}/${isInput ? 'inputs' : 'outputs'}`, body), {
    success: isInput ? 'Entrada cargada' : 'Salida cargada',
    invalidate: [['work-order', w.id]],
    onSuccess: () => {
      onOpenChange(false);
      setVariant(null);
      setF({ location_id: '', serial_id: '', material_id: '', quantity: '1', weight_g: '', notes: '' });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isInput ? 'Qué entra al taller' : 'Qué sale del taller'}
      description="El peso en gramos es obligatorio: es lo que después tiene que cuadrar."
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Agregar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="De dónde sale">
          <Select value={source} onChange={(e) => setSource(e.target.value as never)}>
            {WorkItemSource.options
              .filter((o) => (isInput ? true : o.value !== 'material'))
              .filter((o) => o.value !== 'custody' || !!w.custody_item_id)
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </Select>
        </Field>

        {source === 'custody' && (
          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-[13px]">
            {w.custody_code} · {w.custody_description} — de {w.customer_name}
          </p>
        )}

        {source === 'material' && (
          <Field label="Material" required error={save.fields.material_id}>
            <Select value={f.material_id} onChange={(e) => setF((p) => ({ ...p, material_id: e.target.value }))}>
              <option value="">Elegir…</option>
              {lk?.materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {source === 'stock' && (
          <>
            <Field label={isInput ? 'Sede de donde sale' : 'Sede a donde vuelve'} required error={save.fields.from_location_id ?? save.fields.to_location_id}>
              <Select value={f.location_id} onChange={(e) => setF((p) => ({ ...p, location_id: e.target.value }))}>
                <option value="">Elegir…</option>
                {lk?.locations
                  .filter((l) => l.is_active && l.holds_stock)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} · {l.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Artículo" required error={save.fields.variant_id}>
              <VariantPicker
                value={variant}
                locationId={Number(f.location_id) || null}
                onChange={(v) => {
                  setVariant(v);
                  setF((p) => ({ ...p, serial_id: '' }));
                }}
              />
            </Field>
            {variant?.tracking_mode === 'serial' && (
              <Field label="Qué pieza" required hint="Las piezas se mueven de a una">
                <Select value={f.serial_id} onChange={(e) => setF((p) => ({ ...p, serial_id: e.target.value }))}>
                  <option value="">Elegir pieza…</option>
                  {serials.data?.items.map((s) => (
                    <option key={s.serial_id} value={s.serial_id}>
                      {s.serial_code}
                      {s.actual_weight_g ? ` · ${s.actual_weight_g} g` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {variant?.tracking_mode !== 'serial' && source !== 'custody' && (
            <Field label="Cantidad" required error={save.fields.quantity}>
              <Input value={f.quantity} onChange={(e) => setF((p) => ({ ...p, quantity: e.target.value }))} inputMode="decimal" />
            </Field>
          )}
          <Field label="Peso en gramos" required error={save.fields.weight_g}>
            <Input value={f.weight_g} onChange={(e) => setF((p) => ({ ...p, weight_g: e.target.value }))} inputMode="decimal" />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

function LossDialog({ w, open, onOpenChange }: { w: Detail; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: lk } = useLookups();
  const [f, setF] = useState({ material_id: '', weight_g: '', is_recovered: false, reason: '' });
  const save = useSave(() => api.post(`/ops/work-orders/${w.id}/losses`, f), {
    success: 'Merma declarada',
    invalidate: [['work-order', w.id]],
    onSuccess: () => {
      onOpenChange(false);
      setF({ material_id: '', weight_g: '', is_recovered: false, reason: '' });
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Declarar merma"
      description="El recorte que vuelve a la caja fuerte se marca como recuperado: cuadra el peso pero no es pérdida."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Declarar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Gramos" required error={save.fields.weight_g}>
          <Input value={f.weight_g} onChange={(e) => setF((p) => ({ ...p, weight_g: e.target.value }))} inputMode="decimal" autoFocus />
        </Field>
        <Field label="Material">
          <Select value={f.material_id} onChange={(e) => setF((p) => ({ ...p, material_id: e.target.value }))}>
            <option value="">—</option>
            {lk?.materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox
          checked={f.is_recovered}
          onCheckedChange={(v) => setF((p) => ({ ...p, is_recovered: !!v }))}
          label="Se recuperó (recorte, limadura que vuelve)"
        />
        <Field label="Motivo" required error={save.fields.reason}>
          <Input value={f.reason} onChange={(e) => setF((p) => ({ ...p, reason: e.target.value }))} placeholder="Recorte de aro, limadura de pulido…" />
        </Field>
      </div>
    </Dialog>
  );
}

function ItemList({ items, empty }: { items: Item[]; empty: string }) {
  if (!items.length) return <p className="px-5 pb-5 text-[13px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y border-t">
      {items.map((it) => (
        <li key={it.id} className="flex items-center gap-3 px-5 py-2.5">
          {it.variant_id ? <Thumb src={it.image_url} size={32} /> : null}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">
              {it.product_name ?? it.custody_description ?? it.material_name ?? 'Material'}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {it.sku && <Mono>{it.sku}</Mono>}
              {it.serial_code && ` · ${it.serial_code}`}
              {it.custody_code && <Mono>{it.custody_code}</Mono>}
              {it.from_location_code && ` · desde ${it.from_location_code}`}
              {it.to_location_code && ` · hacia ${it.to_location_code}`}
            </div>
          </div>
          <span className="tabular shrink-0 text-[13px]">{Number(it.quantity)} u.</span>
          <span className="tabular shrink-0 font-mono text-[12.5px] font-medium">{grams(it.weight_g)}</span>
        </li>
      ))}
    </ul>
  );
}

export function WorkOrderDetailPage() {
  const { id } = useParams();
  const [adding, setAdding] = useState<'input' | 'output' | null>(null);
  const [loss, setLoss] = useState(false);
  const [closing, setClosing] = useState(false);
  const { data: w, refetch } = useQuery({
    queryKey: ['work-order', Number(id)],
    queryFn: () => api.get<Detail>(`/ops/work-orders/${id}`),
  });

  const start = useSave(() => api.post(`/ops/work-orders/${id}/start`), {
    success: 'Orden iniciada: las piezas están en el taller',
    invalidate: [['work-order', Number(id)], ['work-orders'], ['pieces-out'], ['stock']],
  });
  const close = useSave(() => api.post(`/ops/work-orders/${id}/close`), {
    success: 'Orden cerrada',
    invalidate: [['work-order', Number(id)], ['work-orders'], ['pieces-out'], ['stock'], ['custody']],
    onSuccess: () => setClosing(false),
  });
  const approve = useSave((lossId: number) => api.post(`/ops/work-orders/${id}/losses/${lossId}/approve`), {
    success: 'Merma aprobada',
    onSuccess: () => refetch(),
  });

  if (!w) return <Skeleton className="h-96 w-full" />;
  const editable = ['draft', 'open', 'in_progress', 'finished'].includes(w.status);
  const started = !!w.started_at;

  return (
    <>
      <PageHeader
        back={{ to: '/procesos/taller', label: 'Taller' }}
        title={WorkOrderKind.label(w.kind as never)}
        description={
          w.custody_code ? (
            <>
              Pieza de {w.customer_name} ·{' '}
              <Link className="underline" to={`/procesos/custodia/${w.custody_item_id}`}>
                {w.custody_code}
              </Link>
            </>
          ) : (
            `${w.location_code} · ${w.location_name}`
          )
        }
        meta={
          <>
            <Mono className="font-medium">{w.code}</Mono>
            <WorkOrderStatusBadge status={w.status} />
            {w.promised_on && <Badge tone="neutral">Para el {date(w.promised_on)}</Badge>}
          </>
        }
        actions={
          <>
            {!started && w.status !== 'cancelled' && (
              <Button loading={start.isPending} onClick={() => start.mutate(undefined)} disabled={!w.inputs.length}>
                <Play /> Iniciar
              </Button>
            )}
            {started && editable && (
              <Button onClick={() => setClosing(true)}>
                <Check /> Cerrar orden
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-5">
        <Balance w={w} />

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Entra"
              description={started ? 'Ya está en el taller' : 'Se mueve al taller cuando se inicia la orden'}
              actions={
                editable && !started ? (
                  <Button variant="outline" size="sm" onClick={() => setAdding('input')}>
                    <ArrowDownToLine /> Agregar
                  </Button>
                ) : null
              }
            />
            <ItemList items={w.inputs} empty="Todavía no se cargó nada." />
          </Card>

          <Card>
            <CardHeader
              title="Sale"
              description="Lo que vuelve: la misma pieza, otra nueva, o la del cliente"
              actions={
                editable ? (
                  <Button variant="outline" size="sm" onClick={() => setAdding('output')}>
                    <ArrowUpFromLine /> Agregar
                  </Button>
                ) : null
              }
            />
            <ItemList items={w.outputs} empty="Todavía no se cargó nada." />
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Merma"
            description="Los gramos que no vuelven como pieza"
            actions={
              editable ? (
                <Button variant="outline" size="sm" onClick={() => setLoss(true)}>
                  <Flame /> Declarar
                </Button>
              ) : null
            }
          />
          {w.losses.length === 0 ? (
            <p className="px-5 pb-5 text-[13px] text-muted-foreground">Sin merma declarada.</p>
          ) : (
            <ul className="divide-y border-t">
              {w.losses.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                  <span className="tabular font-mono text-[12.5px] font-medium">{grams(l.weight_g)}</span>
                  {l.is_recovered ? <Badge tone="success">Recuperado</Badge> : <Badge tone="warning">Perdido</Badge>}
                  <span className="min-w-0 flex-1 truncate text-[13px]">{l.reason}</span>
                  {l.approved_by_name ? (
                    <Badge tone="info">Aprobada por {l.approved_by_name}</Badge>
                  ) : (
                    !l.is_recovered &&
                    editable && (
                      <Button variant="outline" size="sm" loading={approve.isPending} onClick={() => approve.mutate(l.id)}>
                        Aprobar
                      </Button>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Datos de la orden" />
          <dl className="grid gap-4 px-5 pb-5 sm:grid-cols-4">
            <Stat label="Taller" value={`${w.location_code} · ${w.location_name}`} />
            <Stat label="Responsable" value={w.assigned_user_name ?? w.assigned_supplier_name} />
            <Stat label="Abierta" value={dateTime(w.opened_at)} />
            <Stat label="Iniciada" value={w.started_at ? dateTime(w.started_at) : '—'} />
            <Stat label="Cerrada" value={w.closed_at ? dateTime(w.closed_at) : '—'} />
            <Stat label="Notas" value={w.notes} />
          </dl>
        </Card>
      </div>

      {adding && <ItemDialog w={w} kind={adding} open onOpenChange={() => setAdding(null)} />}
      <LossDialog w={w} open={loss} onOpenChange={setLoss} />
      <Confirm
        open={closing}
        onOpenChange={setClosing}
        title="Cerrar la orden"
        description={
          w.balanced
            ? 'Las piezas vuelven a su sede y se actualiza el peso real. Los gramos cuadran.'
            : `Faltan ${Number(w.diff_g).toFixed(3)} g por declarar. La base va a rechazar el cierre.`
        }
        confirmLabel="Cerrar orden"
        loading={close.isPending}
        onConfirm={() => close.mutate(undefined)}
      />
    </>
  );
}

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Award, Plus, ScanBarcode } from 'lucide-react';
import { toast } from 'sonner';
import { SerialStatus, type Page } from '@minitta/shared';
import { api, qs } from '@/lib/api';
import { useLookups } from '@/lib/lookups';
import { useSave } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { cn, date, dateTime, grams, money, today } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, Separator } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/overlay';
import { DataTable, EmptyState, Mono, MovementTypeBadge, PageHeader, Pagination, SearchInput, SerialStatusBadge, Stat, Thumb } from '@/components/common';
import { VariantPicker, type VariantHit } from '@/components/variant-picker';

interface SerialRow {
  serial_id: number;
  serial_code: string;
  status: string;
  sku: string;
  product_name: string;
  product_id: number;
  image_url: string | null;
  location_code: string | null;
  actual_weight_g: number | null;
  nominal_weight_g: number | null;
  weight_diff_g: number | null;
  acquired_on: string | null;
  certificates: number;
  last_movement_at: string | null;
}

interface SerialDetail extends Record<string, unknown> {
  id: number;
  serial_code: string;
  status: string;
  sku: string;
  product_name: string;
  product_id: number;
  image_url: string | null;
  location_code: string | null;
  actual_weight_g: number | null;
  nominal_weight_g: number | null;
  weight_diff_g: number | null;
  actual_size_label: string | null;
  acquisition_cost: number | null;
  acquisition_currency: string | null;
  acquired_on: string | null;
  supplier_name: string | null;
  engraving_text: string | null;
  notes: string | null;
  movements: { id: number; occurred_at: string; type: string; quantity: number; notes: string | null; location_code: string; user_name: string }[];
  certificates: { id: number; authority: string; certificate_no: string; issued_on: string | null }[];
}

function NewSerialSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: lk } = useLookups();
  const { locationId } = useSession();
  const [variant, setVariant] = useState<VariantHit | null>(null);
  const blank = () => ({
    serial_code: '',
    actual_weight_g: '',
    actual_size_label: '',
    supplier_id: '',
    acquisition_cost: '',
    acquired_on: today(),
    engraving_text: '',
    notes: '',
    location_id: locationId ? String(locationId) : '',
    entry_type: 'opening',
  });
  const [v, setV] = useState(blank);
  const [another, setAnother] = useState(false);
  useEffect(() => {
    if (open) {
      setV(blank());
      setVariant(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useSave(
    () => api.post<{ serial_code: string }>('/serials', { ...v, variant_id: variant?.variant_id, entry_type: v.location_id ? v.entry_type : null }),
    {
      invalidate: [['serials'], ['stock'], ['kardex'], ['dashboard'], ['product']],
      onSuccess: (r) => {
        if (another) setV((p) => ({ ...blank(), location_id: p.location_id, entry_type: p.entry_type, acquired_on: p.acquired_on }));
        else onOpenChange(false);
        toast.success(`Pieza ${r.serial_code} registrada`);
      },
    },
  );
  if (!lk) return null;
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }));
  const err = save.fields;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Registrar pieza"
      description="Cada joya física con su código, su peso real y su ubicación. Ideal durante el conteo de apertura."
      footer={
        <>
          <label className="mr-auto flex items-center gap-2 text-[13px] text-muted-foreground">
            <input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} className="accent-current" />
            Registrar otra al guardar
          </label>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="gold" loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Guardar pieza
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-6">
        <Field label="Variante" required error={err.variant_id} hint="Si es por cantidad y no tiene stock, pasa a serializada" className="sm:col-span-6">
          <VariantPicker value={variant} onChange={setVariant} invalid={!!err.variant_id} />
        </Field>
        <Field label="Código de pieza" hint="Vacío = P-000001, P-000002…" error={err.serial_code} className="sm:col-span-3">
          <Input value={v.serial_code} onChange={set('serial_code')} className="font-mono" placeholder="Automático" />
        </Field>
        <Field label="Peso real" error={err.actual_weight_g} hint="Lo que marca la balanza" className="sm:col-span-3">
          <Input autoFocus value={v.actual_weight_g} onChange={set('actual_weight_g')} inputMode="decimal" suffix="g" />
        </Field>
        <Separator className="sm:col-span-6" />
        <Field label="Ingresa a la sede" className="sm:col-span-3">
          <Select value={v.location_id} onChange={set('location_id')}>
            <option value="">No ingresa todavía</option>
            {lk.locations
              .filter((l) => l.is_active && l.holds_stock)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Como" className="sm:col-span-3">
          <Select value={v.entry_type} onChange={set('entry_type')} disabled={!v.location_id}>
            <option value="opening">Inventario de apertura</option>
            <option value="purchase">Compra a proveedor</option>
          </Select>
        </Field>
        <Field label="Proveedor" className="sm:col-span-3">
          <Select value={v.supplier_id} onChange={set('supplier_id')}>
            <option value="">—</option>
            {lk.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Costo de la pieza" error={err.acquisition_cost} className="sm:col-span-3">
          <Input value={v.acquisition_cost} onChange={set('acquisition_cost')} inputMode="decimal" suffix="S/" />
        </Field>
        <Field label="Fecha de ingreso" className="sm:col-span-3">
          <Input type="date" value={v.acquired_on} onChange={set('acquired_on')} />
        </Field>
        <Field label="Talla real" hint="Si se ajustó en taller" className="sm:col-span-3">
          <Input value={v.actual_size_label} onChange={set('actual_size_label')} />
        </Field>
        <Field label="Grabado" className="sm:col-span-6">
          <Input value={v.engraving_text} onChange={set('engraving_text')} />
        </Field>
        <Field label="Notas" className="sm:col-span-6">
          <Textarea value={v.notes} onChange={set('notes')} rows={2} />
        </Field>
      </div>
    </Sheet>
  );
}

function SerialSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data: s } = useQuery({ queryKey: ['serial', id], queryFn: () => api.get<SerialDetail>(`/serials/${id}`), enabled: !!id });
  const [cert, setCert] = useState({ authority: 'GIA', certificate_no: '', issued_on: '' });
  const [edit, setEdit] = useState({ actual_weight_g: '', notes: '' });
  useEffect(() => {
    if (s) setEdit({ actual_weight_g: s.actual_weight_g != null ? String(s.actual_weight_g) : '', notes: s.notes ?? '' });
  }, [s?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const addCert = useSave(() => api.post(`/serials/${id}/certifications`, cert), {
    success: 'Certificado agregado',
    invalidate: [['serial', id], ['serials']],
    onSuccess: () => setCert({ authority: 'GIA', certificate_no: '', issued_on: '' }),
  });
  const save = useSave(
    () =>
      api.put(`/serials/${id}`, {
        serial_code: s?.serial_code,
        actual_weight_g: edit.actual_weight_g,
        actual_size_label: s?.actual_size_label,
        acquisition_cost: s?.acquisition_cost,
        acquisition_currency: s?.acquisition_currency,
        acquired_on: s?.acquired_on,
        engraving_text: s?.engraving_text,
        notes: edit.notes,
      }),
    { success: 'Pieza actualizada', invalidate: [['serial', id], ['serials']] },
  );

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()} title={s ? <Mono className="text-base">{s.serial_code}</Mono> : 'Pieza'} description={s?.product_name}>
      {s && (
        <div className="space-y-6">
          <div className="flex gap-4">
            <Thumb src={s.image_url} size={88} className="rounded-xl" />
            <div className="grid flex-1 grid-cols-2 gap-3">
              <Stat label="Estado" value={<SerialStatusBadge status={s.status} />} />
              <Stat label="Sede" value={s.location_code ?? '—'} />
              <Stat label="SKU" value={s.sku} mono />
              <Stat label="Ingreso" value={date(s.acquired_on)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 rounded-lg border p-3">
            <Stat label="Peso nominal" value={grams(s.nominal_weight_g)} />
            <Stat label="Peso real" value={grams(s.actual_weight_g)} />
            <Stat
              label="Diferencia"
              value={
                s.weight_diff_g != null ? (
                  <span className={cn(s.weight_diff_g > 0 ? 'text-success' : s.weight_diff_g < 0 ? 'text-destructive' : '')}>
                    {s.weight_diff_g > 0 ? '+' : ''}
                    {grams(s.weight_diff_g)}
                  </span>
                ) : (
                  '—'
                )
              }
            />
            <Stat label="Costo" value={s.acquisition_cost != null ? money(s.acquisition_cost, s.acquisition_currency ?? 'PEN') : '—'} />
            <Stat label="Proveedor" value={s.supplier_name ?? '—'} />
            <Stat label="Grabado" value={s.engraving_text ?? '—'} />
          </div>

          <section className="grid gap-3 sm:grid-cols-3">
            <Field label="Peso real (g)">
              <Input value={edit.actual_weight_g} onChange={(e) => setEdit({ ...edit, actual_weight_g: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="Notas" className="sm:col-span-2">
              <Input value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
            </Field>
            <div className="flex justify-end sm:col-span-3">
              <Button size="sm" variant="outline" loading={save.isPending} onClick={() => save.mutate(undefined)}>
                Guardar cambios
              </Button>
            </div>
          </section>

          <section>
            <h4 className="mb-2 text-[13px] font-semibold">Certificados</h4>
            {s.certificates.length > 0 && (
              <ul className="mb-2 divide-y rounded-lg border">
                {s.certificates.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                    <Award className="size-4 text-gold" />
                    <span className="font-medium">{c.authority}</span>
                    <Mono>{c.certificate_no}</Mono>
                    <span className="ml-auto text-xs text-muted-foreground">{date(c.issued_on)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-2 sm:grid-cols-[1fr_1.5fr_1fr_auto]">
              <Input value={cert.authority} onChange={(e) => setCert({ ...cert, authority: e.target.value })} placeholder="GIA, IGI, interno" />
              <Input value={cert.certificate_no} onChange={(e) => setCert({ ...cert, certificate_no: e.target.value })} placeholder="N° de certificado" aria-invalid={!!addCert.fields.certificate_no} />
              <Input type="date" value={cert.issued_on} onChange={(e) => setCert({ ...cert, issued_on: e.target.value })} />
              <Button variant="outline" loading={addCert.isPending} onClick={() => addCert.mutate(undefined)}>
                <Plus /> Agregar
              </Button>
            </div>
          </section>

          <section>
            <h4 className="mb-2 text-[13px] font-semibold">Recorrido de la pieza</h4>
            {s.movements.length ? (
              <ol className="relative space-y-3 border-l pl-4">
                {s.movements.map((m) => (
                  <li key={m.id} className="relative">
                    <span className={cn('absolute -left-[21px] top-1 size-2.5 rounded-full border-2 border-card', m.quantity > 0 ? 'bg-success' : 'bg-destructive')} />
                    <div className="flex items-center gap-2 text-[13px]">
                      <MovementTypeBadge type={m.type} quantity={m.quantity} />
                      <Mono>{m.location_code}</Mono>
                      <span className="text-xs text-muted-foreground">{dateTime(m.occurred_at)} · {m.user_name}</span>
                    </div>
                    {m.notes && <p className="mt-0.5 text-xs text-muted-foreground">{m.notes}</p>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[13px] text-muted-foreground">Todavía no ingresó a ninguna sede.</p>
            )}
          </section>
          <Link to={`/catalogo/productos/${s.product_id}`} className="inline-block text-xs font-medium text-gold-foreground hover:underline">
            Ver producto →
          </Link>
        </div>
      )}
    </Sheet>
  );
}

export function SerialsPage() {
  const { data: lk } = useLookups();
  const [sp, setSp] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const f = {
    q: sp.get('q') ?? '',
    status: sp.get('estado') ?? '',
    location_id: sp.get('sede') ?? '',
    variant_id: sp.get('variant') ?? '',
    page: Number(sp.get('page') ?? 1),
  };
  const setF = (patch: Record<string, string | number>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v === 1) n.delete(k);
      else n.set(k, String(v));
    }
    if (!('page' in patch)) n.delete('page');
    setSp(n, { replace: true });
  };
  const { data, isFetching } = useQuery({
    queryKey: ['serials', f],
    queryFn: () => api.get<Page<SerialRow>>(`/serials${qs({ q: f.q, status: f.status, location_id: f.location_id, variant_id: f.variant_id, page: f.page })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Piezas"
        description="Joyas serializadas: cada pieza con su código, peso real, ubicación, certificados y recorrido."
        actions={
          <Button variant="gold" onClick={() => setCreating(true)}>
            <Plus /> Registrar pieza
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <SearchInput value={f.q} onChange={(q) => setF({ q })} placeholder="Código de pieza, SKU o producto" />
          <Select className="w-44" value={f.status} onChange={(e) => setF({ estado: e.target.value })}>
            <option value="">Todos los estados</option>
            {SerialStatus.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select className="w-48" value={f.location_id} onChange={(e) => setF({ sede: e.target.value })}>
            <option value="">Todas las sedes</option>
            {lk?.locations
              .filter((l) => l.holds_stock)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
          </Select>
          {f.variant_id && (
            <Badge tone="info" className="cursor-pointer" onClick={() => setF({ variant: '' })}>
              Filtrado por variante ✕
            </Badge>
          )}
        </div>
        <DataTable
          rows={data?.items}
          loading={isFetching}
          rowKey={(r) => r.serial_id}
          onRowClick={(r) => setOpenId(r.serial_id)}
          columns={[
            { key: 'c', header: 'Pieza', cell: (r) => <Mono className="font-medium">{r.serial_code}</Mono> },
            {
              key: 'p',
              header: 'Producto',
              cell: (r) => (
                <div className="flex items-center gap-2.5">
                  <Thumb src={r.image_url} size={30} />
                  <div className="min-w-0">
                    <div className="max-w-60 truncate">{r.product_name}</div>
                    <Mono className="text-muted-foreground">{r.sku}</Mono>
                  </div>
                </div>
              ),
            },
            { key: 'l', header: 'Sede', cell: (r) => <Mono>{r.location_code ?? '—'}</Mono> },
            { key: 'w', header: 'Peso real', align: 'right', cell: (r) => <span className="tabular">{grams(r.actual_weight_g)}</span> },
            {
              key: 'd',
              header: 'vs nominal',
              align: 'right',
              cell: (r) =>
                r.weight_diff_g != null ? (
                  <span className={cn('tabular text-xs', r.weight_diff_g > 0 ? 'text-success' : r.weight_diff_g < 0 ? 'text-destructive' : 'text-muted-foreground')}>
                    {r.weight_diff_g > 0 ? '+' : ''}
                    {grams(r.weight_diff_g)}
                  </span>
                ) : (
                  '—'
                ),
              className: 'hidden md:table-cell',
            },
            { key: 'cert', header: 'Cert.', align: 'center', cell: (r) => (r.certificates ? <Award className="mx-auto size-4 text-gold" /> : <span className="text-muted-foreground">—</span>), className: 'hidden sm:table-cell' },
            { key: 's', header: 'Estado', cell: (r) => <SerialStatusBadge status={r.status} /> },
          ]}
          empty={
            <EmptyState
              icon={ScanBarcode}
              title="No hay piezas registradas"
              description="Las joyas de oro, con gemas o de valor se registran una por una, con su peso real."
              action={
                <Button variant="gold" onClick={() => setCreating(true)}>
                  <Plus /> Registrar pieza
                </Button>
              }
            />
          }
        />
        {data && data.total > 0 && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setF({ page })} />}
      </Card>
      <NewSerialSheet open={creating} onOpenChange={setCreating} />
      <SerialSheet id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

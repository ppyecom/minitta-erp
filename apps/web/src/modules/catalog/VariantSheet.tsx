import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Diamond, History, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { PriceMode, ProductStatus, TrackingMode } from '@minitta/shared';
import { api } from '@/lib/api';
import { useLookups } from '@/lib/lookups';
import { useSave } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { cn, dateTime, grams, money, qty } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, Separator } from '@/components/ui/misc';
import { Dialog, Sheet } from '@/components/ui/overlay';
import { Confirm, EmptyState, Mono } from '@/components/common';

export interface Variant {
  id: number;
  product_id: number;
  sku: string;
  barcode: string | null;
  label_code: string | null;
  size_value_id: number | null;
  size_label: string | null;
  size_value_label: string | null;
  metal_color: string | null;
  secondary_metal_color: string | null;
  stone_color: string | null;
  finish_code: string | null;
  weight_g: number | null;
  length_cm: number | null;
  tracking_mode: 'quantity' | 'serial';
  status: string;
  is_default: boolean;
  legacy_code: string | null;
  serials: number;
}
export interface VariantStone {
  id: number;
  variant_id: number;
  stone_id: number;
  stone_name: string;
  is_gem: boolean;
  color_code: string | null;
  color_name: string | null;
  cut_code: string | null;
  cut_name: string | null;
  setting_code: string | null;
  setting_name: string | null;
  quantity: number;
  size_mm: number | null;
  width_mm: number | null;
  carat_each: number | null;
  carat_total: number | null;
  clarity: string | null;
  quality_grade: string | null;
  is_center: boolean;
  unit_cost: number | null;
  cost_currency: string | null;
  notes: string | null;
}
export interface PriceRow {
  id: number;
  variant_id: number;
  price_list_id: number;
  list_code: string;
  list_name: string;
  currency_code: string;
  mode: string;
  amount: number;
  effective: number | null;
  margin_pct: number | null;
  price_per_gram: number | null;
  min_quantity: number;
  recalculated_at: string | null;
}
export interface StockRow {
  variant_id: number;
  location_id: number;
  location_code: string;
  location_name: string;
  on_hand: number;
  reserved: number;
  in_transit: number;
  available: number;
  min_quantity: number;
  max_quantity: number | null;
}
export interface CostRow {
  variant_id: number;
  metal_cost: number;
  stone_cost: number;
  labor_cost: number;
  plating_cost: number;
  packaging_cost: number;
  other_cost: number;
  total_cost: number;
  currency_code: string;
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

// ---- formulario de la variante -------------------------------------------------
export function VariantForm({
  productId,
  sizeScaleId,
  defaultTracking,
  variant,
  onDone,
}: {
  productId: number;
  sizeScaleId: number | null;
  defaultTracking: string;
  variant?: Variant | null;
  onDone: () => void;
}) {
  const { data: lk } = useLookups();
  const init = () => ({
    sku: variant?.sku ?? '',
    barcode: str(variant?.barcode),
    label_code: str(variant?.label_code),
    size_value_id: str(variant?.size_value_id),
    size_label: str(variant?.size_label),
    metal_color: str(variant?.metal_color),
    secondary_metal_color: str(variant?.secondary_metal_color),
    stone_color: str(variant?.stone_color),
    finish_code: str(variant?.finish_code),
    weight_g: str(variant?.weight_g),
    length_cm: str(variant?.length_cm),
    tracking_mode: variant?.tracking_mode ?? defaultTracking,
    status: variant?.status ?? 'active',
    is_default: variant?.is_default ?? false,
  });
  const [v, setV] = useState(init);
  const [autoSku, setAutoSku] = useState(!variant);
  useEffect(() => {
    setV(init());
    setAutoSku(!variant);
  }, [variant?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useSave(
    (b: typeof v) =>
      variant ? api.put(`/variants/${variant.id}`, { ...b, sku: autoSku ? '' : b.sku }) : api.post(`/products/${productId}/variants`, { ...b, sku: autoSku ? '' : b.sku }),
    { success: variant ? 'Variante actualizada' : 'Variante creada', invalidate: [['product', productId], ['products']], onSuccess: onDone },
  );
  if (!lk) return null;
  const sizes = lk.sizeValues.filter((s) => s.size_scale_id === sizeScaleId);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }));
  const err = save.fields;

  return (
    <form
      id="variant-form"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(v);
      }}
      className="grid gap-4 sm:grid-cols-6"
    >
      {sizeScaleId ? (
        <Field label="Talla" error={err.size_value_id} className="sm:col-span-2">
          <Select value={v.size_value_id} onChange={set('size_value_id')}>
            <option value="">—</option>
            {sizes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.diameter_mm ? ` (${s.diameter_mm} mm)` : ''}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field label="Medida / talla libre" hint="45 cm, S, M…" className="sm:col-span-2">
          <Input value={v.size_label} onChange={set('size_label')} />
        </Field>
      )}
      <Field label="Color de metal" className="sm:col-span-2">
        <Select value={v.metal_color} onChange={set('metal_color')}>
          <option value="">—</option>
          {lk.metalColors.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Color de piedra" hint="Rubí y cristalino son SKU distintos" className="sm:col-span-2">
        <Select value={v.stone_color} onChange={set('stone_color')}>
          <option value="">—</option>
          {lk.colors.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Segundo color de metal" className="sm:col-span-2">
        <Select value={v.secondary_metal_color} onChange={set('secondary_metal_color')}>
          <option value="">—</option>
          {lk.metalColors.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Peso" hint="Si difiere del nominal" error={err.weight_g} className="sm:col-span-2">
        <Input value={v.weight_g} onChange={set('weight_g')} inputMode="decimal" suffix="g" />
      </Field>
      <Field label="Largo" error={err.length_cm} className="sm:col-span-2">
        <Input value={v.length_cm} onChange={set('length_cm')} inputMode="decimal" suffix="cm" />
      </Field>
      <Field label="Control de stock" className="sm:col-span-3" hint={v.tracking_mode === 'serial' ? 'Cada pieza con su código, peso real y certificado' : 'Se cuentan unidades intercambiables'}>
        <Select value={v.tracking_mode} onChange={set('tracking_mode')}>
          {TrackingMode.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Estado" className="sm:col-span-3">
        <Select value={v.status} onChange={set('status')}>
          {ProductStatus.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="SKU" error={err.sku} className="sm:col-span-3">
        <Input value={autoSku ? '' : v.sku} disabled={autoSku} onChange={set('sku')} placeholder={autoSku ? 'Se genera: CÓDIGO-TALLA-COLOR' : ''} className="font-mono" />
        <Checkbox checked={autoSku} onCheckedChange={setAutoSku} label="Generar automáticamente" />
      </Field>
      <Field label="Código de barras" error={err.barcode} className="sm:col-span-3">
        <Input value={v.barcode} onChange={set('barcode')} className="font-mono" />
        <Checkbox checked={v.is_default} onCheckedChange={(x) => setV((p) => ({ ...p, is_default: x }))} label="Variante principal del producto" />
      </Field>
    </form>
  );
}

// ---- piedras ----------------------------------------------------------------------
function StoneDialog({
  open,
  onOpenChange,
  variantId,
  productId,
  stone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  variantId: number;
  productId: number;
  stone?: VariantStone | null;
}) {
  const { data: lk } = useLookups();
  const init = () => ({
    stone_id: str(stone?.stone_id),
    color_code: str(stone?.color_code),
    cut_code: str(stone?.cut_code),
    setting_code: str(stone?.setting_code),
    quantity: str(stone?.quantity ?? 1),
    size_mm: str(stone?.size_mm),
    width_mm: str(stone?.width_mm),
    carat_each: str(stone?.carat_each),
    clarity: str(stone?.clarity),
    quality_grade: str(stone?.quality_grade),
    is_center: stone?.is_center ?? false,
    unit_cost: str(stone?.unit_cost),
    cost_currency: stone?.cost_currency ?? 'PEN',
    notes: str(stone?.notes),
  });
  const [v, setV] = useState(init);
  useEffect(() => {
    if (open) setV(init());
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useSave(
    (b: typeof v) => (stone ? api.put(`/variant-stones/${stone.id}`, b) : api.post(`/variants/${variantId}/stones`, b)),
    { success: 'Piedra guardada', invalidate: [['product', productId]], onSuccess: () => onOpenChange(false) },
  );
  if (!lk) return null;
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }));
  const sel = lk.stones.find((s) => String(s.id) === v.stone_id);
  const total = Number(v.carat_each) * Number(v.quantity);
  const err = save.fields;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={stone ? 'Editar piedra' : 'Agregar piedra'}
      description='"20 pi 2.5 mm" deja de ser texto: cantidad, medida, quilates y engaste como datos.'
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(v)}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-6">
        <Field label="Piedra" required error={err.stone_id} className="sm:col-span-3">
          <Select value={v.stone_id} onChange={set('stone_id')} aria-invalid={!!err.stone_id}>
            <option value="">Elegir…</option>
            <optgroup label="Gemas finas">
              {lk.stones.filter((s) => s.is_gem).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Otras">
              {lk.stones.filter((s) => !s.is_gem).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </Field>
        <Field label="Color" className="sm:col-span-3">
          <Select value={v.color_code} onChange={set('color_code')}>
            <option value="">—</option>
            {lk.colors.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cantidad" required error={err.quantity} className="sm:col-span-2">
          <Input value={v.quantity} onChange={set('quantity')} inputMode="numeric" suffix="pzs" />
        </Field>
        <Field label="Medida" error={err.size_mm} className="sm:col-span-2">
          <Input value={v.size_mm} onChange={set('size_mm')} inputMode="decimal" suffix="mm" />
        </Field>
        <Field label="Ancho (si no es redonda)" error={err.width_mm} className="sm:col-span-2">
          <Input value={v.width_mm} onChange={set('width_mm')} inputMode="decimal" suffix="mm" />
        </Field>
        <Field label="Forma / talla" className="sm:col-span-2">
          <Select value={v.cut_code} onChange={set('cut_code')}>
            <option value="">—</option>
            {lk.stoneCuts.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Engaste" className="sm:col-span-2">
          <Select value={v.setting_code} onChange={set('setting_code')}>
            <option value="">—</option>
            {lk.settingTypes.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end pb-2 sm:col-span-2">
          <Checkbox checked={v.is_center} onCheckedChange={(x) => setV((p) => ({ ...p, is_center: x }))} label="Piedra central" description="Las demás son acompañantes" />
        </div>
        {(sel?.is_gem || v.carat_each || v.clarity) && (
          <>
            <Field label="Quilates c/u" error={err.carat_each} hint={total ? `Total: ${total.toFixed(3)} ct` : undefined} className="sm:col-span-2">
              <Input value={v.carat_each} onChange={set('carat_each')} inputMode="decimal" suffix="ct" />
            </Field>
            <Field label="Claridad" hint="VS1, SI2…" className="sm:col-span-2">
              <Input value={v.clarity} onChange={set('clarity')} />
            </Field>
            <Field label="Calidad" hint="AAA, AA, A" className="sm:col-span-2">
              <Input value={v.quality_grade} onChange={set('quality_grade')} />
            </Field>
          </>
        )}
        <Field label="Costo por piedra" hint="Entra al precio por peso" error={err.unit_cost} className="sm:col-span-3">
          <div className="flex gap-2">
            <Select className="w-24" value={v.cost_currency} onChange={set('cost_currency')}>
              {lk.currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </Select>
            <Input value={v.unit_cost} onChange={set('unit_cost')} inputMode="decimal" />
          </div>
        </Field>
        <Field label="Notas" className="sm:col-span-3">
          <Textarea value={v.notes} onChange={set('notes')} rows={1} className="min-h-9" />
        </Field>
      </div>
    </Dialog>
  );
}

export function StonesList({
  stones,
  variantId,
  productId,
  editable = true,
}: {
  stones: VariantStone[];
  variantId: number;
  productId: number;
  editable?: boolean;
}) {
  const [editing, setEditing] = useState<VariantStone | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<VariantStone | null>(null);
  const del = useSave(() => api.del(`/variant-stones/${deleting!.id}`), {
    success: 'Piedra quitada',
    invalidate: [['product', productId]],
    onSuccess: () => setDeleting(null),
  });
  return (
    <div>
      {stones.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
          Sin piedras registradas.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {stones.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className={cn('flex size-8 items-center justify-center rounded-md', s.is_gem ? 'bg-gold-soft text-gold-foreground' : 'bg-muted text-muted-foreground')}>
                <Diamond className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  {s.quantity} × {s.stone_name}
                  {s.color_name && <span className="font-normal text-muted-foreground">{s.color_name}</span>}
                  {s.is_center && <Badge tone="gold">Central</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {[
                    s.size_mm && `${s.size_mm}${s.width_mm ? `×${s.width_mm}` : ''} mm`,
                    s.cut_name,
                    s.setting_name && `engaste ${s.setting_name.toLowerCase()}`,
                    s.carat_total && `${s.carat_total} ct total`,
                    s.clarity,
                    s.quality_grade,
                    s.unit_cost != null && `${money(s.unit_cost, s.cost_currency ?? 'PEN')} c/u`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Sin detalle'}
                </div>
              </div>
              {editable && (
                <div className="flex gap-0.5">
                  <Button variant="ghost" size="icon-xs" onClick={() => setEditing(s)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => setDeleting(s)}>
                    <Trash2 />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setEditing(null)}>
          <Plus /> Agregar piedra
        </Button>
      )}
      <StoneDialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} variantId={variantId} productId={productId} stone={editing} />
      <Confirm
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="¿Quitar esta piedra?"
        description={deleting && `${deleting.quantity} × ${deleting.stone_name}`}
        confirmLabel="Quitar"
        destructive
        loading={del.isPending}
        onConfirm={() => del.mutate(undefined)}
      />
    </div>
  );
}

// ---- precios ------------------------------------------------------------------------
function PriceEditor({ variantId, productId, prices, weight }: { variantId: number; productId: number; prices: PriceRow[]; weight: number | null }) {
  const { data: lk } = useLookups();
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState({ mode: 'manual', amount: '', margin_pct: '', price_per_gram: '' });
  const [history, setHistory] = useState(false);
  const save = useSave((b: typeof form & { price_list_id: number }) => api.post(`/variants/${variantId}/prices`, b), {
    success: 'Precio guardado (el anterior queda en el historial)',
    invalidate: [['product', productId], ['products']],
    onSuccess: () => setEditing(null),
  });
  const hist = useQuery({
    queryKey: ['price-history', variantId],
    queryFn: () => api.get<{ id: number; mode: string; amount: number; valid_from: string; valid_to: string | null; list_name: string; user_name: string }[]>(`/variants/${variantId}/price-history`),
    enabled: history,
  });
  if (!lk) return null;

  return (
    <div>
      <ul className="divide-y rounded-lg border">
        {lk.priceLists
          .filter((l) => l.is_active)
          .map((l) => {
            const p = prices.find((x) => x.price_list_id === l.id && x.min_quantity <= 1) ?? prices.find((x) => x.price_list_id === l.id);
            const open = editing === l.id;
            return (
              <li key={l.id} className="px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">{l.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p ? (
                        <>
                          {PriceMode.label(p.mode as never)}
                          {p.mode !== 'manual' && p.margin_pct != null && ` · margen ${p.margin_pct}%`}
                          {p.mode === 'by_weight' && p.price_per_gram && ` · ${money(p.price_per_gram)}/g`}
                        </>
                      ) : (
                        'Sin precio'
                      )}
                    </div>
                  </div>
                  <div className="tabular text-right text-[15px] font-semibold">{p ? money(p.effective ?? p.amount, l.currency_code) : '—'}</div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => {
                      setEditing(open ? null : l.id);
                      setForm({ mode: p?.mode ?? 'manual', amount: str(p?.amount), margin_pct: str(p?.margin_pct), price_per_gram: str(p?.price_per_gram) });
                    }}
                  >
                    <Pencil />
                  </Button>
                </div>
                {open && (
                  <div className="animate-pop-in mt-3 grid gap-3 rounded-md bg-muted/50 p-3 sm:grid-cols-4">
                    <Field label="Modo" className="sm:col-span-4">
                      <div className="flex gap-1.5">
                        {PriceMode.options.map((o) => (
                          <button
                            key={o.value}
                            type="button"
                            onClick={() => setForm({ ...form, mode: o.value })}
                            className={cn(
                              'flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                              form.mode === o.value ? 'border-primary bg-card shadow-xs' : 'text-muted-foreground hover:bg-card',
                            )}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </Field>
                    {form.mode === 'manual' ? (
                      <Field label="Monto" error={save.fields.amount} className="sm:col-span-2">
                        <Input autoFocus value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" suffix={l.currency_code} />
                      </Field>
                    ) : (
                      <>
                        <Field label="Margen" hint={`Vacío = ${l.default_margin_pct ?? 0}% de la lista`} className="sm:col-span-2">
                          <Input value={form.margin_pct} onChange={(e) => setForm({ ...form, margin_pct: e.target.value })} inputMode="decimal" suffix="%" />
                        </Field>
                        {form.mode === 'by_weight' && (
                          <Field label="Precio del gramo" hint={`Vacío = cotización del día · peso ${grams(weight)}`} className="sm:col-span-2">
                            <Input value={form.price_per_gram} onChange={(e) => setForm({ ...form, price_per_gram: e.target.value })} inputMode="decimal" suffix="/g" />
                          </Field>
                        )}
                      </>
                    )}
                    <div className="flex items-end justify-end gap-2 sm:col-span-4">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        loading={save.isPending}
                        onClick={() => save.mutate({ ...form, amount: form.mode === 'manual' ? form.amount : form.amount || '0', price_list_id: l.id })}
                      >
                        Guardar precio
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
      </ul>
      <Button variant="ghost" size="sm" className="mt-1.5" onClick={() => setHistory(!history)}>
        <History /> {history ? 'Ocultar historial' : 'Ver historial de precios'}
      </Button>
      {history && (
        <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border text-xs">
          {hist.data?.map((h) => (
            <div key={h.id} className="flex items-center gap-2 border-b px-3 py-1.5 last:border-0">
              <span className="w-28 truncate">{h.list_name}</span>
              <span className="tabular w-24 text-right font-medium">{money(h.amount)}</span>
              <span className="flex-1 text-muted-foreground">
                {dateTime(h.valid_from)} → {h.valid_to ? dateTime(h.valid_to) : 'vigente'}
              </span>
              <span className="text-muted-foreground">{h.user_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- costo ------------------------------------------------------------------------------
function CostEditor({ variantId, productId, cost }: { variantId: number; productId: number; cost: CostRow | undefined }) {
  const keys = ['metal_cost', 'stone_cost', 'labor_cost', 'plating_cost', 'packaging_cost', 'other_cost'] as const;
  const labels = { metal_cost: 'Metal', stone_cost: 'Piedras', labor_cost: 'Mano de obra', plating_cost: 'Baño', packaging_cost: 'Empaque', other_cost: 'Otros' };
  const init = () => Object.fromEntries(keys.map((k) => [k, str(cost?.[k] || '')])) as Record<(typeof keys)[number], string>;
  const [v, setV] = useState(init);
  useEffect(() => setV(init()), [cost?.total_cost]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useSave((b: typeof v) => api.post(`/variants/${variantId}/cost`, { ...b, currency_code: 'PEN' }), {
    success: 'Costo guardado',
    invalidate: [['product', productId]],
  });
  const total = keys.reduce((a, k) => a + (Number(v[k]) || 0), 0);
  return (
    <div className="rounded-lg border p-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {keys.map((k) => (
          <Field key={k} label={labels[k]}>
            <Input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} inputMode="decimal" suffix="S/" />
          </Field>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[13px]">
          Total: <span className="tabular font-semibold">{money(total)}</span>
        </span>
        <Button size="sm" variant="outline" loading={save.isPending} onClick={() => save.mutate(v)}>
          Guardar costo
        </Button>
      </div>
    </div>
  );
}

// ---- panel lateral completo -----------------------------------------------------------------
export function VariantSheet({
  open,
  onOpenChange,
  productId,
  sizeScaleId,
  defaultTracking,
  variant,
  stones,
  prices,
  stock,
  cost,
  canSeeCost,
  nominalWeight,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productId: number;
  sizeScaleId: number | null;
  defaultTracking: string;
  variant: Variant | null;
  stones: VariantStone[];
  prices: PriceRow[];
  stock: StockRow[];
  cost: CostRow | undefined;
  canSeeCost: boolean;
  nominalWeight: number | null;
}) {
  const { userId } = useSession();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width="max-w-2xl"
      title={variant ? <Mono className="text-base">{variant.sku}</Mono> : 'Nueva variante'}
      description={
        variant
          ? [variant.legacy_code && `Código viejo ${variant.legacy_code}`, TrackingMode.label(variant.tracking_mode)].filter(Boolean).join(' · ')
          : 'Talla, color de metal y color de piedra definen el SKU'
      }
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          <Button type="submit" form="variant-form">
            {variant ? 'Guardar variante' : 'Crear variante'}
          </Button>
        </>
      }
    >
      <VariantForm
        productId={productId}
        sizeScaleId={sizeScaleId}
        defaultTracking={defaultTracking}
        variant={variant}
        onDone={() => !variant && onOpenChange(false)}
      />
      {variant && (
        <div className="mt-6 space-y-6">
          <Separator />
          <section>
            <h4 className="mb-2 text-[13px] font-semibold">Piedras</h4>
            <StonesList stones={stones} variantId={variant.id} productId={productId} />
          </section>
          <section>
            <h4 className="mb-2 text-[13px] font-semibold">Precios por lista</h4>
            <PriceEditor variantId={variant.id} productId={productId} prices={prices} weight={variant.weight_g ?? nominalWeight} />
          </section>
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
              Costo {!canSeeCost && <Lock className="size-3.5 text-muted-foreground" />}
            </h4>
            {canSeeCost ? (
              <CostEditor variantId={variant.id} productId={productId} cost={cost} />
            ) : (
              <p className="text-[13px] text-muted-foreground">
                {userId ? 'Su usuario no tiene permiso para ver costos.' : 'Elija un usuario para ver costos.'}
              </p>
            )}
          </section>
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-[13px] font-semibold">Stock por sede</h4>
              <Link to={`/inventario/kardex?variant=${variant.id}`} className="text-xs text-muted-foreground hover:text-foreground">
                Ver kardex →
              </Link>
            </div>
            {stock.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {stock.map((s) => (
                  <div key={s.location_id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                    <span className="text-[13px]">
                      <Mono className="mr-1.5 text-muted-foreground">{s.location_code}</Mono>
                      {s.location_name}
                    </span>
                    <span className="tabular text-[13px] font-semibold">
                      {qty(s.on_hand)}
                      {s.reserved > 0 && <span className="ml-1 text-xs font-normal text-muted-foreground">({qty(s.reserved)} apart.)</span>}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Sin stock en ninguna sede" description="Entra con un inventario físico, una compra o al dar de alta piezas." />
            )}
            {variant.tracking_mode === 'serial' && (
              <Link to={`/inventario/piezas?variant=${variant.id}`} className="mt-2 inline-block text-xs font-medium text-gold-foreground hover:underline">
                {variant.serials} pieza(s) registradas →
              </Link>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}

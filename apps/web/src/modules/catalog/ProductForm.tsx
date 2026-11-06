import { useState } from 'react';
import { Gender, ProductKind, ProductStatus, TrackingMode } from '@minitta/shared';
import { useLookups, type Category } from '@/lib/lookups';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Separator } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

export interface ProductFormValues {
  code: string;
  name: string;
  kind: string;
  status: string;
  short_desc: string;
  long_desc: string;
  care_notes: string;
  internal_notes: string;
  material_id: string;
  finish_code: string;
  collection_id: string;
  supplier_id: string;
  gender: string;
  category_id: string;
  nominal_weight_g: string;
  width_mm: string;
  height_mm: string;
  depth_mm: string;
  diameter_mm: string;
  thickness_mm: string;
  size_scale_id: string;
  is_made_to_order: boolean;
  is_engravable: boolean;
  is_repairable: boolean;
  default_tracking_mode: string;
  tax_category_code: string;
  sale_unit_code: string;
  warranty_months: string;
  launched_on: string;
  tag_ids: number[];
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function emptyProduct(): ProductFormValues {
  return {
    code: '', name: '', kind: 'jewelry', status: 'draft', short_desc: '', long_desc: '', care_notes: '',
    internal_notes: '', material_id: '', finish_code: '', collection_id: '', supplier_id: '', gender: '',
    category_id: '', nominal_weight_g: '', width_mm: '', height_mm: '', depth_mm: '', diameter_mm: '',
    thickness_mm: '', size_scale_id: '', is_made_to_order: false, is_engravable: false, is_repairable: true,
    default_tracking_mode: 'quantity', tax_category_code: 'igv_18', sale_unit_code: 'und', warranty_months: '',
    launched_on: '', tag_ids: [],
  };
}

export function productToForm(p: Record<string, unknown>): ProductFormValues {
  const e = emptyProduct();
  const out = { ...e } as Record<string, unknown>;
  for (const k of Object.keys(e)) {
    const v = p[k];
    out[k] = typeof (e as unknown as Record<string, unknown>)[k] === 'boolean' ? Boolean(v) : k === 'tag_ids' ? (v ?? []) : s(v);
  }
  return out as unknown as ProductFormValues;
}

export function categoryOptions(cats: Category[]) {
  return cats
    .filter((c) => c.is_active)
    .map((c) => ({ value: c.id, label: `${'   '.repeat(c.level - 1)}${c.name}`, level: c.level }));
}

export function ProductFormFields({
  v,
  set,
  errors,
  compact,
}: {
  v: ProductFormValues;
  set: <K extends keyof ProductFormValues>(k: K, val: ProductFormValues[K]) => void;
  errors: Record<string, string[]>;
  compact?: boolean;
}) {
  const { data: lk } = useLookups();
  const [showMore, setShowMore] = useState(!compact);
  if (!lk) return null;
  const bind = (k: keyof ProductFormValues) => ({
    value: v[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      set(k, e.target.value as never),
    'aria-invalid': !!errors[k],
  });

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-6">
        <Field label="Código" required error={errors.code} hint="Base del SKU: RIV-P2" className="sm:col-span-2">
          <Input {...bind('code')} className="font-mono uppercase" placeholder="RIV-P2" />
        </Field>
        <Field label="Nombre" required error={errors.name} className="sm:col-span-4">
          <Input {...bind('name')} placeholder="Riviera cruzada P2" />
        </Field>
        <Field label="Categoría" error={errors.category_id} className="sm:col-span-3">
          <Select {...bind('category_id')}>
            <option value="">Sin categoría</option>
            {categoryOptions(lk.categories).map((c) => (
              <option key={c.value} value={c.value} className={cn(c.level === 1 && 'font-semibold')}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Material principal" error={errors.material_id} className="sm:col-span-3">
          <Select {...bind('material_id')}>
            <option value="">—</option>
            {lk.materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tipo" className="sm:col-span-2">
          <Select {...bind('kind')}>
            {ProductKind.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estado" hint="Borrador = no vendible" className="sm:col-span-2">
          <Select {...bind('status')}>
            {ProductStatus.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Control de stock" hint="Por defecto para variantes nuevas" className="sm:col-span-2">
          <Select {...bind('default_tracking_mode')}>
            {TrackingMode.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </section>

      <section className="space-y-3">
        <h4 className="text-[13px] font-semibold">Ficha técnica</h4>
        <p className="-mt-2 text-xs text-muted-foreground">
          Lo que en el sistema viejo vivía en la descripción ("alt 6.4cm", "19*19cm").
        </p>
        <div className="grid gap-4 sm:grid-cols-6">
          <Field label="Peso nominal" error={errors.nominal_weight_g} className="sm:col-span-2">
            <Input {...bind('nominal_weight_g')} inputMode="decimal" suffix="g" />
          </Field>
          <Field label="Escala de tallas" className="sm:col-span-2">
            <Select {...bind('size_scale_id')}>
              <option value="">No se talla</option>
              {lk.sizeScales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Acabado" className="sm:col-span-2">
            <Select {...bind('finish_code')}>
              <option value="">—</option>
              {lk.finishes.map((f) => (
                <option key={f.code} value={f.code}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
          {(['height_mm', 'width_mm', 'depth_mm', 'diameter_mm', 'thickness_mm'] as const).map((k) => (
            <Field
              key={k}
              label={{ height_mm: 'Alto', width_mm: 'Ancho', depth_mm: 'Profundidad', diameter_mm: 'Diámetro', thickness_mm: 'Espesor' }[k]}
              error={errors[k]}
              className="sm:col-span-2 lg:col-span-1"
            >
              <Input {...bind(k)} inputMode="decimal" suffix="mm" />
            </Field>
          ))}
          <Field label="Género" className="sm:col-span-2 lg:col-span-1">
            <Select {...bind('gender')}>
              <option value="">—</option>
              {Gender.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </section>

      {compact && !showMore ? (
        <button type="button" className="text-[13px] font-medium text-gold-foreground underline-offset-4 hover:underline" onClick={() => setShowMore(true)}>
          + Descripción, colección, etiquetas y más
        </button>
      ) : (
        <>
          <Separator />
          <section className="grid gap-4 sm:grid-cols-6">
            <Field label="Descripción corta" className="sm:col-span-6">
              <Input {...bind('short_desc')} placeholder="Para etiquetas y la tienda online" />
            </Field>
            <Field label="Descripción" className="sm:col-span-6">
              <Textarea {...bind('long_desc')} rows={3} />
            </Field>
            <Field label="Colección" className="sm:col-span-2">
              <Select {...bind('collection_id')}>
                <option value="">—</option>
                {lk.collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Proveedor" className="sm:col-span-2">
              <Select {...bind('supplier_id')}>
                <option value="">—</option>
                {lk.suppliers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Unidad de venta" hint="Aretes: par" className="sm:col-span-1">
              <Select {...bind('sale_unit_code')}>
                {lk.units
                  .filter((u) => u.kind === 'count')
                  .map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Garantía" className="sm:col-span-1">
              <Input {...bind('warranty_months')} inputMode="numeric" suffix="meses" />
            </Field>
            <Field label="Impuesto" className="sm:col-span-2">
              <Select {...bind('tax_category_code')}>
                {lk.taxCategories.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Lanzamiento" className="sm:col-span-2">
              <Input type="date" {...bind('launched_on')} />
            </Field>
            <div className="flex flex-col justify-end gap-2 sm:col-span-2">
              <Checkbox checked={v.is_engravable} onCheckedChange={(x) => set('is_engravable', x)} label="Admite grabado" />
              <Checkbox checked={v.is_made_to_order} onCheckedChange={(x) => set('is_made_to_order', x)} label="Se fabrica a pedido" />
              <Checkbox checked={v.is_repairable} onCheckedChange={(x) => set('is_repairable', x)} label="Se puede reparar" />
            </div>
            {lk.tags.length > 0 && (
              <Field label="Temas y ocasiones" className="sm:col-span-6">
                <div className="flex flex-wrap gap-1.5">
                  {lk.tags.map((t) => {
                    const on = v.tag_ids.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => set('tag_ids', on ? v.tag_ids.filter((x) => x !== t.id) : [...v.tag_ids, t.id])}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-xs transition-colors',
                          on ? 'border-gold bg-gold-soft text-gold-foreground' : 'hover:bg-accent',
                        )}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}
            <Field label="Notas internas" hint="Lo que hoy se apunta en el cuaderno" className="sm:col-span-6">
              <Textarea {...bind('internal_notes')} rows={2} />
            </Field>
          </section>
        </>
      )}
    </div>
  );
}

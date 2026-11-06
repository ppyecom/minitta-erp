import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Diamond, FolderTree, Palette, Plus, Shapes, Sparkles, Tags } from 'lucide-react';
import { MaterialFamily, StoneOrigin } from '@minitta/shared';
import { api } from '@/lib/api';
import { useLookups, type Lookups } from '@/lib/lookups';
import { useSave } from '@/lib/forms';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Badge, Card, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/overlay';
import { DataTable, Mono, PageHeader, SearchInput } from '@/components/common';
import { categoryOptions } from './ProductForm';

type Usage = { kind: string; id: number; n: number }[];

function AddDialog({
  title,
  description,
  open,
  onOpenChange,
  onSave,
  saving,
  children,
}: {
  title: string;
  description?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: () => void;
  saving: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={saving} onClick={onSave}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-3">{children}</div>
    </Dialog>
  );
}

function useAdd<T extends Record<string, unknown>>(url: string, blank: T, label: string) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<T>(blank);
  const save = useSave(() => api.post(url, v), {
    success: `${label} creado`,
    invalidate: [['lookups'], ['masters-usage']],
    onSuccess: () => {
      setOpen(false);
      setV(blank);
    },
  });
  return { open, setOpen: (o: boolean) => (setOpen(o), o && setV(blank)), v, setV, save };
}

function StonesTab({ lk, usage, q }: { lk: Lookups; usage: Usage; q: string }) {
  const a = useAdd('/masters/stones', { code: '', name: '', origin: 'natural', is_gem: false, default_unit: 'ct' }, 'Piedra');
  const rows = lk.stones.filter((s) => !q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q));
  return (
    <>
      <Card>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          dense
          columns={[
            { key: 'n', header: 'Piedra', cell: (r) => <span className="font-medium">{r.name}</span> },
            { key: 'c', header: 'Código', cell: (r) => <Mono>{r.code}</Mono> },
            { key: 'o', header: 'Origen', cell: (r) => StoneOrigin.label(r.origin as never) },
            { key: 'g', header: 'Tipo', cell: (r) => (r.is_gem ? <Badge tone="gold">Gema fina</Badge> : <Badge>Bisutería</Badge>) },
            { key: 'u', header: 'En uso', align: 'right', cell: (r) => <span className="tabular text-muted-foreground">{usage.find((x) => x.kind === 'stone' && x.id === r.id)?.n ?? 0}</span> },
          ]}
        />
      </Card>
      <Button className="mt-3" variant="outline" onClick={() => a.setOpen(true)}>
        <Plus /> Nueva piedra
      </Button>
      <AddDialog title="Nueva piedra" open={a.open} onOpenChange={a.setOpen} onSave={() => a.save.mutate(undefined)} saving={a.save.isPending}>
        <Field label="Nombre" required error={a.save.fields.name}>
          <Input value={a.v.name} onChange={(e) => a.setV({ ...a.v, name: e.target.value })} placeholder="Spondylus" />
        </Field>
        <Field label="Código" required error={a.save.fields.code}>
          <Input value={a.v.code} onChange={(e) => a.setV({ ...a.v, code: e.target.value })} className="font-mono uppercase" />
        </Field>
        <Field label="Origen">
          <Select value={a.v.origin} onChange={(e) => a.setV({ ...a.v, origin: e.target.value })}>
            {StoneOrigin.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox checked={a.v.is_gem} onCheckedChange={(x) => a.setV({ ...a.v, is_gem: x, default_unit: x ? 'ct' : 'und' })} label="Gema fina" description="Pide quilates y admite certificado" />
      </AddDialog>
    </>
  );
}

function MaterialsTab({ lk, usage, q }: { lk: Lookups; usage: Usage; q: string }) {
  const a = useAdd('/masters/materials', { code: '', name: '', family: 'gold', karat: '', purity_millis: '', is_precious: true, is_priced_by_weight: true }, 'Material');
  const rows = lk.materials.filter((s) => !q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q));
  return (
    <>
      <Card>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          dense
          columns={[
            { key: 'n', header: 'Material', cell: (r) => <span className="font-medium">{r.name}</span> },
            { key: 'c', header: 'Código', cell: (r) => <Mono>{r.code}</Mono> },
            { key: 'f', header: 'Familia', cell: (r) => MaterialFamily.label(r.family as never) },
            { key: 'k', header: 'Ley', cell: (r) => (r.karat ? `${r.karat}K` : r.purity_millis ? `${r.purity_millis}‰` : '—') },
            { key: 'w', header: 'Al peso', cell: (r) => (r.is_priced_by_weight ? <Badge tone="gold">Sí</Badge> : <span className="text-muted-foreground">No</span>) },
            { key: 'u', header: 'Productos', align: 'right', cell: (r) => <span className="tabular text-muted-foreground">{usage.find((x) => x.kind === 'material' && x.id === r.id)?.n ?? 0}</span> },
          ]}
        />
      </Card>
      <Button className="mt-3" variant="outline" onClick={() => a.setOpen(true)}>
        <Plus /> Nuevo material
      </Button>
      <AddDialog title="Nuevo material" open={a.open} onOpenChange={a.setOpen} onSave={() => a.save.mutate(undefined)} saving={a.save.isPending}>
        <Field label="Nombre" required error={a.save.fields.name}>
          <Input value={a.v.name} onChange={(e) => a.setV({ ...a.v, name: e.target.value })} placeholder="Oro 22K" />
        </Field>
        <Field label="Código" required error={a.save.fields.code}>
          <Input value={a.v.code} onChange={(e) => a.setV({ ...a.v, code: e.target.value })} className="font-mono uppercase" placeholder="AU22" />
        </Field>
        <Field label="Familia">
          <Select value={a.v.family} onChange={(e) => a.setV({ ...a.v, family: e.target.value })}>
            {MaterialFamily.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quilates">
            <Input value={a.v.karat} onChange={(e) => a.setV({ ...a.v, karat: e.target.value })} inputMode="decimal" />
          </Field>
          <Field label="Ley (milésimas)">
            <Input value={a.v.purity_millis} onChange={(e) => a.setV({ ...a.v, purity_millis: e.target.value })} inputMode="numeric" placeholder="916" />
          </Field>
        </div>
        <Checkbox checked={a.v.is_priced_by_weight} onCheckedChange={(x) => a.setV({ ...a.v, is_priced_by_weight: x })} label="Se cotiza al peso" description="Usa el precio del gramo" />
      </AddDialog>
    </>
  );
}

function CategoriesTab({ lk, usage }: { lk: Lookups; usage: Usage }) {
  const a = useAdd('/masters/categories', { parent_id: '', name: '', sort_order: 0 }, 'Categoría');
  return (
    <>
      <Card className="divide-y">
        {lk.categories.map((c) => (
          <div key={c.id} className="flex items-center gap-2 px-5 py-2" style={{ paddingLeft: 20 + (c.level - 1) * 24 }}>
            <FolderTree className={cn('size-4', c.level === 1 ? 'text-gold' : 'text-muted-foreground/60')} />
            <span className={cn('text-[13px]', c.level === 1 && 'font-semibold')}>{c.name}</span>
            <Mono className="text-muted-foreground/70">{c.path}</Mono>
            <span className="tabular ml-auto text-xs text-muted-foreground">{usage.find((x) => x.kind === 'category' && x.id === c.id)?.n ?? 0}</span>
          </div>
        ))}
      </Card>
      <Button className="mt-3" variant="outline" onClick={() => a.setOpen(true)}>
        <Plus /> Nueva categoría
      </Button>
      <AddDialog title="Nueva categoría" description="Jerárquica: un producto puede estar en varios niveles sin cambiar su código." open={a.open} onOpenChange={a.setOpen} onSave={() => a.save.mutate(undefined)} saving={a.save.isPending}>
        <Field label="Dentro de">
          <Select value={a.v.parent_id} onChange={(e) => a.setV({ ...a.v, parent_id: e.target.value })}>
            <option value="">(Raíz)</option>
            {categoryOptions(lk.categories).map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nombre" required error={a.save.fields.name}>
          <Input value={a.v.name} onChange={(e) => a.setV({ ...a.v, name: e.target.value })} />
        </Field>
      </AddDialog>
    </>
  );
}

function SimpleTab({
  rows,
  url,
  label,
  withHex,
  codeHint,
}: {
  rows: { code?: string; slug?: string; name: string; hex?: string | null }[];
  url: string;
  label: string;
  withHex?: boolean;
  codeHint?: string;
}) {
  const a = useAdd(url, { code: '', name: '', hex: '' }, label);
  return (
    <>
      <Card className="p-4">
        <div className="flex flex-wrap gap-2">
          {rows.map((r) => (
            <span key={r.code ?? r.slug} className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-[13px]">
              {withHex && <span className="size-3.5 rounded-full border" style={{ background: r.hex ?? 'transparent' }} />}
              {r.name}
              <Mono className="text-muted-foreground/70">{r.code ?? r.slug}</Mono>
            </span>
          ))}
        </div>
      </Card>
      <Button className="mt-3" variant="outline" onClick={() => a.setOpen(true)}>
        <Plus /> Agregar
      </Button>
      <AddDialog title={`Nuevo: ${label.toLowerCase()}`} open={a.open} onOpenChange={a.setOpen} onSave={() => a.save.mutate(undefined)} saving={a.save.isPending}>
        <Field label="Nombre" required error={a.save.fields.name}>
          <Input value={a.v.name} onChange={(e) => a.setV({ ...a.v, name: e.target.value })} />
        </Field>
        <Field label="Código" required hint={codeHint} error={a.save.fields.code}>
          <Input value={a.v.code} onChange={(e) => a.setV({ ...a.v, code: e.target.value })} className="font-mono" />
        </Field>
        {withHex && (
          <Field label="Color">
            <div className="flex gap-2">
              <input type="color" value={a.v.hex || '#cccccc'} onChange={(e) => a.setV({ ...a.v, hex: e.target.value })} className="h-9 w-12 rounded border" />
              <Input value={a.v.hex} onChange={(e) => a.setV({ ...a.v, hex: e.target.value })} placeholder="#D4AF37" />
            </div>
          </Field>
        )}
      </AddDialog>
    </>
  );
}

export function MastersPage() {
  const { data: lk } = useLookups();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const tab = sp.get('tab') ?? 'piedras';
  const { data: usage = [] } = useQuery({ queryKey: ['masters-usage'], queryFn: () => api.get<Usage>('/masters/usage') });
  if (!lk) return null;
  const ql = q.toLowerCase();
  return (
    <>
      <PageHeader
        title="Maestros del catálogo"
        description="Las tablas de referencia. Reemplazan los códigos de una letra del sistema viejo: cada concepto en su lugar."
        actions={(tab === 'piedras' || tab === 'materiales') && <SearchInput value={q} onChange={setQ} placeholder="Filtrar…" className="sm:w-56" />}
      />
      <Tabs value={tab} onValueChange={(t) => setSp({ tab: t }, { replace: true })}>
        <TabsList className="mb-5">
          <TabsTrigger value="piedras" count={lk.stones.length}>
            <Diamond /> Piedras
          </TabsTrigger>
          <TabsTrigger value="materiales" count={lk.materials.length}>
            <Sparkles /> Materiales
          </TabsTrigger>
          <TabsTrigger value="categorias" count={lk.categories.length}>
            <FolderTree /> Categorías
          </TabsTrigger>
          <TabsTrigger value="colores">
            <Palette /> Colores
          </TabsTrigger>
          <TabsTrigger value="formas">
            <Shapes /> Formas y engastes
          </TabsTrigger>
          <TabsTrigger value="temas">
            <Tags /> Colecciones y temas
          </TabsTrigger>
        </TabsList>
        <TabsContent value="piedras">
          <StonesTab lk={lk} usage={usage} q={ql} />
        </TabsContent>
        <TabsContent value="materiales">
          <MaterialsTab lk={lk} usage={usage} q={ql} />
        </TabsContent>
        <TabsContent value="categorias">
          <CategoriesTab lk={lk} usage={usage} />
        </TabsContent>
        <TabsContent value="colores" className="space-y-6">
          <section>
            <h3 className="mb-2 text-[13px] font-semibold">Colores de piedra</h3>
            <SimpleTab rows={lk.colors} url="/masters/colors" label="Color" withHex codeHint="minúsculas: rojo, lavanda" />
          </section>
          <section>
            <h3 className="mb-2 text-[13px] font-semibold">Colores de metal</h3>
            <SimpleTab rows={lk.metalColors} url="/masters/metal-colors" label="Color de metal" withHex />
          </section>
          <section>
            <h3 className="mb-2 text-[13px] font-semibold">Acabados</h3>
            <SimpleTab rows={lk.finishes} url="/masters/finishes" label="Acabado" />
          </section>
        </TabsContent>
        <TabsContent value="formas" className="space-y-6">
          <section>
            <h3 className="mb-2 text-[13px] font-semibold">Formas / tallas de piedra</h3>
            <SimpleTab rows={lk.stoneCuts} url="/masters/stone-cuts" label="Forma" />
          </section>
          <section>
            <h3 className="mb-2 text-[13px] font-semibold">Tipos de engaste</h3>
            <SimpleTab rows={lk.settingTypes} url="/masters/setting-types" label="Engaste" />
          </section>
        </TabsContent>
        <TabsContent value="temas" className="space-y-6">
          <section>
            <h3 className="mb-2 text-[13px] font-semibold">Colecciones</h3>
            <SimpleTab rows={lk.collections} url="/masters/collections" label="Colección" />
          </section>
          <section>
            <h3 className="mb-2 text-[13px] font-semibold">Temas y ocasiones</h3>
            <SimpleTab rows={lk.tags} url="/masters/tags" label="Tema" codeHint="tumi, bodas-de-oro" />
          </section>
        </TabsContent>
      </Tabs>
    </>
  );
}

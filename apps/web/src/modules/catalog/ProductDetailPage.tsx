import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, Boxes, FileClock, ImageOff, ImagePlus, Images, Layers, Plus, ScrollText, Star, Trash2, Upload } from 'lucide-react';
import { ProductKind, TrackingMode } from '@minitta/shared';
import { api } from '@/lib/api';
import { categoryLabel, useLookups } from '@/lib/lookups';
import { useSave } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { cn, dateTime, grams, money, qty } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { Confirm, DataTable, EmptyState, Mono, PageHeader, ProductStatusBadge, Stat, Thumb } from '@/components/common';
import { MovementDialog } from '@/modules/inventory/MovementDialog';
import { ProductFormFields, productToForm, type ProductFormValues } from './ProductForm';
import { VariantSheet, type CostRow, type PriceRow, type StockRow, type Variant, type VariantStone } from './VariantSheet';

interface Media {
  id: number;
  url: string;
  is_primary: boolean;
  alt_text: string | null;
  width_px: number | null;
  height_px: number | null;
  bytes: number | null;
  variant_id: number | null;
}

interface ProductDetail extends Record<string, unknown> {
  id: number;
  code: string;
  name: string;
  kind: string;
  status: string;
  legacy_code: string | null;
  category_id: number | null;
  material_name: string | null;
  size_scale_id: number | null;
  default_tracking_mode: string;
  nominal_weight_g: number | null;
  created_at: string;
  updated_at: string;
  media: Media[];
  variants: Variant[];
  stones: VariantStone[];
  prices: PriceRow[];
  stock: StockRow[];
  costs: CostRow[] | null;
  can_see_cost: boolean;
}

function ImagesTab({ product }: { product: ProductDetail }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [deleting, setDeleting] = useState<Media | null>(null);
  const upload = useSave(
    (files: File[]) => {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      return api.post(`/products/${product.id}/media`, fd);
    },
    { success: 'Imágenes subidas', invalidate: [['product', product.id], ['products']] },
  );
  const primary = useSave((id: number) => api.patch(`/products/media/${id}/primary`), {
    invalidate: [['product', product.id], ['products']],
  });
  const del = useSave((id: number) => api.del(`/products/media/${id}`), {
    success: 'Imagen eliminada',
    invalidate: [['product', product.id], ['products']],
    onSuccess: () => setDeleting(null),
  });
  const send = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length) upload.mutate(files);
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          send(e.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
          drag ? 'border-gold bg-gold-soft/40' : 'hover:border-muted-foreground/40 hover:bg-muted/40',
        )}
      >
        <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-muted">
          {upload.isPending ? <Upload className="size-5 animate-bounce text-muted-foreground" /> : <ImagePlus className="size-5 text-muted-foreground" />}
        </div>
        <div className="text-sm font-medium">{upload.isPending ? 'Subiendo…' : 'Arrastre fotos aquí o haga clic para elegir'}</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Se guardan en la carpeta <Mono>uploads/</Mono> de esta PC, optimizadas a WebP (máx. 1600 px).
        </p>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => send(e.target.files)} />
      </div>

      {product.media.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {product.media.map((m) => (
            <div key={m.id} className="group relative overflow-hidden rounded-xl border bg-muted/40">
              {m.url.startsWith('pendiente') ? (
                // foto del sistema viejo: la migración guarda la ruta, no el archivo
                <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 p-3 text-center">
                  <ImageOff className="size-5 text-muted-foreground/60" />
                  <span className="text-xs font-medium">Foto del sistema viejo</span>
                  <Mono className="max-w-full truncate text-[11px] text-muted-foreground">{m.url.replace('pendiente://', '')}</Mono>
                </div>
              ) : (
                <img src={m.url} alt={m.alt_text ?? ''} className="aspect-square w-full object-cover" />
              )}
              {m.is_primary && (
                <Badge tone="gold" className="absolute left-2 top-2 shadow-sm">
                  <Star className="fill-current" /> Principal
                </Badge>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                <span className="truncate text-[11px] text-white/90">
                  {m.width_px}×{m.height_px} · {m.bytes ? `${Math.round(m.bytes / 1024)} KB` : ''}
                </span>
                <div className="flex gap-1">
                  {!m.is_primary && (
                    <Button size="icon-xs" variant="secondary" onClick={() => primary.mutate(m.id)} title="Hacer principal">
                      <Star />
                    </Button>
                  )}
                  <Button size="icon-xs" variant="secondary" onClick={() => setDeleting(m)} title="Eliminar">
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Confirm
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="¿Eliminar esta imagen?"
        description="Se borra el archivo de la carpeta uploads/."
        confirmLabel="Eliminar"
        destructive
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </div>
  );
}

function FichaTab({ product }: { product: ProductDetail }) {
  const [v, setV] = useState<ProductFormValues>(() => productToForm(product));
  useEffect(() => setV(productToForm(product)), [product.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useSave((b: ProductFormValues) => api.put(`/products/${product.id}`, b), {
    success: 'Producto guardado',
    invalidate: [['product', product.id], ['products']],
  });
  return (
    <Card className="p-5">
      <ProductFormFields v={v} set={(k, val) => setV((p) => ({ ...p, [k]: val }))} errors={save.fields} />
      <div className="mt-6 flex justify-end gap-2 border-t pt-4">
        <Button variant="outline" onClick={() => setV(productToForm(product))}>
          Descartar cambios
        </Button>
        <Button loading={save.isPending} onClick={() => save.mutate(v)}>
          Guardar
        </Button>
      </div>
    </Card>
  );
}

function HistoryTab({ productId }: { productId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['audit', 'catalog.product', productId],
    queryFn: () =>
      api.get<{ id: number; action: string; changed_at: string; client_info: string | null; diff: Record<string, [unknown, unknown]>; user_name: string | null }[]>(
        `/audit/catalog.product/${productId}`,
      ),
  });
  if (isLoading) return <Skeleton className="h-40" />;
  if (!data?.length) return <EmptyState title="Sin cambios registrados" icon={FileClock} />;
  return (
    <Card>
      <ul className="divide-y">
        {data.map((a) => (
          <li key={a.id} className="px-5 py-3">
            <div className="flex items-center gap-2 text-[13px]">
              <Badge tone={a.action === 'insert' ? 'success' : a.action === 'delete' ? 'danger' : 'info'}>
                {a.action === 'insert' ? 'Creado' : a.action === 'delete' ? 'Eliminado' : 'Modificado'}
              </Badge>
              <span className="font-medium">{a.user_name ?? 'Sin usuario'}</span>
              <span className="text-muted-foreground">· {dateTime(a.changed_at)}</span>
              {a.client_info && <span className="text-xs text-muted-foreground">· {a.client_info}</span>}
            </div>
            {a.action === 'update' && (
              <div className="mt-1.5 space-y-0.5 text-xs">
                {Object.entries(a.diff).map(([k, [from, to]]) => (
                  <div key={k} className="flex gap-2">
                    <Mono className="w-36 shrink-0 text-muted-foreground">{k}</Mono>
                    <span className="truncate text-destructive line-through">{String(from ?? '∅')}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="truncate text-success">{String(to ?? '∅')}</span>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ProductDetailPage() {
  const id = Number(useParams().id);
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'variantes';
  const { data: lk } = useLookups();
  const { userId } = useSession();
  const { data: p, isLoading } = useQuery({
    // el usuario va en la clave: de él depende si se ven los costos
    queryKey: ['product', id, userId],
    queryFn: () => api.get<ProductDetail>(`/products/${id}`),
  });
  const [variantId, setVariantId] = useState<number | null | undefined>(undefined);
  const [moving, setMoving] = useState(false);

  if (isLoading || !p) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  const usable = p.media.filter((m) => !m.url.startsWith('pendiente'));
  const cover = usable.find((m) => m.is_primary) ?? usable[0];
  const variant = p.variants.find((v) => v.id === variantId) ?? null;
  const stockOf = (vid: number) => p.stock.filter((s) => s.variant_id === vid);
  const totalStock = p.stock.reduce((a, s) => a + Number(s.on_hand), 0);
  const pub = lk?.priceLists.find((l) => l.code === 'publico');

  return (
    <>
      <PageHeader
        back={{ to: '/catalogo/productos', label: 'Productos' }}
        title={
          <span className="flex items-center gap-3">
            <Thumb src={cover?.url} size={44} className="rounded-lg" />
            <span className="min-w-0">
              <span className="block truncate">{p.name}</span>
              <span className="block text-[13px] font-normal text-muted-foreground">
                <Mono>{p.code}</Mono>
                {p.legacy_code && ` · antes ${p.legacy_code}`}
              </span>
            </span>
          </span>
        }
        meta={
          <>
            <ProductStatusBadge status={p.status} />
            <Badge tone="outline">{ProductKind.label(p.kind as never)}</Badge>
            {p.material_name && <Badge tone="gold">{p.material_name}</Badge>}
            {lk && p.category_id && <Badge tone="outline">{categoryLabel(lk.categories, p.category_id)}</Badge>}
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setMoving(true)} disabled={!p.variants.length}>
              <ArrowRightLeft /> Registrar movimiento
            </Button>
            <Button onClick={() => setVariantId(null)}>
              <Plus /> Nueva variante
            </Button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 rounded-xl border bg-card px-5 py-4 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Variantes" value={p.variants.filter((v) => v.status !== 'archived').length} />
        <Stat label="Stock total" value={qty(totalStock)} />
        <Stat label="Peso nominal" value={grams(p.nominal_weight_g)} />
        <Stat label="Piedras (filas)" value={p.stones.length} />
        <Stat label="Creado" value={dateTime(p.created_at)} />
        <Stat label="Modificado" value={dateTime(p.updated_at)} />
      </div>

      <Tabs value={tab} onValueChange={(t) => setSp({ tab: t }, { replace: true })}>
        <TabsList className="mb-5">
          <TabsTrigger value="variantes" count={p.variants.length}>
            <Layers /> Variantes
          </TabsTrigger>
          <TabsTrigger value="ficha">
            <ScrollText /> Ficha
          </TabsTrigger>
          <TabsTrigger value="imagenes" count={p.media.length}>
            <Images /> Imágenes
          </TabsTrigger>
          <TabsTrigger value="stock">
            <Boxes /> Stock
          </TabsTrigger>
          <TabsTrigger value="historial">
            <FileClock /> Historial
          </TabsTrigger>
        </TabsList>

        <TabsContent value="variantes">
          <Card>
            <DataTable
              rows={p.variants}
              rowKey={(v) => v.id}
              onRowClick={(v) => setVariantId(v.id)}
              columns={[
                {
                  key: 'sku',
                  header: 'SKU',
                  cell: (v) => (
                    <div>
                      <Mono className="font-medium">{v.sku}</Mono>
                      {v.legacy_code && <div className="text-xs text-muted-foreground">antes {v.legacy_code}</div>}
                    </div>
                  ),
                },
                { key: 'size', header: 'Talla', cell: (v) => v.size_value_label ?? v.size_label ?? '—' },
                {
                  key: 'metal',
                  header: 'Metal',
                  cell: (v) => {
                    const c = lk?.metalColors.find((m) => m.code === v.metal_color);
                    return c ? (
                      <span className="flex items-center gap-1.5">
                        <span className="size-3 rounded-full border" style={{ background: c.hex ?? undefined }} />
                        {c.name}
                      </span>
                    ) : (
                      '—'
                    );
                  },
                },
                { key: 'stone', header: 'Piedra', cell: (v) => lk?.colors.find((c) => c.code === v.stone_color)?.name ?? '—', className: 'hidden md:table-cell' },
                {
                  key: 'stones',
                  header: 'Piedras',
                  align: 'right',
                  cell: (v) => {
                    const n = p.stones.filter((s) => s.variant_id === v.id).reduce((a, s) => a + s.quantity, 0);
                    return <span className="tabular">{n || '—'}</span>;
                  },
                  className: 'hidden md:table-cell',
                },
                { key: 'w', header: 'Peso', align: 'right', cell: (v) => <span className="tabular">{grams(v.weight_g ?? p.nominal_weight_g)}</span>, className: 'hidden lg:table-cell' },
                {
                  key: 'track',
                  header: 'Control',
                  cell: (v) => (v.tracking_mode === 'serial' ? <Badge tone="gold">Serial · {v.serials}</Badge> : <Badge>Cantidad</Badge>),
                },
                {
                  key: 'stock',
                  header: 'Stock',
                  align: 'right',
                  cell: (v) => <span className="tabular font-medium">{qty(stockOf(v.id).reduce((a, s) => a + Number(s.on_hand), 0))}</span>,
                },
                {
                  key: 'price',
                  header: 'P. público',
                  align: 'right',
                  cell: (v) => {
                    const pr = p.prices.find((x) => x.variant_id === v.id && x.price_list_id === pub?.id);
                    return <span className="tabular">{pr ? money(pr.effective ?? pr.amount) : '—'}</span>;
                  },
                },
                { key: 'st', header: 'Estado', cell: (v) => <ProductStatusBadge status={v.status} /> },
              ]}
              empty={
                <EmptyState
                  icon={Layers}
                  title="Este producto no tiene variantes"
                  description="Cada talla y color es una variante: es lo que se vende, se cuenta y tiene precio."
                  action={
                    <Button onClick={() => setVariantId(null)}>
                      <Plus /> Agregar la primera variante
                    </Button>
                  }
                />
              }
            />
          </Card>
          <p className="mt-2 text-xs text-muted-foreground">
            Control por defecto de este producto: {TrackingMode.label(p.default_tracking_mode as never)}.
          </p>
        </TabsContent>

        <TabsContent value="ficha">
          <FichaTab product={p} />
        </TabsContent>

        <TabsContent value="imagenes">
          <ImagesTab product={p} />
        </TabsContent>

        <TabsContent value="stock">
          <Card>
            <CardHeader title="Stock por variante y sede" description="Saldo calculado del kardex. Mínimos por sede en Inventario › Stock." />
            <DataTable
              rows={p.stock}
              rowKey={(s) => `${s.variant_id}-${s.location_id}`}
              columns={[
                { key: 'sku', header: 'SKU', cell: (s) => <Mono>{p.variants.find((v) => v.id === s.variant_id)?.sku}</Mono> },
                { key: 'loc', header: 'Sede', cell: (s) => `${s.location_code} · ${s.location_name}` },
                { key: 'oh', header: 'En mano', align: 'right', cell: (s) => <span className="tabular font-medium">{qty(s.on_hand)}</span> },
                { key: 'res', header: 'Apartado', align: 'right', cell: (s) => <span className="tabular">{qty(s.reserved)}</span> },
                { key: 'tr', header: 'En tránsito', align: 'right', cell: (s) => <span className="tabular">{qty(s.in_transit)}</span> },
                { key: 'av', header: 'Disponible', align: 'right', cell: (s) => <span className="tabular">{qty(s.available)}</span> },
                { key: 'min', header: 'Mínimo', align: 'right', cell: (s) => <span className="tabular text-muted-foreground">{qty(s.min_quantity)}</span> },
              ]}
              empty={<EmptyState title="Sin stock en ninguna sede" />}
            />
          </Card>
        </TabsContent>

        <TabsContent value="historial">
          <HistoryTab productId={p.id} />
        </TabsContent>
      </Tabs>

      <VariantSheet
        open={variantId !== undefined}
        onOpenChange={(o) => !o && setVariantId(undefined)}
        productId={p.id}
        sizeScaleId={p.size_scale_id}
        defaultTracking={p.default_tracking_mode}
        variant={variant}
        stones={variant ? p.stones.filter((s) => s.variant_id === variant.id) : []}
        prices={variant ? p.prices.filter((x) => x.variant_id === variant.id) : []}
        stock={variant ? stockOf(variant.id) : []}
        cost={variant ? p.costs?.find((c) => c.variant_id === variant.id) : undefined}
        canSeeCost={p.can_see_cost}
        nominalWeight={p.nominal_weight_g}
      />
      <MovementDialog open={moving} onOpenChange={setMoving} productId={p.id} />
    </>
  );
}

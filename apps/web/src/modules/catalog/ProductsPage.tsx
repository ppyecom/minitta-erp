import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Gem, Plus } from 'lucide-react';
import { ProductKind, ProductStatus, type Page } from '@minitta/shared';
import { api, qs } from '@/lib/api';
import { categoryLabel, useLookups } from '@/lib/lookups';
import { useSave } from '@/lib/forms';
import { money, qty, relative } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Card } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/overlay';
import {
  DataTable,
  EmptyState,
  Mono,
  PageHeader,
  Pagination,
  ProductStatusBadge,
  SearchInput,
  Thumb,
} from '@/components/common';
import { ProductFormFields, categoryOptions, emptyProduct, type ProductFormValues } from './ProductForm';

interface ProductRow {
  id: number;
  code: string;
  name: string;
  kind: string;
  status: string;
  legacy_code: string | null;
  material_name: string | null;
  category_name: string | null;
  variants: number;
  on_hand: number;
  price_from: number | null;
  image_url: string | null;
  updated_at: string;
}

export function NewProductSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const nav = useNavigate();
  const [v, setV] = useState<ProductFormValues>(emptyProduct());
  useEffect(() => {
    if (open) setV(emptyProduct());
  }, [open]);
  const save = useSave((b: ProductFormValues) => api.post<{ id: number }>('/products', b), {
    success: 'Producto creado. Ahora agregue sus variantes.',
    invalidate: [['products'], ['dashboard']],
    onSuccess: (r) => {
      onOpenChange(false);
      nav(`/catalogo/productos/${r.id}?tab=variantes`);
    },
  });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Nuevo producto"
      description="El modelo. Las tallas y colores se cargan después como variantes."
      width="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="gold" loading={save.isPending} onClick={() => save.mutate(v)}>
            Crear producto
          </Button>
        </>
      }
    >
      <ProductFormFields v={v} set={(k, val) => setV((p) => ({ ...p, [k]: val }))} errors={save.fields} compact />
    </Sheet>
  );
}

export function ProductsPage() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { data: lk } = useLookups();
  const [creating, setCreating] = useState(sp.get('nuevo') === '1');
  const f = {
    q: sp.get('q') ?? '',
    status: sp.get('status') ?? '',
    kind: sp.get('kind') ?? '',
    category_id: sp.get('cat') ?? '',
    material_id: sp.get('mat') ?? '',
    page: Number(sp.get('page') ?? 1),
  };
  const setF = (patch: Record<string, string | number>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v === 1) n.delete(k);
      else n.set(k, String(v));
    }
    if (!('page' in patch)) n.delete('page');
    n.delete('nuevo');
    setSp(n, { replace: true });
  };

  const { data, isFetching } = useQuery({
    queryKey: ['products', f],
    queryFn: () =>
      api.get<Page<ProductRow>>(
        `/products${qs({ q: f.q, status: f.status, kind: f.kind, category_id: f.category_id, material_id: f.material_id, page: f.page })}`,
      ),
    placeholderData: keepPreviousData,
  });

  const filtered = f.q || f.status || f.kind || f.category_id || f.material_id;

  return (
    <>
      <PageHeader
        title="Productos"
        description="Cada producto es un modelo; sus variantes (talla, color) son lo que se vende y se cuenta."
        actions={
          <Button variant="gold" onClick={() => setCreating(true)}>
            <Plus /> Nuevo producto
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <SearchInput value={f.q} onChange={(q) => setF({ q })} placeholder="Nombre, código, SKU o código viejo" />
          <Select className="w-40" value={f.status} onChange={(e) => setF({ status: e.target.value })}>
            <option value="">Todos los estados</option>
            {ProductStatus.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select className="w-52" value={f.category_id} onChange={(e) => setF({ cat: e.target.value })}>
            <option value="">Todas las categorías</option>
            {lk &&
              categoryOptions(lk.categories).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
          </Select>
          <Select className="w-44" value={f.material_id} onChange={(e) => setF({ mat: e.target.value })}>
            <option value="">Todos los materiales</option>
            {lk?.materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Select className="w-36" value={f.kind} onChange={(e) => setF({ kind: e.target.value })}>
            <option value="">Todo tipo</option>
            {ProductKind.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {filtered && (
            <Button variant="ghost" size="sm" onClick={() => setSp(new URLSearchParams(), { replace: true })}>
              Limpiar
            </Button>
          )}
        </div>
        <DataTable
          rows={data?.items}
          loading={isFetching}
          rowKey={(r) => r.id}
          onRowClick={(r) => nav(`/catalogo/productos/${r.id}`)}
          columns={[
            {
              key: 'name',
              header: 'Producto',
              cell: (r) => (
                <div className="flex items-center gap-3">
                  <Thumb src={r.image_url} size={40} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      <Mono>{r.code}</Mono>
                      {r.legacy_code && <> · antes {r.legacy_code}</>}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              key: 'cat',
              header: 'Categoría',
              cell: (r) => <span className="text-muted-foreground">{r.category_name ?? '—'}</span>,
              className: 'hidden md:table-cell',
            },
            {
              key: 'mat',
              header: 'Material',
              cell: (r) => r.material_name ?? <span className="text-muted-foreground">{ProductKind.label(r.kind as never)}</span>,
              className: 'hidden lg:table-cell',
            },
            { key: 'var', header: 'Variantes', align: 'right', cell: (r) => <span className="tabular">{r.variants}</span> },
            { key: 'stock', header: 'Stock', align: 'right', cell: (r) => <span className="tabular">{qty(r.on_hand)}</span> },
            {
              key: 'price',
              header: 'P. público',
              align: 'right',
              cell: (r) => <span className="tabular">{r.price_from != null ? money(r.price_from) : '—'}</span>,
              className: 'hidden sm:table-cell',
            },
            { key: 'status', header: 'Estado', cell: (r) => <ProductStatusBadge status={r.status} /> },
            {
              key: 'upd',
              header: 'Modificado',
              cell: (r) => <span className="text-xs text-muted-foreground">{relative(r.updated_at)}</span>,
              className: 'hidden xl:table-cell',
            },
          ]}
          empty={
            <EmptyState
              icon={Gem}
              title={filtered ? 'Ningún producto coincide' : 'El catálogo está vacío'}
              description={
                filtered
                  ? `Pruebe con otro filtro${f.category_id && lk ? ` (categoría: ${categoryLabel(lk.categories, Number(f.category_id))})` : ''}.`
                  : 'Cree el primer producto, o corra la migración desde el sistema viejo (db/migration).'
              }
              action={
                !filtered && (
                  <Button variant="gold" onClick={() => setCreating(true)}>
                    <Plus /> Nuevo producto
                  </Button>
                )
              }
            />
          }
        />
        {data && data.total > 0 && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setF({ page })} />
        )}
      </Card>
      <NewProductSheet open={creating} onOpenChange={setCreating} />
    </>
  );
}

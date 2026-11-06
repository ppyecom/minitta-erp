import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, Loader2, Search } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { cn, qty } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './ui/overlay';
import { Mono, Thumb } from './common';
import { Badge } from './ui/misc';

export interface VariantHit {
  variant_id: number;
  sku: string;
  legacy_code: string | null;
  product_id: number;
  product_name: string;
  size_label: string | null;
  metal_color: string | null;
  tracking_mode: 'quantity' | 'serial';
  image_url: string | null;
  on_hand: number | null;
  available: number | null;
}

/** Buscador de variantes por SKU, código viejo, nombre o código de barras. */
export function VariantPicker({
  value,
  onChange,
  locationId,
  placeholder = 'Buscar por SKU, código viejo o nombre…',
  invalid,
}: {
  value: VariantHit | null;
  onChange: (v: VariantHit | null) => void;
  locationId?: number | null;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: ['variant-search', debounced, locationId],
    queryFn: () => api.get<VariantHit[]>(`/variants/search${qs({ q: debounced, location_id: locationId })}`),
    enabled: open,
  });

  const pick = (v: VariantHit) => {
    onChange(v);
    setOpen(false);
    setQ('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-invalid={invalid}
          className="flex h-auto min-h-9 w-full items-center gap-2.5 rounded-md border border-input bg-card px-2.5 py-1.5 text-left text-sm shadow-xs transition-[border,box-shadow] focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 aria-[invalid=true]:border-destructive"
        >
          {value ? (
            <>
              <Thumb src={value.image_url} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{value.product_name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  <Mono>{value.sku}</Mono>
                  {value.legacy_code && ` · ${value.legacy_code}`}
                </span>
              </span>
            </>
          ) : (
            <span className="flex-1 text-muted-foreground/80">{placeholder}</span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-80 p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (!data?.length) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, data.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pick(data[active]);
              }
            }}
            placeholder="SKU, código viejo, nombre o código de barras"
            className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          />
          {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {data?.length === 0 && <div className="px-3 py-6 text-center text-sm text-muted-foreground">Sin coincidencias</div>}
          {data?.map((v, i) => (
            <button
              key={v.variant_id}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(v)}
              className={cn('flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left', i === active && 'bg-accent')}
            >
              <Thumb src={v.image_url} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{v.product_name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  <Mono>{v.sku}</Mono>
                  {v.legacy_code && ` · ${v.legacy_code}`}
                </span>
              </span>
              {v.tracking_mode === 'serial' && <Badge tone="gold">Serial</Badge>}
              {locationId && (
                <span className="tabular w-12 text-right text-xs text-muted-foreground">{qty(v.on_hand ?? 0)}</span>
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

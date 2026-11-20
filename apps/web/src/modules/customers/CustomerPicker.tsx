import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Plus, Search, UserRound } from 'lucide-react';
import { DocumentType } from '@minitta/shared';
import { api, qs } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Badge } from '@/components/ui/misc';
import { CustomerDialog } from './CustomerDialog';
import type { CustomerRow } from './types';

/**
 * Elegir el cliente como se hace en el mostrador: se escribe parte del nombre,
 * el teléfono o el DNI. Si no está, se crea en el momento sin salir de acá —
 * si crear un cliente costara dos pantallas, nadie lo haría y volveríamos al
 * texto libre.
 */
export function CustomerPicker({
  value,
  onChange,
  error,
  autoFocus,
}: {
  value: number | null;
  onChange: (id: number | null, customer?: CustomerRow) => void;
  error?: string | string[];
  autoFocus?: boolean;
}) {
  const { can } = useSession();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [picked, setPicked] = useState<CustomerRow | null>(null);

  // el elegido, para poder mostrarlo sin volver a buscarlo
  const chosen = useQuery({
    queryKey: ['customer', value],
    queryFn: () => api.get<CustomerRow>(`/customers/${value}`),
    enabled: value !== null && (!picked || picked.customer_id !== value),
  });
  const current = picked?.customer_id === value ? picked : (chosen.data ?? null);

  const search = useQuery({
    queryKey: ['customers', 'search', term],
    queryFn: () =>
      api.get<{ items: CustomerRow[] }>(`/customers${qs({ q: term, pageSize: 8, active: 1 })}`),
    enabled: open && term.trim().length >= 2,
  });

  const results = search.data?.items ?? [];
  const msg = Array.isArray(error) ? error[0] : error;

  // al elegir se cierra la lista; al borrar la elección se vuelve a abrir
  useEffect(() => {
    if (value !== null) setOpen(false);
  }, [value]);

  const pick = (c: CustomerRow) => {
    setPicked(c);
    onChange(c.customer_id, c);
    setTerm('');
  };

  if (value !== null && current) {
    return (
      <>
        <div className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold-soft text-xs font-semibold text-gold-foreground">
            {current.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-medium">{current.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {current.code}
              {current.document_type !== 'none' &&
                ` · ${DocumentType.label(current.document_type)} ${current.document_number}`}
              {current.phone && ` · ${current.phone}`}
            </div>
          </div>
          {current.open_items > 0 && (
            <Badge tone="info">{current.open_items} abierto(s)</Badge>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setPicked(null);
              onChange(null);
              setOpen(true);
            }}
          >
            Cambiar
          </Button>
        </div>
        {msg && <p className="mt-1 text-xs text-destructive">{msg}</p>}
      </>
    );
  }

  return (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus={autoFocus}
          className={cn('pl-8', msg && 'border-destructive')}
          placeholder="Nombre, teléfono o documento…"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {msg && <p className="mt-1 text-xs text-destructive">{msg}</p>}

      {open && term.trim().length >= 2 && (
        <div className="mt-1 max-h-64 overflow-y-auto rounded-lg border bg-card shadow-sm">
          {search.isLoading ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">Buscando…</p>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-sm">
              <p className="text-muted-foreground">Ningún cliente con «{term}».</p>
              {can('customers.write') && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => setCreating(true)}
                >
                  <Plus /> Crear «{term}»
                </Button>
              )}
            </div>
          ) : (
            <>
              {results.map((c) => (
                <button
                  type="button"
                  key={c.customer_id}
                  onClick={() => pick(c)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent"
                >
                  <UserRound className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium">{c.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {c.document_type !== 'none'
                        ? `${DocumentType.label(c.document_type)} ${c.document_number}`
                        : c.code}
                      {c.phone && ` · ${c.phone}`}
                    </div>
                  </div>
                  {c.open_items > 0 && <Badge tone="info">{c.open_items}</Badge>}
                  {c.customer_id === value && <Check className="size-4 text-gold" />}
                </button>
              ))}
              {can('customers.write') && (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent"
                >
                  <Plus className="size-4" /> No es ninguno: crear «{term}»
                </button>
              )}
            </>
          )}
        </div>
      )}

      <CustomerDialog
        customer={null}
        presetName={term}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(c) => {
          setCreating(false);
          pick(c);
        }}
      />
    </>
  );
}

/** Para los formularios que sólo necesitan el id con su etiqueta. */
export function useCustomerLabel(id: number | null) {
  const q = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.get<CustomerRow>(`/customers/${id}`),
    enabled: id !== null,
  });
  return useMemo(() => q.data?.name ?? '', [q.data]);
}

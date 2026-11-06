import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight, ImageOff, Inbox, Search } from 'lucide-react';
import {
  CountStatus,
  MovementType,
  ProductStatus,
  SerialStatus,
  TransferStatus,
} from '@minitta/shared';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/form';
import { Badge } from './ui/misc';
import { Dialog } from './ui/overlay';

// ---- encabezado de página ------------------------------------------------------
export function PageHeader({
  title,
  description,
  actions,
  back,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
  meta?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link
          to={back.to}
          className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-[13.5px] text-muted-foreground">{description}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

// ---- búsqueda con debounce ------------------------------------------------------
export function SearchInput({
  value,
  onChange,
  placeholder = 'Buscar…',
  className,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => v !== value && onChange(v), 250);
    return () => clearTimeout(t);
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={cn('relative w-full sm:w-72', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="pl-8" autoFocus={autoFocus} />
    </div>
  );
}

// ---- tabla ------------------------------------------------------------------------
export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  onRowClick,
  empty,
  rowKey,
  dense,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  rowKey: (row: T) => string | number;
  dense?: boolean;
}) {
  const al = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b bg-muted/40">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  'h-9 whitespace-nowrap px-3 text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground first:pl-5 last:pr-5',
                  al(c.align),
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && !rows?.length
            ? Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b last:border-0">
                  {columns.map((c) => (
                    <td key={c.key} className="px-3 py-3 first:pl-5 last:pr-5">
                      <div className="h-4 animate-pulse rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))
            : rows?.map((r) => (
                <tr
                  key={rowKey(r)}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={cn(
                    'border-b transition-colors last:border-0',
                    onRowClick && 'cursor-pointer hover:bg-accent/60',
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(dense ? 'py-1.5' : 'py-2.5', 'px-3 align-middle first:pl-5 last:pr-5', al(c.align), c.className)}
                    >
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {!loading && rows && rows.length === 0 && (empty ?? <EmptyState title="Sin resultados" />)}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-4 border-t px-5 py-2.5 text-[13px] text-muted-foreground">
      <span className="tabular">
        {from}–{to} de {total.toLocaleString('es-PE')}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-xs" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft />
        </Button>
        <span className="tabular px-2">
          {page} / {pages}
        </span>
        <Button variant="outline" size="icon-xs" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-xl border bg-muted/50">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium">{title}</div>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---- miniatura de imagen ------------------------------------------------------------
export function Thumb({ src, size = 36, className }: { src?: string | null; size?: number; className?: string }) {
  const [err, setErr] = useState(false);
  return (
    <div
      className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/60', className)}
      style={{ width: size, height: size }}
    >
      {src && !err ? (
        <img src={src} alt="" loading="lazy" className="size-full object-cover" onError={() => setErr(true)} />
      ) : (
        <ImageOff className="size-3.5 text-muted-foreground/50" />
      )}
    </div>
  );
}

// ---- insignias de estado ---------------------------------------------------------------
type Tone = 'neutral' | 'gold' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

export function ProductStatusBadge({ status }: { status: string }) {
  const tone: Record<string, Tone> = { active: 'success', draft: 'warning', discontinued: 'neutral', archived: 'outline' };
  return (
    <Badge tone={tone[status] ?? 'neutral'} dot>
      {ProductStatus.label(status as never)}
    </Badge>
  );
}

export function SerialStatusBadge({ status }: { status: string }) {
  const tone: Record<string, Tone> = {
    in_stock: 'success',
    reserved: 'gold',
    in_transit: 'info',
    in_workshop: 'warning',
    on_loan: 'info',
    consigned: 'info',
    sold: 'neutral',
    returned: 'neutral',
    lost: 'danger',
    scrapped: 'danger',
  };
  return (
    <Badge tone={tone[status] ?? 'neutral'} dot>
      {SerialStatus.label(status as never)}
    </Badge>
  );
}

export function TransferStatusBadge({ status }: { status: string }) {
  const tone: Record<string, Tone> = {
    draft: 'neutral',
    sent: 'info',
    partially_received: 'warning',
    received: 'success',
    cancelled: 'outline',
  };
  return (
    <Badge tone={tone[status] ?? 'neutral'} dot>
      {TransferStatus.label(status as never)}
    </Badge>
  );
}

export function CountStatusBadge({ status }: { status: string }) {
  const tone: Record<string, Tone> = { open: 'info', counting: 'gold', closed: 'neutral', applied: 'success', cancelled: 'outline' };
  return (
    <Badge tone={tone[status] ?? 'neutral'} dot>
      {CountStatus.label(status as never)}
    </Badge>
  );
}

export function MovementTypeBadge({ type, quantity }: { type: string; quantity?: number }) {
  const positive = quantity === undefined ? undefined : quantity > 0;
  return (
    <Badge tone={positive === undefined ? 'neutral' : positive ? 'success' : 'danger'}>
      {MovementType.label(type as never)}
    </Badge>
  );
}

// ---- confirmación --------------------------------------------------------------------
export function Confirm({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirmar',
  destructive,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted-foreground">{description}</div>
    </Dialog>
  );
}

// ---- dato etiquetado (fichas de detalle) -------------------------------------------------
export function Stat({ label, value, mono }: { label: ReactNode; value: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 truncate text-[13.5px] font-medium', mono && 'font-mono text-[12.5px]')}>{value ?? '—'}</dd>
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('whitespace-nowrap font-mono text-[12px] tracking-tight', className)}>{children}</span>;
}

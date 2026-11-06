import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Plus } from 'lucide-react';
import { LocationKind } from '@minitta/shared';
import { api } from '@/lib/api';
import { useLookups } from '@/lib/lookups';
import { useSave } from '@/lib/forms';
import { date, qty } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Badge, Card, Segmented, Separator } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/overlay';
import { DataTable, EmptyState, Mono, PageHeader } from '@/components/common';

interface LocationRow {
  id: number;
  code: string;
  name: string;
  kind: string;
  sells: boolean;
  holds_stock: boolean;
  is_third_party: boolean;
  allows_negative_stock: boolean;
  manager_user_id: number | null;
  manager_name: string | null;
  address_line: string | null;
  district: string | null;
  city: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  is_active: boolean;
  opened_at: string | null;
  closed_at: string | null;
  legacy_num: number | null;
  skus: number;
  units: number;
}

const blank = {
  code: '', name: '', kind: 'store', sells: true, holds_stock: true, is_third_party: false, allows_negative_stock: false,
  manager_user_id: '', address_line: '', district: '', city: 'Lima', phone: '', mobile: '', email: '', is_active: true,
  opened_at: '', closed_at: '',
};

function LocationSheet({ loc, open, onOpenChange }: { loc: LocationRow | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: lk } = useLookups();
  const [v, setV] = useState(blank);
  useEffect(() => {
    if (!open) return;
    if (!loc) setV(blank);
    else setV(Object.fromEntries(Object.keys(blank).map((k) => [k, (loc as unknown as Record<string, unknown>)[k] ?? (typeof (blank as Record<string, unknown>)[k] === 'boolean' ? false : '')])) as typeof blank);
  }, [open, loc]);
  const save = useSave(() => (loc ? api.put(`/locations/${loc.id}`, v) : api.post('/locations', v)), {
    success: loc ? 'Sede actualizada' : 'Sede creada',
    invalidate: [['locations'], ['lookups']],
    onSuccess: () => onOpenChange(false),
  });
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((p) => ({ ...p, [k]: e.target.value }));
  const err = save.fields;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={loc ? `${loc.code} · ${loc.name}` : 'Nueva sede'}
      description="Tienda, almacén, taller u oficina: sus capacidades son explícitas, no un código de una letra."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-6">
        <Field label="Código" required error={err.code} className="sm:col-span-2">
          <Input value={v.code} onChange={set('code')} className="font-mono uppercase" placeholder="T-8" />
        </Field>
        <Field label="Nombre" required error={err.name} className="sm:col-span-4">
          <Input value={v.name} onChange={set('name')} />
        </Field>
        <Field label="Tipo" className="sm:col-span-3">
          <Select value={v.kind} onChange={set('kind')}>
            {LocationKind.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Responsable" className="sm:col-span-3">
          <Select value={String(v.manager_user_id ?? '')} onChange={set('manager_user_id')}>
            <option value="">—</option>
            {lk?.users
              .filter((u) => !u.is_system)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
          </Select>
        </Field>
        <div className="space-y-2.5 rounded-lg border p-3 sm:col-span-6">
          <Checkbox checked={v.sells} onCheckedChange={(x) => setV({ ...v, sells: x })} label="Vende al público" description="Puede emitir comprobantes" />
          <Checkbox checked={v.holds_stock} onCheckedChange={(x) => setV({ ...v, holds_stock: x })} label="Maneja stock" description="Una oficina no: la base rechaza cargarle mercadería" />
          <Checkbox checked={v.is_third_party} onCheckedChange={(x) => setV({ ...v, is_third_party: x })} label="Es de un tercero (consignación)" />
          <Checkbox checked={v.allows_negative_stock} onCheckedChange={(x) => setV({ ...v, allows_negative_stock: x })} label="Permite saldo negativo" description="No recomendado" />
        </div>
        <Separator className="sm:col-span-6" />
        <Field label="Dirección" className="sm:col-span-6">
          <Input value={v.address_line ?? ''} onChange={set('address_line')} />
        </Field>
        <Field label="Distrito" className="sm:col-span-3">
          <Input value={v.district ?? ''} onChange={set('district')} />
        </Field>
        <Field label="Ciudad" className="sm:col-span-3">
          <Input value={v.city ?? ''} onChange={set('city')} />
        </Field>
        <Field label="Teléfono" className="sm:col-span-2">
          <Input value={v.phone ?? ''} onChange={set('phone')} />
        </Field>
        <Field label="Celular" className="sm:col-span-2">
          <Input value={v.mobile ?? ''} onChange={set('mobile')} />
        </Field>
        <Field label="Correo" className="sm:col-span-2">
          <Input value={v.email ?? ''} onChange={set('email')} />
        </Field>
        <Field label="Abrió" className="sm:col-span-3">
          <Input type="date" value={v.opened_at ?? ''} onChange={set('opened_at')} />
        </Field>
        <Field label="Cerró" hint="Una sede cerrada no se borra: queda inactiva" error={err.closed_at} className="sm:col-span-3">
          <Input type="date" value={v.closed_at ?? ''} onChange={(e) => setV({ ...v, closed_at: e.target.value, is_active: e.target.value ? false : v.is_active })} />
        </Field>
        <div className="sm:col-span-6">
          <Checkbox checked={v.is_active} onCheckedChange={(x) => setV({ ...v, is_active: x })} label="Sede activa" description="Inactiva = no aparece en los combos ni recibe stock nuevo, pero su historia se conserva" />
        </div>
      </div>
    </Sheet>
  );
}

export function LocationsPage() {
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [editing, setEditing] = useState<LocationRow | null | undefined>(undefined);
  const { data, isLoading } = useQuery({ queryKey: ['locations'], queryFn: () => api.get<LocationRow[]>('/locations') });
  const rows = data?.filter((l) => filter === 'all' || l.is_active);
  return (
    <>
      <PageHeader
        title="Sedes"
        description="Tiendas, almacenes, taller y oficinas. Las cerradas se conservan inactivas para no romper el histórico."
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus /> Nueva sede
          </Button>
        }
      />
      <Card>
        <div className="border-b px-4 py-3">
          <Segmented value={filter} onChange={setFilter} options={[{ value: 'active', label: 'Activas' }, { value: 'all', label: 'Todas' }]} />
        </div>
        <DataTable
          rows={rows}
          loading={isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => setEditing(r)}
          columns={[
            { key: 'c', header: 'Código', cell: (r) => <Mono className="font-medium">{r.code}</Mono> },
            {
              key: 'n',
              header: 'Sede',
              cell: (r) => (
                <div>
                  <div className="font-medium">{r.name}</div>
                  {r.address_line && <div className="text-xs text-muted-foreground">{r.address_line}</div>}
                </div>
              ),
            },
            { key: 'k', header: 'Tipo', cell: (r) => LocationKind.label(r.kind as never) },
            {
              key: 'cap',
              header: 'Capacidades',
              cell: (r) => (
                <div className="flex flex-wrap gap-1">
                  {r.sells && <Badge tone="success">Vende</Badge>}
                  {r.holds_stock ? <Badge tone="info">Stock</Badge> : <Badge>Sin stock</Badge>}
                  {r.is_third_party && <Badge tone="warning">Tercero</Badge>}
                </div>
              ),
              className: 'hidden md:table-cell',
            },
            { key: 'u', header: 'Unidades', align: 'right', cell: (r) => <span className="tabular">{qty(r.units)}</span> },
            { key: 'm', header: 'Responsable', cell: (r) => <span className="text-muted-foreground">{r.manager_name ?? '—'}</span>, className: 'hidden lg:table-cell' },
            {
              key: 's',
              header: 'Estado',
              cell: (r) => (r.is_active ? <Badge tone="success" dot>Activa</Badge> : <Badge dot>Cerrada {r.closed_at ? date(r.closed_at) : ''}</Badge>),
            },
          ]}
          empty={<EmptyState icon={MapPin} title="Sin sedes" />}
        />
      </Card>
      <LocationSheet loc={editing ?? null} open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} />
    </>
  );
}

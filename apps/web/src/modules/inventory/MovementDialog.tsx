import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Info } from 'lucide-react';
import { MANUAL_MOVEMENT_TYPES, MOVEMENT_SIGN, MovementType, type Page } from '@minitta/shared';
import { api, qs } from '@/lib/api';
import { useLookups } from '@/lib/lookups';
import { useSave } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { cn, qty } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { VariantPicker, type VariantHit } from '@/components/variant-picker';

/**
 * Registrar un movimiento con inventory.post_movement(). Las transferencias y los
 * conteos tienen su propia pantalla: generan sus movimientos solos.
 */
export function MovementDialog({
  open,
  onOpenChange,
  productId,
  initialVariant,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productId?: number;
  initialVariant?: VariantHit | null;
}) {
  const { data: lk } = useLookups();
  const { locationId } = useSession();
  const [variant, setVariant] = useState<VariantHit | null>(initialVariant ?? null);
  const [f, setF] = useState({
    location_id: '',
    type: 'purchase',
    quantity: '',
    direction: '1',
    serial_id: '',
    reason_code: '',
    unit_cost: '',
    notes: '',
  });
  useEffect(() => {
    if (open) {
      setVariant(initialVariant ?? null);
      setF({ location_id: locationId ? String(locationId) : '', type: 'purchase', quantity: '', direction: '1', serial_id: '', reason_code: '', unit_cost: '', notes: '' });
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const sign = MOVEMENT_SIGN[f.type as keyof typeof MOVEMENT_SIGN];
  const isSerial = variant?.tracking_mode === 'serial';
  const effSign = sign === 0 ? Number(f.direction) : sign;

  // piezas candidatas: para salidas, las que están en la sede; para entradas, las que no están en stock
  const serials = useQuery({
    queryKey: ['serials-for-move', variant?.variant_id, f.location_id, effSign],
    queryFn: () =>
      api.get<Page<{ serial_id: number; serial_code: string; status: string; location_code: string | null; actual_weight_g: number | null }>>(
        `/serials${qs({ variant_id: variant!.variant_id, location_id: effSign < 0 ? f.location_id : '', pageSize: 200 })}`,
      ),
    enabled: open && isSerial && !!f.location_id,
  });

  const save = useSave(
    () =>
      api.post('/movements', {
        variant_id: variant?.variant_id,
        location_id: f.location_id,
        type: f.type,
        quantity: isSerial ? effSign : Number(f.quantity) * (sign === 0 ? Number(f.direction) : 1),
        serial_id: isSerial ? f.serial_id : '',
        reason_code: f.reason_code,
        unit_cost: f.unit_cost,
        notes: f.notes,
      }),
    {
      success: 'Movimiento registrado en el kardex',
      invalidate: [['product'], ['stock'], ['kardex'], ['dashboard'], ['serials'], ['products']],
      onSuccess: () => onOpenChange(false),
    },
  );

  if (!lk) return null;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const reasons = lk.reasons.filter((r) => r.type === f.type);
  const reason = reasons.find((r) => r.code === f.reason_code);
  const err = save.fields;
  const candidates = serials.data?.items.filter((s) => (effSign < 0 ? s.status === 'in_stock' : s.status !== 'in_stock' && s.status !== 'sold')) ?? [];
  const after = variant?.on_hand != null && f.quantity ? Number(variant.on_hand) + effSign * Number(f.quantity) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Registrar movimiento"
      description="Queda en el kardex con su autor. No se edita: un error se corrige con otro movimiento."
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)} disabled={!variant}>
            Registrar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-6">
        <Field label="Variante" required error={err.variant_id} className="sm:col-span-6">
          <VariantPicker value={variant} onChange={setVariant} locationId={Number(f.location_id) || null} invalid={!!err.variant_id} />
          {productId && !variant && <p className="text-xs text-muted-foreground">Busque por el SKU o el nombre del producto.</p>}
        </Field>
        <Field label="Sede" required error={err.location_id} className="sm:col-span-3">
          <Select value={f.location_id} onChange={set('location_id')} aria-invalid={!!err.location_id}>
            <option value="">Elegir…</option>
            {lk.locations
              .filter((l) => l.is_active && l.holds_stock)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Tipo" required className="sm:col-span-3">
          <Select value={f.type} onChange={(e) => setF((p) => ({ ...p, type: e.target.value, reason_code: '' }))}>
            {MANUAL_MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {MovementType.label(t)} {MOVEMENT_SIGN[t] > 0 ? '(+)' : MOVEMENT_SIGN[t] < 0 ? '(−)' : '(±)'}
              </option>
            ))}
          </Select>
        </Field>

        {sign === 0 && (
          <Field label="Sentido" className="sm:col-span-6">
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: '1', label: 'Entra (suma)', icon: ArrowUp, cls: 'text-success' },
                { v: '-1', label: 'Sale (resta)', icon: ArrowDown, cls: 'text-destructive' },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setF((p) => ({ ...p, direction: o.v }))}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-[13px] font-medium transition-colors',
                    f.direction === o.v ? 'border-primary bg-accent' : 'text-muted-foreground hover:bg-accent/60',
                  )}
                >
                  <o.icon className={cn('size-4', o.cls)} /> {o.label}
                </button>
              ))}
            </div>
          </Field>
        )}

        {isSerial ? (
          <Field label="Pieza" required error={err.serial_id} hint="Las variantes serializadas se mueven pieza por pieza" className="sm:col-span-6">
            <Select value={f.serial_id} onChange={set('serial_id')} disabled={!f.location_id}>
              <option value="">{f.location_id ? (candidates.length ? 'Elegir pieza…' : 'No hay piezas disponibles') : 'Elija primero la sede'}</option>
              {candidates.map((s) => (
                <option key={s.serial_id} value={s.serial_id}>
                  {s.serial_code} · {s.actual_weight_g ? `${s.actual_weight_g} g` : 'sin peso'} · {s.location_code ?? '—'}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field
            label="Cantidad"
            required
            error={err.quantity}
            hint={variant?.on_hand != null && f.location_id ? `En sede: ${qty(variant.on_hand)}${after !== null ? ` → quedará ${qty(after)}` : ''}` : undefined}
            className="sm:col-span-3"
          >
            <Input value={f.quantity} onChange={set('quantity')} inputMode="decimal" />
          </Field>
        )}

        {!isSerial && (
          <Field label="Costo unitario" hint="Opcional, en compras" className="sm:col-span-3">
            <Input value={f.unit_cost} onChange={set('unit_cost')} inputMode="decimal" suffix="S/" />
          </Field>
        )}

        <Field label="Motivo" className="sm:col-span-6">
          <Select value={f.reason_code} onChange={set('reason_code')}>
            <option value="">{reasons.length ? 'Sin motivo' : 'No hay motivos para este tipo'}</option>
            {reasons.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nota" required={reason?.requires_note} className="sm:col-span-6">
          <Textarea value={f.notes} onChange={set('notes')} rows={2} placeholder={reason?.requires_note ? 'Este motivo pide una explicación' : ''} />
        </Field>
        {after !== null && after < 0 && (
          <div className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px] sm:col-span-6">
            <Info className="mt-0.5 size-4 shrink-0 text-warning" />
            El saldo quedaría negativo: la base lo va a rechazar salvo que la sede lo permita.
          </div>
        )}
      </div>
    </Dialog>
  );
}

import { useEffect, useState } from 'react';
import { CustomerKind, DocumentType } from '@minitta/shared';
import { api } from '@/lib/api';
import { useSave } from '@/lib/forms';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { blankCustomer, type CustomerForm, type CustomerRow } from './types';

/**
 * Alta y edición del cliente. El formato del documento lo valida el esquema
 * compartido antes de mandar, y la base igual lo vuelve a validar: acá no se
 * reimplementa, sólo se muestran los errores que vuelven por campo.
 */
export function CustomerDialog({
  customer,
  presetName,
  open,
  onOpenChange,
  onCreated,
}: {
  customer: (CustomerRow & { phone_alt?: string | null; address_line?: string | null; notes?: string | null }) | null;
  presetName?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (c: CustomerRow) => void;
}) {
  const [v, setV] = useState<CustomerForm>({ ...blankCustomer });

  useEffect(() => {
    if (!open) return;
    setV(
      customer
        ? {
            kind: customer.kind,
            document_type: customer.document_type,
            document_number: customer.document_number ?? '',
            name: customer.name,
            trade_name: customer.trade_name ?? '',
            phone: customer.phone ?? '',
            phone_alt: customer.phone_alt ?? '',
            email: customer.email ?? '',
            address_line: customer.address_line ?? '',
            city: customer.city ?? '',
            birth_date: customer.birth_date ?? '',
            notes: customer.notes ?? '',
            is_active: customer.is_active,
          }
        : { ...blankCustomer, name: presetName?.trim() ?? '' },
    );
  }, [open, customer, presetName]);

  // la API devuelve la fila de core.customer (con `id`), no la de la vista 360
  type Saved = CustomerForm & { id: number; code: string };
  const save = useSave<void, Saved>(
    () =>
      customer
        ? api.put<Saved>(`/customers/${customer.customer_id}`, v)
        : api.post<Saved>('/customers', v),
    {
      success: customer ? 'Cliente actualizado' : 'Cliente creado',
      invalidate: [['customers'], ['customer']],
      onSuccess: (r) => {
        onOpenChange(false);
        // recién creado: todavía no tiene nada abierto, así que el picker puede
        // mostrarlo sin volver a pedirlo a la API
        if (!customer) {
          onCreated?.({
            customer_id: r.id,
            code: r.code,
            name: r.name,
            trade_name: r.trade_name || null,
            kind: r.kind,
            document_type: r.document_type,
            document_number: r.document_number || null,
            phone: r.phone || null,
            email: r.email || null,
            city: r.city || null,
            birth_date: r.birth_date || null,
            is_active: r.is_active,
            custody_total: 0, custody_open: 0,
            layaway_total: 0, layaway_active: 0, layaway_paid: 0,
            open_items: 0, last_activity: null,
          });
        }
      },
    },
  );

  const isCompany = v.kind === 'company';

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={customer ? customer.name : 'Nuevo cliente'}
      description={
        customer
          ? `${customer.code} · corregir el dato acá lo corrige en toda la historia`
          : 'Con documento, el cliente no se va a duplicar nunca. Sin documento también se puede guardar.'
      }
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="gold" loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo" error={save.fields.kind}>
          <Select
            value={v.kind}
            onChange={(e) => {
              const kind = e.target.value as 'person' | 'company';
              // una empresa no tiene cumpleaños, y un RUC no es de una persona
              setV({
                ...v,
                kind,
                birth_date: kind === 'company' ? '' : v.birth_date,
                document_type: kind === 'person' && v.document_type === 'ruc' ? 'none' : v.document_type,
                document_number:
                  kind === 'person' && v.document_type === 'ruc' ? '' : v.document_number,
              });
            }}
          >
            {CustomerKind.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={isCompany ? 'Razón social' : 'Nombre completo'} required error={save.fields.name}>
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus />
        </Field>

        <Field label="Documento" error={save.fields.document_type}>
          <Select
            value={v.document_type}
            onChange={(e) =>
              setV({ ...v, document_type: e.target.value as typeof v.document_type })
            }
          >
            {DocumentType.options
              // el RUC es de empresas; a una persona no se le ofrece
              .filter((o) => isCompany || o.value !== 'ruc')
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </Select>
        </Field>
        <Field
          label="Número"
          required={v.document_type !== 'none'}
          error={save.fields.document_number}
          hint={
            v.document_type === 'dni'
              ? '8 dígitos'
              : v.document_type === 'ruc'
                ? '11 dígitos'
                : undefined
          }
        >
          <Input
            className="font-mono"
            disabled={v.document_type === 'none'}
            value={v.document_number}
            onChange={(e) => setV({ ...v, document_number: e.target.value.trim() })}
          />
        </Field>

        {isCompany && (
          <Field label="Nombre comercial" className="sm:col-span-2">
            <Input value={v.trade_name} onChange={(e) => setV({ ...v, trade_name: e.target.value })} />
          </Field>
        )}

        <Field label="Teléfono" error={save.fields.phone}>
          <Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </Field>
        <Field label="Otro teléfono">
          <Input value={v.phone_alt} onChange={(e) => setV({ ...v, phone_alt: e.target.value })} />
        </Field>
        <Field label="Correo" error={save.fields.email}>
          <Input value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </Field>
        {!isCompany && (
          <Field label="Cumpleaños" hint="Para avisarle antes de su fecha" error={save.fields.birth_date}>
            <Input
              type="date"
              value={v.birth_date}
              onChange={(e) => setV({ ...v, birth_date: e.target.value })}
            />
          </Field>
        )}
        <Field label="Dirección" className="sm:col-span-2">
          <Input value={v.address_line} onChange={(e) => setV({ ...v, address_line: e.target.value })} />
        </Field>
        <Field label="Ciudad">
          <Input value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} />
        </Field>
        <Field label="Notas" className="sm:col-span-2">
          <Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
        {customer && (
          <div className="sm:col-span-2">
            <Checkbox
              checked={v.is_active}
              onCheckedChange={(x) => setV({ ...v, is_active: x })}
              label="Activo"
              description="Un cliente con piezas en custodia o apartados activos no se puede desactivar"
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}

// core.v_customer_360: el cliente con todo lo que tiene con nosotros.
export interface CustomerRow {
  customer_id: number;
  code: string;
  name: string;
  trade_name: string | null;
  kind: 'person' | 'company';
  document_type: 'dni' | 'ruc' | 'ce' | 'passport' | 'none';
  document_number: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  birth_date: string | null;
  is_active: boolean;
  custody_total: number;
  custody_open: number;
  layaway_total: number;
  layaway_active: number;
  layaway_paid: number;
  /** custodias abiertas + apartados activos. > 0 = no se puede desactivar. */
  open_items: number;
  last_activity: string | null;
}

/** GET /customers/:id trae además la historia. */
export interface CustomerDetail extends CustomerRow {
  id: number;
  phone_alt: string | null;
  address_line: string | null;
  notes: string | null;
  created_at: string;
  custody: {
    id: number;
    code: string;
    status: string;
    description: string;
    received_at: string;
    promised_on: string | null;
    received_weight_g: number;
    location_name: string;
    is_overdue: boolean;
  }[];
  layaways: {
    id: number;
    status: string;
    quantity: number;
    reserved_at: string;
    expires_at: string | null;
    sku: string;
    product_name: string;
    location_name: string;
    deposit: number;
    paid: number;
  }[];
}

export type CustomerKindValue = CustomerRow['kind'];
export type DocumentTypeValue = CustomerRow['document_type'];

/** Lo que maneja el formulario: todo string, como lo devuelven los inputs. */
export interface CustomerForm {
  kind: CustomerKindValue;
  document_type: DocumentTypeValue;
  document_number: string;
  name: string;
  trade_name: string;
  phone: string;
  phone_alt: string;
  email: string;
  address_line: string;
  city: string;
  birth_date: string;
  notes: string;
  is_active: boolean;
}

export const blankCustomer: CustomerForm = {
  kind: 'person',
  document_type: 'none',
  document_number: '',
  name: '',
  trade_name: '',
  phone: '',
  phone_alt: '',
  email: '',
  address_line: '',
  city: '',
  birth_date: '',
  notes: '',
  is_active: true,
};

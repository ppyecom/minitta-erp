// Validaciones de entrada: las usa la API (fuente de verdad) y los formularios de la web.
import { z } from 'zod';
import {
  Gender,
  LocationKind,
  MaterialFamily,
  MovementType,
  PriceMode,
  ProductKind,
  ProductStatus,
  StoneOrigin,
  TrackingMode,
  TransferPurpose,
} from './enums';

// ---- helpers: los formularios mandan '' para "vacío" ------------------------
const emptyToNull = (v: unknown) => (v === '' || v === undefined ? null : v);

export const optText = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() || null : emptyToNull(v)),
  z.string().nullable(),
);
export const reqText = z.string().trim().min(1, 'Requerido');
export const optNum = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
  z.number({ invalid_type_error: 'Debe ser un número' }).finite().nullable(),
);
export const optPositive = optNum.refine((v) => v === null || v > 0, 'Debe ser mayor a 0');
export const optNonNeg = optNum.refine((v) => v === null || v >= 0, 'No puede ser negativo');
export const optId = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
  z.number().int().positive().nullable(),
);
export const reqId = z.coerce.number().int().positive('Requerido');
export const optDate = z.preprocess(emptyToNull, z.string().date('Fecha inválida').nullable());

// ---- catálogo ---------------------------------------------------------------
export const productInput = z.object({
  code: reqText.max(40),
  name: reqText.max(200),
  kind: z.enum(ProductKind.values).default('jewelry'),
  status: z.enum(ProductStatus.values).default('draft'),
  short_desc: optText,
  long_desc: optText,
  care_notes: optText,
  internal_notes: optText,
  material_id: optId,
  finish_code: optText,
  collection_id: optId,
  supplier_id: optId,
  gender: z.preprocess(emptyToNull, z.enum(Gender.values).nullable()),
  category_id: optId, // categoría primaria
  nominal_weight_g: optNonNeg,
  width_mm: optPositive,
  height_mm: optPositive,
  depth_mm: optPositive,
  diameter_mm: optPositive,
  thickness_mm: optPositive,
  size_scale_id: optId,
  is_made_to_order: z.boolean().default(false),
  is_engravable: z.boolean().default(false),
  is_repairable: z.boolean().default(true),
  default_tracking_mode: z.enum(TrackingMode.values).default('quantity'),
  tax_category_code: z.string().default('igv_18'),
  sale_unit_code: z.string().default('und'),
  warranty_months: optNonNeg,
  launched_on: optDate,
  tag_ids: z.array(z.number().int().positive()).default([]),
});
export type ProductInput = z.infer<typeof productInput>;

export const variantInput = z.object({
  sku: optText, // vacío = se genera con catalog.build_sku()
  barcode: optText,
  label_code: optText,
  size_value_id: optId,
  size_label: optText,
  metal_color: optText,
  secondary_metal_color: optText,
  stone_color: optText,
  finish_code: optText,
  weight_g: optPositive,
  length_cm: optPositive,
  tracking_mode: z.enum(TrackingMode.values).default('quantity'),
  status: z.enum(ProductStatus.values).default('active'),
  is_default: z.boolean().default(false),
});
export type VariantInput = z.infer<typeof variantInput>;

export const variantStoneInput = z.object({
  stone_id: reqId,
  color_code: optText,
  cut_code: optText,
  setting_code: optText,
  quantity: z.coerce.number().int().positive('Mínimo 1').default(1),
  size_mm: optPositive,
  width_mm: optPositive,
  carat_each: optPositive,
  clarity: optText,
  quality_grade: optText,
  is_center: z.boolean().default(false),
  unit_cost: optNonNeg,
  cost_currency: optText,
  notes: optText,
});
export type VariantStoneInput = z.infer<typeof variantStoneInput>;

export const priceInput = z.object({
  price_list_id: reqId,
  mode: z.enum(PriceMode.values).default('manual'),
  amount: z.coerce.number().nonnegative('No puede ser negativo'),
  margin_pct: optNonNeg,
  price_per_gram: optPositive,
  min_quantity: z.coerce.number().positive().default(1),
  notes: optText,
});
export type PriceInput = z.infer<typeof priceInput>;

export const stoneInput = z.object({
  code: reqText.max(40),
  name: reqText,
  origin: z.enum(StoneOrigin.values),
  is_gem: z.boolean().default(false),
  mohs_min: optNum,
  mohs_max: optNum,
  default_unit: optText,
});

export const materialInput = z.object({
  code: reqText.max(40),
  name: reqText,
  family: z.enum(MaterialFamily.values),
  purity_millis: optNum,
  karat: optNum,
  is_precious: z.boolean().default(false),
  is_priced_by_weight: z.boolean().default(false),
  hallmark: optText,
});

export const categoryInput = z.object({
  parent_id: optId,
  name: reqText,
  slug: optText,
  description: optText,
  sort_order: z.coerce.number().int().default(0),
});

export const simpleCodeInput = z.object({
  code: reqText.max(40),
  name: reqText,
  hex: optText,
});

// ---- inventario -------------------------------------------------------------
export const movementInput = z.object({
  variant_id: reqId,
  location_id: reqId,
  type: z.enum(MovementType.values),
  quantity: z.coerce.number().refine((v) => v !== 0, 'La cantidad no puede ser 0'),
  serial_id: optId,
  unit_cost: optNonNeg,
  currency_code: optText,
  reason_code: optText,
  notes: optText,
});
export type MovementInput = z.infer<typeof movementInput>;

export const serialItemInput = z.object({
  variant_id: reqId,
  serial_code: optText, // vacío = se genera
  actual_weight_g: optPositive,
  actual_size_label: optText,
  supplier_id: optId,
  acquisition_cost: optNonNeg,
  acquisition_currency: optText,
  acquired_on: optDate,
  engraving_text: optText,
  notes: optText,
  // ingreso a stock en el mismo paso (movimiento de compra o apertura)
  location_id: optId,
  entry_type: z.enum(['purchase', 'opening']).nullable().default(null),
});
export type SerialItemInput = z.infer<typeof serialItemInput>;

export const certificationInput = z.object({
  authority: reqText,
  certificate_no: reqText,
  issued_on: optDate,
});

export const transferInput = z.object({
  from_location_id: reqId,
  to_location_id: reqId,
  purpose: z.enum(TransferPurpose.values).default('restock'),
  carrier: optText,
  notes: optText,
  lines: z
    .array(
      z.object({
        variant_id: reqId,
        serial_id: optId,
        quantity_sent: z.coerce.number().positive('Mayor a 0'),
      }),
    )
    .min(1, 'Agregue al menos una línea'),
});
export type TransferInput = z.infer<typeof transferInput>;

export const receiveInput = z.object({
  lines: z.array(z.object({ id: reqId, quantity_received: z.coerce.number().nonnegative() })),
});

export const countOpenInput = z.object({
  location_id: reqId,
  is_opening: z.boolean().default(false),
  category_id: optId,
});

export const countLineInput = z.object({
  counted_qty: optNonNeg,
  reason_code: optText,
  notes: optText,
});

export const stockLimitsInput = z.object({
  min_quantity: z.coerce.number().nonnegative(),
  max_quantity: optNonNeg,
});

// ---- precios ----------------------------------------------------------------
export const metalRateInput = z.object({
  material_id: reqId,
  price_per_gram: z.coerce.number().positive('Mayor a 0'),
  currency_code: z.string().length(3).default('PEN'),
  valid_from: z.string().date('Fecha inválida'),
  source: optText,
});

export const exchangeRateInput = z.object({
  currency_code: z.string().length(3),
  rate_date: z.string().date('Fecha inválida'),
  buy: z.coerce.number().positive(),
  sell: z.coerce.number().positive(),
  source: optText,
});

export const priceListInput = z.object({
  name: reqText,
  default_margin_pct: optNonNeg,
  rounding_step: z.coerce.number().positive().default(0.01),
  is_active: z.boolean().default(true),
  location_ids: z.array(z.number().int().positive()).default([]),
});

// ---- core -------------------------------------------------------------------
export const locationInput = z.object({
  code: reqText.max(30),
  name: reqText,
  kind: z.enum(LocationKind.values),
  sells: z.boolean().default(false),
  holds_stock: z.boolean().default(true),
  is_third_party: z.boolean().default(false),
  allows_negative_stock: z.boolean().default(false),
  manager_user_id: optId,
  address_line: optText,
  district: optText,
  city: optText,
  phone: optText,
  mobile: optText,
  email: optText,
  is_active: z.boolean().default(true),
  opened_at: optDate,
  closed_at: optDate,
});
export type LocationInput = z.infer<typeof locationInput>;

export const userInput = z.object({
  username: reqText.max(40),
  full_name: reqText,
  email: optText,
  document_id: optText,
  can_see_cost: z.boolean().default(false),
  is_active: z.boolean().default(true),
});
export type UserInput = z.infer<typeof userInput>;

import { useQuery } from '@tanstack/react-query';
import { api } from './api';

// Tipos de las tablas de referencia que devuelve GET /api/lookups

export interface Location {
  id: number;
  code: string;
  name: string;
  kind: string;
  sells: boolean;
  holds_stock: boolean;
  is_active: boolean;
  is_third_party: boolean;
  allows_negative_stock: boolean;
}
export interface User {
  id: number;
  username: string;
  full_name: string;
  can_see_cost: boolean;
  is_active: boolean;
  is_system: boolean;
}
export interface Category {
  id: number;
  parent_id: number | null;
  slug: string;
  name: string;
  level: number;
  path: string;
  is_active: boolean;
}
export interface CodeName {
  code: string;
  name: string;
  hex?: string | null;
}
export interface Material {
  id: number;
  code: string;
  name: string;
  family: string;
  karat: number | null;
  purity_millis: number | null;
  is_precious: boolean;
  is_priced_by_weight: boolean;
}
export interface Stone {
  id: number;
  code: string;
  name: string;
  origin: string;
  is_gem: boolean;
  default_unit: string | null;
}
export interface SizeScale {
  id: number;
  code: string;
  name: string;
}
export interface SizeValue {
  id: number;
  size_scale_id: number;
  value: number;
  label: string;
  diameter_mm: number | null;
}
export interface PriceList {
  id: number;
  code: string;
  name: string;
  currency_code: string;
  includes_tax: boolean;
  default_margin_pct: number | null;
  rounding_step: number;
  priority: number;
  is_active: boolean;
}
export interface Reason {
  code: string;
  name: string;
  type: string;
  requires_note: boolean;
}

export interface Lookups {
  currencies: { code: string; name: string; symbol: string; is_base: boolean }[];
  units: { code: string; name: string; kind: string }[];
  taxCategories: { code: string; name: string; rate: number }[];
  materials: Material[];
  metalColors: CodeName[];
  finishes: CodeName[];
  stones: Stone[];
  stoneCuts: CodeName[];
  settingTypes: CodeName[];
  colors: CodeName[];
  sizeScales: SizeScale[];
  sizeValues: SizeValue[];
  categories: Category[];
  collections: { id: number; code: string; name: string }[];
  tags: { id: number; slug: string; name: string; kind: string }[];
  priceLists: PriceList[];
  reasons: Reason[];
  locations: Location[];
  users: User[];
  suppliers: { id: number; code: string; name: string }[];
}

export function useLookups() {
  return useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<Lookups>('/lookups'),
    staleTime: 5 * 60_000,
  });
}

/** Categorías con la ruta completa como etiqueta: "Joyería › Anillos › Sortija dama". */
export function categoryLabel(cats: Category[], id: number | null | undefined) {
  if (!id) return '';
  const byId = new Map(cats.map((c) => [c.id, c]));
  const parts: string[] = [];
  let c = byId.get(id);
  while (c) {
    parts.unshift(c.name);
    c = c.parent_id ? byId.get(c.parent_id) : undefined;
  }
  return parts.join(' › ');
}

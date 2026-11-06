import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SYMBOL: Record<string, string> = { PEN: 'S/', USD: 'US$', EUR: '€' };

export function money(v: number | string | null | undefined, currency = 'PEN') {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return `${SYMBOL[currency] ?? currency} ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function qty(v: number | string | null | undefined, digits = 3) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return n.toLocaleString('es-PE', { maximumFractionDigits: digits });
}

export function grams(v: number | string | null | undefined) {
  if (v === null || v === undefined || v === '') return '—';
  return `${Number(v).toLocaleString('es-PE', { maximumFractionDigits: 3 })} g`;
}

export function date(v: string | null | undefined) {
  if (!v) return '—';
  // 'YYYY-MM-DD' (date) se muestra tal cual, sin pasar por la zona horaria
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-');
    return `${d}/${m}/${y}`;
  }
  return new Date(v).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function dateTime(v: string | null | undefined) {
  if (!v) return '—';
  return new Date(v).toLocaleString('es-PE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relative(v: string | null | undefined) {
  if (!v) return '—';
  const diff = (Date.now() - new Date(v).getTime()) / 1000;
  if (diff < 60) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `hace ${Math.floor(diff / 86400)} d`;
  return date(v);
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Convierte strings vacíos del formulario en null antes de mandar a la API. */
export function clean<T extends Record<string, unknown>>(v: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) out[k] = val === '' ? null : val;
  return out as T;
}

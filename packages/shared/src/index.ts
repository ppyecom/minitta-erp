export * from './enums';
export * from './schemas';

// respuesta paginada estándar de la API
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

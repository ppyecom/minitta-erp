// Enums de la base (CREATE TYPE) con su etiqueta en español para la interfaz.
// Si se agrega un valor al enum en una migración nueva, se agrega acá también.

function labels<T extends string>(map: Record<T, string>) {
  return {
    values: Object.keys(map) as [T, ...T[]],
    label: (v: T | null | undefined) => (v ? map[v] ?? v : ''),
    options: (Object.keys(map) as T[]).map((value) => ({ value, label: map[value] })),
  };
}

export const ProductKind = labels({
  jewelry: 'Joyería',
  handicraft: 'Artesanía',
  packaging: 'Empaque',
  supply: 'Insumo',
  service: 'Servicio',
  gift: 'Regalo',
  marketing: 'Marketing',
  other: 'Otro',
});

export const ProductStatus = labels({
  draft: 'Borrador',
  active: 'Activo',
  discontinued: 'Descontinuado',
  archived: 'Archivado',
});

export const Gender = labels({
  women: 'Dama',
  men: 'Varón',
  unisex: 'Unisex',
  kids: 'Niño(a)',
  baby: 'Bebé',
});

export const TrackingMode = labels({
  quantity: 'Por cantidad',
  serial: 'Serializada (pieza por pieza)',
});

export const LocationKind = labels({
  store: 'Tienda',
  warehouse: 'Almacén',
  workshop: 'Taller',
  office: 'Oficina',
  purchasing: 'Compras',
  distribution: 'Distribución',
  consignment: 'Consignación',
  virtual: 'Virtual',
});

export const MovementType = labels({
  opening: 'Apertura',
  purchase: 'Compra',
  purchase_return: 'Devolución a proveedor',
  sale: 'Venta',
  sale_return: 'Devolución de cliente',
  transfer_out: 'Salida por transferencia',
  transfer_in: 'Ingreso por transferencia',
  adjustment: 'Ajuste',
  count: 'Inventario físico',
  production_in: 'Ingreso de taller',
  production_out: 'Salida a taller',
  scrap: 'Merma / baja',
  loan_out: 'Préstamo (salida)',
  loan_in: 'Préstamo (retorno)',
  consignment_out: 'Consignación (salida)',
  consignment_in: 'Consignación (retorno)',
});

// signo que la interfaz aplica a la cantidad según el tipo (la base guarda + entra, - sale)
export const MOVEMENT_SIGN: Record<(typeof MovementType.values)[number], 1 | -1 | 0> = {
  opening: 1,
  purchase: 1,
  purchase_return: -1,
  sale: -1,
  sale_return: 1,
  transfer_out: -1,
  transfer_in: 1,
  adjustment: 0, // el usuario elige el signo
  count: 0,
  production_in: 1,
  production_out: -1,
  scrap: -1,
  loan_out: -1,
  loan_in: 1,
  consignment_out: -1,
  consignment_in: 1,
};

// tipos que se registran a mano; los de transferencia y conteo los generan sus funciones
export const MANUAL_MOVEMENT_TYPES = [
  'purchase',
  'purchase_return',
  'sale',
  'sale_return',
  'adjustment',
  'production_in',
  'production_out',
  'scrap',
  'loan_out',
  'loan_in',
  'consignment_out',
  'consignment_in',
] as const;

export const SerialStatus = labels({
  in_stock: 'En stock',
  reserved: 'Apartada',
  in_transit: 'En tránsito',
  in_workshop: 'En taller',
  on_loan: 'Prestada',
  consigned: 'En consignación',
  sold: 'Vendida',
  returned: 'Devuelta',
  lost: 'Perdida',
  scrapped: 'Dada de baja',
});

export const TransferStatus = labels({
  draft: 'Borrador',
  sent: 'Enviada',
  partially_received: 'Recibida parcial',
  received: 'Recibida',
  cancelled: 'Anulada',
});

export const TransferPurpose = labels({
  restock: 'Reposición',
  exhibition: 'Exhibición',
  repair: 'Reparación',
  return: 'Devolución',
  rebalance: 'Rebalanceo',
});

export const CountStatus = labels({
  open: 'Abierto',
  counting: 'Contando',
  closed: 'Cerrado',
  applied: 'Aplicado',
  cancelled: 'Anulado',
});

export const PriceMode = labels({
  manual: 'Manual',
  by_weight: 'Por peso',
  by_margin: 'Por margen',
});

export const StoneOrigin = labels({
  natural: 'Natural',
  lab_grown: 'Laboratorio',
  synthetic: 'Sintética',
  imitation: 'Imitación',
  organic: 'Orgánica',
});

export const MaterialFamily = labels({
  gold: 'Oro',
  silver: 'Plata',
  platinum: 'Platino',
  palladium: 'Paladio',
  steel: 'Acero',
  bronze: 'Bronce',
  copper: 'Cobre',
  brass: 'Latón',
  nickel: 'Níquel',
  alpaca: 'Alpaca',
  marble: 'Mármol',
  wood: 'Madera',
  leather: 'Cuero',
  textile: 'Textil',
  resin: 'Resina',
  costume: 'Fantasía',
  other: 'Otro',
});

export const ReservationKind = labels({
  layaway: 'Apartado',
  cart: 'Carrito',
  order: 'Pedido',
  hold: 'Retención',
  repair: 'Reparación',
});

export const ReservationStatus = labels({
  active: 'Activo',
  fulfilled: 'Entregado',
  cancelled: 'Anulado',
  expired: 'Vencido',
});

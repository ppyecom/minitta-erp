import { lazy, Suspense, type ComponentType } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppShell } from '@/components/app-shell';
import { Skeleton } from '@/components/ui/misc';

// Cada pantalla se carga recién cuando se abre: al sumar módulos (ventas,
// compras, caja…) el arranque no se vuelve más pesado.
function page<K extends string>(load: () => Promise<{ [P in K]: ComponentType }>, name: K) {
  const C: ComponentType = lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
  return (
    <Suspense fallback={<Skeleton className="h-72 w-full" />}>
      <C />
    </Suspense>
  );
}

// Un bloque de rutas por módulo, igual que la API. Ventas, compras, caja y
// clientes se agregan acá como nuevas secciones.
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={page(() => import('@/modules/dashboard/DashboardPage'), 'DashboardPage')} />

          <Route path="catalogo">
            <Route index element={<Navigate to="productos" replace />} />
            <Route path="productos" element={page(() => import('@/modules/catalog/ProductsPage'), 'ProductsPage')} />
            <Route path="productos/:id" element={page(() => import('@/modules/catalog/ProductDetailPage'), 'ProductDetailPage')} />
            <Route path="maestros" element={page(() => import('@/modules/catalog/MastersPage'), 'MastersPage')} />
          </Route>

          <Route path="inventario">
            <Route index element={<Navigate to="stock" replace />} />
            <Route path="stock" element={page(() => import('@/modules/inventory/StockPage'), 'StockPage')} />
            <Route path="kardex" element={page(() => import('@/modules/inventory/KardexPage'), 'KardexPage')} />
            <Route path="piezas" element={page(() => import('@/modules/inventory/SerialsPage'), 'SerialsPage')} />
            <Route path="transferencias" element={page(() => import('@/modules/inventory/TransfersPage'), 'TransfersPage')} />
            <Route path="transferencias/:id" element={page(() => import('@/modules/inventory/TransferDetailPage'), 'TransferDetailPage')} />
            <Route path="conteos" element={page(() => import('@/modules/inventory/CountsPage'), 'CountsPage')} />
            <Route path="conteos/:id" element={page(() => import('@/modules/inventory/CountDetailPage'), 'CountDetailPage')} />
          </Route>

          <Route path="precios" element={page(() => import('@/modules/pricing/PricingPage'), 'PricingPage')} />

          <Route path="ajustes">
            <Route index element={<Navigate to="sedes" replace />} />
            <Route path="sedes" element={page(() => import('@/modules/settings/LocationsPage'), 'LocationsPage')} />
            <Route path="usuarios" element={page(() => import('@/modules/settings/UsersPage'), 'UsersPage')} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

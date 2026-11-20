import { lazy, Suspense, type ComponentType } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppShell } from '@/components/app-shell';
import { Skeleton } from '@/components/ui/misc';
import { AuthGate } from '@/modules/auth/LoginPage';

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
//
// AuthGate envuelve todo: sin sesión no se monta ninguna pantalla. Igual el
// corte de verdad lo hace la API (AuthGuard + core.user_can), esto es para que
// el usuario no vea botones que no puede usar.
export function App() {
  return (
    <AuthGate>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={page(() => import('@/modules/dashboard/DashboardPage'), 'DashboardPage')} />

            <Route path="catalogo">
              <Route index element={<Navigate to="productos" replace />} />
              <Route path="productos" element={page(() => import('@/modules/catalog/ProductsPage'), 'ProductsPage')} />
              <Route path="productos/:id" element={page(() => import('@/modules/catalog/ProductDetailPage'), 'ProductDetailPage')} />
              <Route path="pendientes" element={page(() => import('@/modules/catalog/PendingPage'), 'PendingPage')} />
              <Route path="maestros" element={page(() => import('@/modules/catalog/MastersPage'), 'MastersPage')} />
            </Route>

          <Route path="clientes">
            <Route index element={page(() => import('@/modules/customers/CustomersPage'), 'CustomersPage')} />
            <Route path=":id" element={page(() => import('@/modules/customers/CustomerDetailPage'), 'CustomerDetailPage')} />
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

          <Route path="procesos">
            <Route index element={<Navigate to="afuera" replace />} />
            <Route path="afuera" element={page(() => import('@/modules/ops/PiecesOutPage'), 'PiecesOutPage')} />
            <Route path="custodia" element={page(() => import('@/modules/ops/CustodyPage'), 'CustodyPage')} />
            <Route path="custodia/:id" element={page(() => import('@/modules/ops/CustodyDetailPage'), 'CustodyDetailPage')} />
            <Route path="taller" element={page(() => import('@/modules/ops/WorkOrdersPage'), 'WorkOrdersPage')} />
            <Route path="taller/:id" element={page(() => import('@/modules/ops/WorkOrderDetailPage'), 'WorkOrderDetailPage')} />
            <Route path="consignaciones" element={page(() => import('@/modules/ops/ConsignmentsPage'), 'ConsignmentsPage')} />
            <Route path="consignaciones/:id" element={page(() => import('@/modules/ops/ConsignmentDetailPage'), 'ConsignmentDetailPage')} />
            <Route path="apartados" element={page(() => import('@/modules/ops/LayawaysPage'), 'LayawaysPage')} />
          </Route>

          <Route path="precios" element={page(() => import('@/modules/pricing/PricingPage'), 'PricingPage')} />

          <Route path="ajustes">
            <Route index element={<Navigate to="sedes" replace />} />
            <Route path="sedes" element={page(() => import('@/modules/settings/LocationsPage'), 'LocationsPage')} />
            <Route path="usuarios" element={page(() => import('@/modules/settings/UsersPage'), 'UsersPage')} />
            <Route path="mi-cuenta" element={page(() => import('@/modules/settings/MyAccountPage'), 'MyAccountPage')} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthGate>
  );
}

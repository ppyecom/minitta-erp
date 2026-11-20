import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CoreModule } from './modules/core/core.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OpsModule } from './modules/ops/ops.module';
import { PricingModule } from './modules/pricing/pricing.module';

// Un módulo por dominio. Los que vienen (ventas, compras, caja, clientes)
// se agregan acá sin tocar los existentes: se enganchan por inventory.post_movement().
//
// AuthModule va primero porque registra el guard global: todo endpoint queda
// protegido por omisión, y un módulo nuevo no puede olvidarse de pedir sesión.
@Module({
  imports: [AuthModule, DbModule, CoreModule, CatalogModule, PricingModule, InventoryModule, OpsModule],
})
export class AppModule {}

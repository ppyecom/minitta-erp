import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CoreModule } from './modules/core/core.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PricingModule } from './modules/pricing/pricing.module';

// Un módulo por dominio. Los que vienen (ventas, compras, caja, clientes, taller)
// se agregan acá sin tocar los existentes: se enganchan por inventory.post_movement().
@Module({
  imports: [DbModule, CoreModule, CatalogModule, PricingModule, InventoryModule],
})
export class AppModule {}

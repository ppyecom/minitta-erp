import { Module } from '@nestjs/common';
import { MastersController } from './masters.controller';
import { PendingController } from './pending.controller';
import { MediaService } from './media.service';
import { ProductsController } from './products.controller';
import { VariantsController } from './variants.controller';

@Module({
  controllers: [ProductsController, VariantsController, MastersController, PendingController],
  providers: [MediaService],
  exports: [MediaService],
})
export class CatalogModule {}

import { Module } from '@nestjs/common';
import { CountsController } from './counts.controller';
import { SerialsController } from './serials.controller';
import { StockController } from './stock.controller';
import { TransfersController } from './transfers.controller';

@Module({
  controllers: [StockController, SerialsController, TransfersController, CountsController],
})
export class InventoryModule {}

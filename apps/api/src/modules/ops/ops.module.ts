import { Module } from '@nestjs/common';
import { ConsignmentsController } from './consignments.controller';
import { CustodyController } from './custody.controller';
import { OpsController } from './ops.controller';
import { WorkOrdersController } from './work-orders.controller';

// Procesos: custodia (piezas que no son nuestras), taller con cuadre de gramos,
// consignación y apartados. Ver docs/08-procesos.md y CLAUDE.md §7.
@Module({
  controllers: [OpsController, CustodyController, WorkOrdersController, ConsignmentsController],
})
export class OpsModule {}

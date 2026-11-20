import { Module } from '@nestjs/common';
import { CoreController } from './core.controller';
import { CustomersController } from './customers.controller';

@Module({ controllers: [CoreController, CustomersController] })
export class CoreModule {}

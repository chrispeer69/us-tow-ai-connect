import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { ConviniController } from './convini.controller';
import { ConviniService } from './convini.service';

@Module({
  controllers: [ConviniController],
  providers: [ConviniService, AdminAuthGuard],
  exports: [ConviniService],
})
export class ConviniModule {}

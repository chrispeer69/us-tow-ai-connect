import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [DbModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}

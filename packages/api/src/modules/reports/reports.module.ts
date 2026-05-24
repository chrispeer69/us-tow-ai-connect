import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

// DB_CLIENT and REDIS_CLIENT are provided by the @Global() DbModule /
// RedisModule, so no imports are needed here.
@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}

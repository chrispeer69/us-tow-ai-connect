import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SentryDebugController } from './sentry-debug.controller';
import { AdaptersModule } from '../adapters/adapters.module';

@Module({
  imports: [AdaptersModule],
  controllers: [AdminController, SentryDebugController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}

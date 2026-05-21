import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdaptersModule } from '../adapters/adapters.module';

@Module({
  imports: [AdaptersModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}

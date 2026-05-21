import { Module } from '@nestjs/common';
import { AiConnectController } from './ai-connect.controller';
import { AiConnectService } from './ai-connect.service';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [TenantsModule],
  controllers: [AiConnectController],
  providers: [AiConnectService],
})
export class AiConnectModule {}

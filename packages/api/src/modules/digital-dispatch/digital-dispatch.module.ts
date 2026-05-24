import { Module } from '@nestjs/common';
import { AdaptersModule } from '../adapters/adapters.module';
import { CommandCenterModule } from '../command-center/command-center.module';
import { MembersModule } from '../members/members.module';
import { DigitalDispatchController } from './digital-dispatch.controller';
import { DigitalDispatchService } from './digital-dispatch.service';
import { DispatchRulesEngineService } from './dispatch-rules-engine.service';

@Module({
  // MembersModule provides MembersService for the PermissionGuard's DI (Session 45).
  imports: [AdaptersModule, CommandCenterModule, MembersModule],
  controllers: [DigitalDispatchController],
  providers: [DigitalDispatchService, DispatchRulesEngineService],
  exports: [DispatchRulesEngineService],
})
export class DigitalDispatchModule {}

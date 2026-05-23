import { Module } from '@nestjs/common';
import { AdaptersModule } from '../adapters/adapters.module';
import { CommandCenterModule } from '../command-center/command-center.module';
import { DigitalDispatchController } from './digital-dispatch.controller';
import { DigitalDispatchService } from './digital-dispatch.service';
import { DispatchRulesEngineService } from './dispatch-rules-engine.service';

@Module({
  imports: [AdaptersModule, CommandCenterModule],
  controllers: [DigitalDispatchController],
  providers: [DigitalDispatchService, DispatchRulesEngineService],
  exports: [DispatchRulesEngineService],
})
export class DigitalDispatchModule {}

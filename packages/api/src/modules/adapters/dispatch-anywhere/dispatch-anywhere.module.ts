import { Module } from '@nestjs/common';
import { DispatchAnywhereAdapter } from './dispatch-anywhere.adapter';

@Module({
  providers: [DispatchAnywhereAdapter],
  exports: [DispatchAnywhereAdapter],
})
export class DispatchAnywhereModule {}

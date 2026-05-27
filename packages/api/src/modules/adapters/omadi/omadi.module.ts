import { Module } from '@nestjs/common';
import { OmadiAdapter } from './omadi.adapter';

@Module({
  providers: [OmadiAdapter],
  exports: [OmadiAdapter],
})
export class OmadiModule {}

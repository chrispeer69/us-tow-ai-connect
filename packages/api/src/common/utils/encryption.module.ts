import { Global, Module } from '@nestjs/common';
import { EncryptionUtil } from './encryption.util';

@Global()
@Module({
  providers: [EncryptionUtil],
  exports: [EncryptionUtil],
})
export class EncryptionModule {}

import { Injectable } from '@nestjs/common';
import { SoftwareType, type TowingSoftwareAdapter } from './adapter.interface';
import { TowbookAdapter } from './towbook/towbook.adapter';

@Injectable()
export class AdapterFactory {
  constructor(private readonly towbook: TowbookAdapter) {}

  getAdapter(softwareType: string): TowingSoftwareAdapter {
    switch (softwareType.toUpperCase()) {
      case SoftwareType.TOWBOOK:
        return this.towbook;
      case SoftwareType.TOWLOGS:
      case SoftwareType.OMADI:
      case SoftwareType.AAA_PORTAL:
      case SoftwareType.NATIVE:
        // Other adapters are scoped to future sessions. Returning a clear
        // error here is preferred to silently routing to Towbook.
        throw new Error(`Adapter for ${softwareType} not implemented yet`);
      default:
        throw new Error(`Unknown software type: ${softwareType}`);
    }
  }
}

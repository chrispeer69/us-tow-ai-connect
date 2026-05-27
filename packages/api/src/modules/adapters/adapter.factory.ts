import { Injectable } from '@nestjs/common';
import { SoftwareType, type TowingSoftwareAdapter } from './adapter.interface';
import { TowbookAdapter } from './towbook/towbook.adapter';
import { AaaPortalAdapter } from './aaa-portal/aaa-portal.adapter';
import { TowLogsAdapter } from './towlogs/towlogs.adapter';
import { OmadiAdapter } from './omadi/omadi.adapter';
@Injectable()
export class AdapterFactory {
  constructor(
    private readonly towbook: TowbookAdapter,
    private readonly aaaPortal: AaaPortalAdapter,
    private readonly towlogs: TowLogsAdapter,
    private readonly omadi: OmadiAdapter,
  ) {}
  getAdapter(softwareType: string): TowingSoftwareAdapter {
    switch (softwareType.toUpperCase()) {
      case SoftwareType.TOWBOOK:
        return this.towbook;
      case SoftwareType.AAA_PORTAL:
        return this.aaaPortal;
      case SoftwareType.TOWLOGS:
        return this.towlogs;
      case SoftwareType.OMADI:
        return this.omadi;
      case SoftwareType.NATIVE:
        throw new Error(`Adapter for ${softwareType} not implemented yet`);
      default:
        throw new Error(`Unknown software type: ${softwareType}`);
    }
  }
}

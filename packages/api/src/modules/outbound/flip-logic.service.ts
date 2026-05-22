import { Injectable } from '@nestjs/common';
import type { DestinationType } from './google-places.service';

export type ConviniSellType = 'SOFT' | 'MEDIUM' | 'HARD';

export interface FlipDecision {
  flipEligible: boolean;
  conviniSellType: ConviniSellType;
  nearestShop: string | null;
}

const OUR_REPAIR_SHOPS = [
  { name: 'Excite Collision & Repair of Westerville', address: '123 State St, Westerville OH' },
];

const OUR_BODY_SHOPS = [{ name: 'T&C Auto Body', address: '' }];

@Injectable()
export class FlipLogicService {
  decide(destinationType: DestinationType | string, destinationAddress: string): FlipDecision {
    const all = [...OUR_REPAIR_SHOPS, ...OUR_BODY_SHOPS];
    const haystack = (destinationAddress ?? '').toLowerCase();
    const isOurs = all.some((shop) => shop.name && haystack.includes(shop.name.toLowerCase()));

    if (isOurs) {
      return { flipEligible: false, conviniSellType: 'SOFT', nearestShop: null };
    }

    switch (destinationType) {
      case 'AUTO_REPAIR':
        return {
          flipEligible: true,
          conviniSellType: 'SOFT',
          nearestShop: OUR_REPAIR_SHOPS[0]?.name ?? null,
        };
      case 'AUTO_BODY':
        return { flipEligible: false, conviniSellType: 'MEDIUM', nearestShop: null };
      case 'RESIDENTIAL':
      case 'UNKNOWN':
      default:
        return { flipEligible: false, conviniSellType: 'HARD', nearestShop: null };
    }
  }
}

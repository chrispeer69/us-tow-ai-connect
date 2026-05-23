import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FlipAcceptService } from './flip-accept.service';

@Injectable()
export class FlipAcceptExpiryCron {
  private readonly logger = new Logger(FlipAcceptExpiryCron.name);
  constructor(private readonly service: FlipAcceptService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async sweep(): Promise<void> {
    try {
      const result = await this.service.expirePending();
      if (result.expired > 0) {
        this.logger.log(`Sweep expired ${result.expired} pending flip-accept request(s)`);
      }
    } catch (err) {
      this.logger.warn(`expiry sweep failed: ${(err as Error).message}`);
    }
  }
}

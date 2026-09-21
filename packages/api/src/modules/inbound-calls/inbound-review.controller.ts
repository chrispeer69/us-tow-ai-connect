import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from '../../common/utils/retell-signature';
import { InboundReviewService } from './inbound-review.service';

/**
 * Run the inbound daily review on demand for any date — the same code the
 * 6 AM cron runs. Guarded by a shared secret rather than the admin JWT so it
 * can be fired from a terminal to prove the pipeline, the same way
 * alpha-crash-calls' middleware alert is.
 *
 *   curl -X POST https://api.ustowaiconnect.com/v1/inbound-review/run \
 *     -H "X-Inbound-Review-Secret: $INBOUND_REVIEW_RUN_SECRET" \
 *     -H "content-type: application/json" -d '{"date":"2026-09-10"}'
 */
@Controller('v1/inbound-review')
export class InboundReviewController {
  constructor(private readonly review: InboundReviewService) {}

  @Post('run')
  @HttpCode(200)
  async run(@Headers('x-inbound-review-secret') secret: string | undefined, @Body() body: { date?: string }) {
    const expected = process.env.INBOUND_REVIEW_RUN_SECRET?.trim();
    if (!expected || !secret || !timingSafeEqual(secret, expected)) {
      throw new UnauthorizedException();
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body?.date ?? '') ? (body.date as string) : this.review.yesterdayEt();
    const result = await this.review.runReview(date);
    return { date, ...result };
  }
}

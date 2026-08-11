import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CallReviewService } from './call-review.service';

const ReviewDecisionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'LIVE', 'RETIRED']),
  note: z.string().max(2000).optional(),
});
type ReviewDecisionBody = z.infer<typeof ReviewDecisionSchema>;

const RunNowSchema = z.object({
  // ISO date (YYYY-MM-DD). Defaults to yesterday.
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
});
type RunNowBody = z.infer<typeof RunNowSchema>;

@Controller('v1/admin/call-review')
@UseGuards(AdminAuthGuard)
export class CallReviewController {
  constructor(private readonly reviews: CallReviewService) {}

  /** Daily review runs, newest first. */
  @Get('runs')
  listRuns(@Req() req: AdminRequest, @Query('limit') limit?: string) {
    const n = Number(limit);
    return this.reviews.listRuns(req.tenantId, Number.isFinite(n) && n > 0 ? Math.min(n, 90) : 30);
  }

  /** One run plus the recommendations it produced. */
  @Get('runs/:id')
  getRun(@Req() req: AdminRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.reviews.getRun(req.tenantId, id);
  }

  /** Proposed script edits awaiting review. Filter with ?status=PROPOSED. */
  @Get('recommendations')
  listRecommendations(@Req() req: AdminRequest, @Query('status') status?: string) {
    return this.reviews.listRecommendations(req.tenantId, status);
  }

  /**
   * Approve or reject a proposal. Approving records the decision only — it
   * never edits the live script, so this endpoint cannot change what a customer
   * hears.
   */
  @Post('recommendations/:id/review')
  review(
    @Req() req: AdminRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(ReviewDecisionSchema)) body: ReviewDecisionBody,
  ) {
    const actor = (req.user as { email?: string } | undefined)?.email ?? null;
    return this.reviews.reviewRecommendation(req.tenantId, id, body.status, actor, body.note);
  }

  /** Win rate sliced by script version / variant / scenario. */
  @Get('performance')
  performance(@Req() req: AdminRequest, @Query('days') days?: string) {
    const n = Number(days);
    return this.reviews.performanceByVersion(
      req.tenantId,
      Number.isFinite(n) && n > 0 ? Math.min(n, 365) : 90,
    );
  }

  /** Trigger a review on demand — for backfills and for testing the loop. */
  @Post('run')
  runNow(
    @Req() req: AdminRequest,
    @Body(new ZodValidationPipe(RunNowSchema)) body: RunNowBody,
  ) {
    const date =
      body.date ??
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return this.reviews.runReview(req.tenantId, date);
  }
}

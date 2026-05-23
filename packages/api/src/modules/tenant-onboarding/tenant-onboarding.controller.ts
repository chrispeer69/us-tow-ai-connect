import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  OnboardingCompleteSchema,
  OnboardingStartSchema,
  OnboardingStepSchema,
  OnboardingTestCredentialsSchema,
  type OnboardingCompleteBody,
  type OnboardingStartBody,
  type OnboardingStepBody,
  type OnboardingTestCredentialsBody,
} from '@ustow/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TenantOnboardingService } from './tenant-onboarding.service';
import { OnboardingRateLimitGuard } from './onboarding-rate-limit.guard';

function getClientIp(req: Request): string {
  const xff = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return xff || req.socket?.remoteAddress || req.ip || 'unknown';
}

/**
 * Public, unauthenticated 4-step onboarding flow. Captcha (when
 * SIGNUP_CAPTCHA_KEY is set) and per-IP rate limit (3 completions / hr)
 * gate the /complete endpoint. /start /step /test-credentials use the
 * shared RateLimitGuard (60/min by IP).
 */
@Controller('v1/onboarding')
export class TenantOnboardingController {
  constructor(private readonly service: TenantOnboardingService) {}

  @Post('start')
  @HttpCode(201)
  @UsePipes(new ZodValidationPipe(OnboardingStartSchema))
  start(@Req() req: Request, @Body() body: OnboardingStartBody) {
    return this.service.startDraft(body, getClientIp(req));
  }

  @Post('step')
  @UsePipes(new ZodValidationPipe(OnboardingStepSchema))
  step(@Body() body: OnboardingStepBody) {
    return this.service.saveStep(body);
  }

  @Post('test-credentials')
  @UsePipes(new ZodValidationPipe(OnboardingTestCredentialsSchema))
  testCredentials(@Body() body: OnboardingTestCredentialsBody) {
    return this.service.testCredentials(body);
  }

  @Post('complete')
  @HttpCode(201)
  @UseGuards(OnboardingRateLimitGuard)
  @UsePipes(new ZodValidationPipe(OnboardingCompleteSchema))
  complete(@Req() req: Request, @Body() body: OnboardingCompleteBody) {
    return this.service.complete(body, getClientIp(req));
  }

  @Get('drafts/:id')
  getDraft(@Param('id') id: string) {
    return this.service.getDraft(id);
  }
}

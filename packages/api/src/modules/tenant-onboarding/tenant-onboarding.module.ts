import { Module } from '@nestjs/common';
import { TenantOnboardingController } from './tenant-onboarding.controller';
import { TenantOnboardingService } from './tenant-onboarding.service';
import { CaptchaService } from './captcha.service';
import { OnboardingRateLimitGuard } from './onboarding-rate-limit.guard';
import { AdaptersModule } from '../adapters/adapters.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AdaptersModule, NotificationsModule],
  controllers: [TenantOnboardingController],
  providers: [TenantOnboardingService, CaptchaService, OnboardingRateLimitGuard],
  exports: [TenantOnboardingService],
})
export class TenantOnboardingModule {}

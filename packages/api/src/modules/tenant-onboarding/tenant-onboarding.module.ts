import { Module } from '@nestjs/common';
import { TenantOnboardingController } from './tenant-onboarding.controller';
import { TenantOnboardingService } from './tenant-onboarding.service';
import { CaptchaService } from './captcha.service';
import { OnboardingRateLimitGuard } from './onboarding-rate-limit.guard';
import { AdaptersModule } from '../adapters/adapters.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AdaptersModule, NotificationsModule, AuthModule],
  controllers: [TenantOnboardingController],
  providers: [TenantOnboardingService, CaptchaService, OnboardingRateLimitGuard],
  exports: [TenantOnboardingService],
})
export class TenantOnboardingModule {}

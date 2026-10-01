import { Module } from '@nestjs/common';
import { TenantOnboardingController } from './tenant-onboarding.controller';
import { TenantOnboardingService } from './tenant-onboarding.service';
import { CaptchaService } from './captcha.service';
import { OnboardingRateLimitGuard } from './onboarding-rate-limit.guard';
import { AdaptersModule } from '../adapters/adapters.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';
import { GhlAccountSyncModule } from '../ghl-account-sync/ghl-account-sync.module';

@Module({
  imports: [AdaptersModule, NotificationsModule, AuthModule, GhlAccountSyncModule],
  controllers: [TenantOnboardingController],
  providers: [TenantOnboardingService, CaptchaService, OnboardingRateLimitGuard],
  exports: [TenantOnboardingService],
})
export class TenantOnboardingModule {}

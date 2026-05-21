import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RedisModule } from './common/redis/redis.module';
import { EncryptionModule } from './common/utils/encryption.module';
import { DbModule } from './db/db.module';
import { AdaptersModule } from './modules/adapters/adapters.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SessionManagerModule } from './modules/session-manager/session-manager.module';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    RedisModule,
    EncryptionModule,
    DbModule,
    AdaptersModule,
    NotificationsModule,
    SessionManagerModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

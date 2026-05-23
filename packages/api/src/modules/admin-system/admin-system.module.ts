import { Module } from '@nestjs/common';
import { AdminSystemController } from './admin-system.controller';
import { AdminSystemService } from './admin-system.service';

/**
 * Session 26 — Bundle B section 4.
 *
 * Cross-cutting operator endpoints. Today this is /system/stats and
 * /system/limits. Future operator probes (drop a job, retry a webhook,
 * etc.) can live here so they don't pollute the per-domain admin
 * controllers.
 */
@Module({
  controllers: [AdminSystemController],
  providers: [AdminSystemService],
  exports: [AdminSystemService],
})
export class AdminSystemModule {}

import { Controller, Get, HttpCode, Inject, Logger, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { REDIS_CLIENT } from '../../common/redis/redis.module';

type CheckResult = { ok: boolean; latencyMs?: number; error?: string };

const CHECK_TIMEOUT_MS = 2000;

async function withTimeout<T>(label: string, fn: () => Promise<T>): Promise<CheckResult> {
  const start = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} check timed out after ${CHECK_TIMEOUT_MS}ms`)), CHECK_TIMEOUT_MS),
      ),
    ]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @Inject(DB_CLIENT) private readonly db: DbClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // Liveness: returns 200 the moment Nest finished booting. No deps. Railway
  // and any external uptime monitor can hit this without holding the DB hostage.
  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  // Readiness: 200 only when Postgres + Redis are reachable. Used by
  // Railway's healthcheckPath in railway.toml so a deploy is not promoted
  // until the dependencies are actually live.
  @Get('health/ready')
  @HttpCode(200)
  async ready(@Res() res: Response) {
    const [dbCheck, redisCheck] = await Promise.all([
      withTimeout('db', () => this.db.execute(sql`select 1`)),
      withTimeout('redis', () => this.redis.ping()),
    ]);

    const allOk = dbCheck.ok && redisCheck.ok;
    const body = {
      status: allOk ? 'ready' : 'not_ready',
      checks: { db: dbCheck, redis: redisCheck },
      timestamp: new Date().toISOString(),
    };

    if (!allOk) {
      this.logger.warn(
        `readiness check failing: db=${dbCheck.ok ? 'ok' : dbCheck.error} redis=${redisCheck.ok ? 'ok' : redisCheck.error}`,
      );
      res.status(503).json(body);
      return;
    }
    res.status(200).json(body);
  }
}

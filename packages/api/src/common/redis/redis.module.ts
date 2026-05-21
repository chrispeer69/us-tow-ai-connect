import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

class RedisLifecycle implements OnModuleDestroy {
  constructor(private readonly client: Redis) {}
  onModuleDestroy() {
    this.client.disconnect();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
        const client = new Redis(url, {
          lazyConnect: false,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          retryStrategy(times) {
            return Math.min(times * 200, 2000);
          },
        });
        client.on('error', (err) => {
          // eslint-disable-next-line no-console
          console.error('[redis] error', err.message);
        });
        return client;
      },
    },
    RedisLifecycle,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}

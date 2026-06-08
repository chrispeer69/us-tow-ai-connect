import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { TowbookAdapter } from './src/modules/adapters/towbook/towbook.adapter';
import { CryptoService } from './src/modules/crypto/crypto.service';
import { db } from './src/db/db';
import { tenants } from './src/db/schema';
import { eq } from 'drizzle-orm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const adapter = app.get(TowbookAdapter);
  const cryptoService = app.get(CryptoService);
  
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, 'chrispeer69')
  });

  const credsStr = await cryptoService.decrypt(tenant.targetSoftwareCredentialsEncrypted);
  const creds = JSON.parse(credsStr);
  
  process.env.TOWBOOK_DEBUG_DUMP = '1';
  
  console.log('Fetching jobs for chrispeer69...');
  try {
    const jobs = await adapter.fetchActiveJobs('chrispeer69', creds);
    console.log(`Found ${jobs.length} jobs.`);
    for (const job of jobs) {
      console.log(`Job ${job.jobId}: ETA='${job.eta}'`);
    }
  } catch (err) {
    console.error(err);
  }
  
  await app.close();
  process.exit(0);
}

bootstrap();

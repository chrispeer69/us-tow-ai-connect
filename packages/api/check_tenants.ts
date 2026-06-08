import { db } from './src/db/client';
import { tenants } from './src/db/schema';

async function main() {
  const allTenants = await db.select({
    id: tenants.id,
    companyName: tenants.companyName,
    outboundVoiceEnabled: tenants.outboundVoiceEnabled,
    outboundVoiceConfig: tenants.outboundVoiceConfig,
  }).from(tenants);
  console.log(JSON.stringify(allTenants, null, 2));
  process.exit(0);
}
main().catch(console.error);

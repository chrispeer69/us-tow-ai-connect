const fs = require('fs');
const files = [
  'packages/api/src/modules/outbound/twilio-outbound.service.ts',
  'packages/api/src/modules/outbound/webhooks/twilio-webhook.controller.ts',
  'packages/api/src/db/seeds/roadside-tenant-zero.ts',
  'packages/web/src/app/onboarding/onboarding-client.tsx',
  'packages/shared/src/schemas/onboarding.schema.ts',
  'scripts/twilio/test-outbound-call.ts'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/Polly\.Matthew/g, 'Polly.Joanna');
  fs.writeFileSync(file, content);
}

console.log("Reverted Polly.Matthew back to Polly.Joanna.");

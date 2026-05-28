/**
 * Boot diagnostics — imported as the very first module so we get output
 * even if a later import crashes the process. Remove once the Railway
 * deployment is stable.
 */
/* eslint-disable no-console */
console.log('[BOOT] boot-diag loaded');
console.log('[BOOT] NODE_ENV:', process.env.NODE_ENV);
console.log('[BOOT] PORT:', process.env.PORT);
console.log('[BOOT] DATABASE_URL set:', !!process.env.DATABASE_URL);
console.log('[BOOT] REDIS_URL set:', !!process.env.REDIS_URL);
console.log('[BOOT] SENTRY_DSN set:', !!process.env.SENTRY_DSN);
console.log('[BOOT] PLAYWRIGHT_BROWSERS_PATH:', process.env.PLAYWRIGHT_BROWSERS_PATH);
console.log('[BOOT] cwd:', process.cwd());
console.log('[BOOT] node version:', process.version);

// Check if critical files exist
const fs = require('fs');
const checks = [
  '/app/packages/api/dist/main.js',
  '/app/packages/api/dist/app.module.js',
  '/app/packages/api/dist/instrument.js',
  '/ms-playwright',
];
for (const p of checks) {
  console.log(`[BOOT] exists ${p}:`, fs.existsSync(p));
}

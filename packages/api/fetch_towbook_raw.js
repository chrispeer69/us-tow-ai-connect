const { chromium } = require('playwright');
const crypto = require('crypto');
const { Client } = require('pg');
require('dotenv').config({ path: '.env' });

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query(`SELECT "target_software_credentials_encrypted" FROM tenants WHERE id = 'chrispeer69'`);
  const encryptedStr = res.rows[0].target_software_credentials_encrypted;
  await client.end();

  // Decrypt
  const [ivHex, authTagHex, cipherTextHex] = encryptedStr.split(':');
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'utf-8');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(cipherTextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  const creds = JSON.parse(decrypted);

  console.log('Logging in to Towbook...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.goto('https://app.towbook.com/Security/Login?ReturnUrl=%2F');
  await page.fill('#Username', creds.username);
  await page.fill('#Password', creds.password);
  await page.click('#login-button');
  
  await page.waitForURL('https://app.towbook.com/DS4/', { timeout: 15000 });
  await page.waitForSelector('li.entryRow[data-id]', { state: 'attached', timeout: 15000 });
  
  const html = await page.evaluate(() => {
    const row = document.querySelector('li.entryRow[data-id]');
    return row ? row.outerHTML : 'No rows found';
  });
  
  console.log('--- FIRST ROW HTML ---');
  console.log(html);
  
  await browser.close();
}

run().catch(console.error);

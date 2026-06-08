const crypto = require('crypto');
const http = require('http');

const apiKey = 'key_1b1d0c4ece24ac0238803b2b9af4';
const payload = JSON.stringify({
  event: 'call_ended',
  call: {
    call_id: 'test_call_123',
    call_status: 'ended',
    disconnection_reason: 'user_hangup'
  }
});

// Create signature the way Retell documentation says they do it
const signature = crypto.createHmac('sha256', apiKey).update(payload).digest('hex');
const b64Signature = crypto.createHmac('sha256', apiKey).update(payload).digest('base64');

console.log('Sending Payload:', payload);
console.log('Expected Hex Signature:', signature);
console.log('Expected B64 Signature:', b64Signature);

const req = http.request({
  hostname: 'localhost',
  port: 3001,
  path: '/webhooks/retell/outbound-result',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-retell-signature': 'bad_signature',
    'Content-Length': Buffer.byteLength(payload)
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(`\nResponse Status: ${res.statusCode}`);
    console.log(`Response Body: ${data}`);
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(payload);
req.end();

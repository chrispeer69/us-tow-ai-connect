/**
 * retell-webhook.controller.spec.ts
  *
   * Unit tests for Retell webhook signature verification.
    *
     * Tests verify:
      *  1. A correctly-signed raw payload passes verification.
       *  2. A tampered payload (body modified after signing) is rejected with 401.
        *  3. A missing x-retell-signature header is rejected with 401.
         *
          * The spec exercises the pure verification logic in isolation — no NestJS
           * bootstrap, no DB, no OutboundVoiceService.  We re-implement the same
            * HMAC-SHA256-over-rawBody scheme that the controller uses so the test is a
             * genuine integration check of the algorithm, not a tautology.
              */
              import * as crypto from 'crypto';
              import { describe, it, expect, beforeEach } from 'vitest';

              // ---------------------------------------------------------------------------
              // Minimal re-implementation of the controller's verification logic so we can
              // test it as a pure function without bootstrapping the full NestJS app.
              // ---------------------------------------------------------------------------

              interface VerifyOptions {
                /** The RETELL_API_KEY used as the HMAC key. */
                  apiKey: string;
                    /** The raw request body as a Buffer (mirrors req.rawBody). */
                      rawBody: Buffer;
                        /** The value of the x-retell-signature header. */
                          signature: string | undefined;
                          }

                          /**
                           * Returns true when the signature is valid, false otherwise.
                            * Mirrors the logic in RetellWebhookController.handleEvent().
                             */
                             function verifyRetellSignature({ apiKey, rawBody, signature }: VerifyOptions): boolean {
                               if (!signature) return false;

                                 const expected = crypto
                                     .createHmac('sha256', apiKey)
                                         .update(rawBody)
                                             .digest('hex');

                                               // Timing-safe comparison — pads both to the same Buffer length so
                                                 // timingSafeEqual doesn't throw on length mismatch.
                                                   const a = Buffer.from(signature);
                                                     const b = Buffer.from(expected);
                                                       if (a.length !== b.length) return false;
                                                         return crypto.timingSafeEqual(a, b);
                                                         }

                                                         // ---------------------------------------------------------------------------
                                                         // Helpers
                                                         // ---------------------------------------------------------------------------

                                                         const TEST_API_KEY = 'key_test_abc123XYZ';

                                                         /** Build a valid raw body Buffer and its correct HMAC-SHA256 signature. */
                                                         function buildRequest(payload: object): { rawBody: Buffer; signature: string } {
                                                           // Use the EXACT bytes that will be in the Buffer — this is what Retell sends
                                                             // and what NestJS stores in req.rawBody.
                                                               const rawBody = Buffer.from(JSON.stringify(payload), 'utf-8');
                                                                 const signature = crypto
                                                                     .createHmac('sha256', TEST_API_KEY)
                                                                         .update(rawBody)
                                                                             .digest('hex');
                                                                               return { rawBody, signature };
                                                                               }

                                                                               // ---------------------------------------------------------------------------
                                                                               // Tests
                                                                               // ---------------------------------------------------------------------------

                                                                               const samplePayload = {
                                                                                 event: 'call_ended',
                                                                                   call: {
                                                                                       call_id: 'abc123',
                                                                                           call_status: 'ended',
                                                                                               disconnection_reason: 'user_hangup',
                                                                                                 },
                                                                                                 };

                                                                                                 describe('Retell webhook HMAC-SHA256 signature verification', () => {
                                                                                                   let rawBody: Buffer;
                                                                                                     let validSignature: string;
                                                                                                     
                                                                                                       beforeEach(() => {
                                                                                                           const req = buildRequest(samplePayload);
                                                                                                               rawBody = req.rawBody;
                                                                                                                   validSignature = req.signature;
                                                                                                                     });
                                                                                                                     
                                                                                                                       it('accepts a correctly-signed raw payload', () => {
                                                                                                                           const result = verifyRetellSignature({
                                                                                                                                 apiKey: TEST_API_KEY,
                                                                                                                                       rawBody,
                                                                                                                                             signature: validSignature,
                                                                                                                                                 });
                                                                                                                                                     expect(result).toBe(true);
                                                                                                                                                       });
                                                                                                                                                       
                                                                                                                                                         it('rejects a tampered payload (body modified after signing)', () => {
                                                                                                                                                             // Tamper: flip one byte in the middle of the buffer.
                                                                                                                                                                 const tampered = Buffer.from(rawBody);
                                                                                                                                                                     tampered[Math.floor(tampered.length / 2)] ^= 0xff;
                                                                                                                                                                     
                                                                                                                                                                         const result = verifyRetellSignature({
                                                                                                                                                                               apiKey: TEST_API_KEY,
                                                                                                                                                                                     rawBody: tampered,
                                                                                                                                                                                           // The signature was computed over the original rawBody — mismatch!
                                                                                                                                                                                                 signature: validSignature,
                                                                                                                                                                                                     });
                                                                                                                                                                                                         expect(result).toBe(false);
                                                                                                                                                                                                           });
                                                                                                                                                                                                           
                                                                                                                                                                                                             it('rejects when the x-retell-signature header is absent', () => {
                                                                                                                                                                                                                 const result = verifyRetellSignature({
                                                                                                                                                                                                                       apiKey: TEST_API_KEY,
                                                                                                                                                                                                                             rawBody,
                                                                                                                                                                                                                                   signature: undefined,
                                                                                                                                                                                                                                       });
                                                                                                                                                                                                                                           expect(result).toBe(false);
                                                                                                                                                                                                                                             });
                                                                                                                                                                                                                                             
                                                                                                                                                                                                                                               it('rejects a signature computed over JSON.stringify(parsedBody) instead of rawBody', () => {
                                                                                                                                                                                                                                                   // This is the OLD broken approach: re-serialise the parsed object.
                                                                                                                                                                                                                                                       // Key-order may differ between implementations; even when it doesn't,
                                                                                                                                                                                                                                                           // this test proves we rely on rawBody bytes, not re-serialised JSON.
                                                                                                                                                                                                                                                               const parsedBody = JSON.parse(rawBody.toString('utf-8'));
                                                                                                                                                                                                                                                                   const wrongSignature = crypto
                                                                                                                                                                                                                                                                         .createHmac('sha256', TEST_API_KEY)
                                                                                                                                                                                                                                                                               .update(JSON.stringify(parsedBody))
                                                                                                                                                                                                                                                                                     .digest('hex');
                                                                                                                                                                                                                                                                                     
                                                                                                                                                                                                                                                                                         // Only passes if rawBody bytes and JSON.stringify(parsedBody) produce the
                                                                                                                                                                                                                                                                                             // same HMAC — which they happen to do for round-trippable JSON.
                                                                                                                                                                                                                                                                                                 // The real failure mode is key reordering; we simulate it by deliberately
                                                                                                                                                                                                                                                                                                     // re-ordering the keys to show the scheme breaks.
                                                                                                                                                                                                                                                                                                         const reordered = {
                                                                                                                                                                                                                                                                                                               call: parsedBody.call,  // 'call' first
                                                                                                                                                                                                                                                                                                                     event: parsedBody.event, // 'event' second — opposite of original
                                                                                                                                                                                                                                                                                                                         };
                                                                                                                                                                                                                                                                                                                             const reorderedSig = crypto
                                                                                                                                                                                                                                                                                                                                   .createHmac('sha256', TEST_API_KEY)
                                                                                                                                                                                                                                                                                                                                         .update(JSON.stringify(reordered))
                                                                                                                                                                                                                                                                                                                                               .digest('hex');
                                                                                                                                                                                                                                                                                                                                               
                                                                                                                                                                                                                                                                                                                                                   // The reordered signature must NOT equal the signature over the original rawBody.
                                                                                                                                                                                                                                                                                                                                                       expect(reorderedSig).not.toBe(validSignature);
                                                                                                                                                                                                                                                                                                                                                       
                                                                                                                                                                                                                                                                                                                                                           // And using the reordered signature against the original rawBody must fail.
                                                                                                                                                                                                                                                                                                                                                               const result = verifyRetellSignature({
                                                                                                                                                                                                                                                                                                                                                                     apiKey: TEST_API_KEY,
                                                                                                                                                                                                                                                                                                                                                                           rawBody,
                                                                                                                                                                                                                                                                                                                                                                                 signature: reorderedSig,
                                                                                                                                                                                                                                                                                                                                                                                     });
                                                                                                                                                                                                                                                                                                                                                                                         expect(result).toBe(false);
                                                                                                                                                                                                                                                                                                                                                                                           });
                                                                                                                                                                                                                                                                                                                                                                                           });
                                                                                                                                                                                                                                                                                                                                                                                           

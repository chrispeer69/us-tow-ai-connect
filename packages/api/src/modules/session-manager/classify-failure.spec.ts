import { describe, expect, it } from 'vitest';
import { classifyFailure } from './classify-failure';

describe('classifyFailure', () => {
  it.each([
    ['browserType.launch: Executable doesn\'t exist at /ms-playwright/chromium', 'LAUNCH'],
    ['playwright._impl._api_types.Error: chromium not installed', 'LAUNCH'],
    ['net::ERR_NAME_NOT_RESOLVED at https://app.towbook.com', 'NETWORK'],
    ['ECONNRESET', 'NETWORK'],
    ['Timeout 30000ms exceeded.', 'TIMEOUT'],
    ['waiting for selector "a[href=\\"/DS4/\\"]" failed: timeout 5000ms exceeded', 'TIMEOUT'],
    ['reCAPTCHA challenge displayed before dashboard', 'CAPTCHA'],
    ['element not found: #Username', 'SELECTOR'],
    ['waiting for url(matches **) failed', 'NAVIGATION'],
    ['Navigation timeout exceeded', 'TIMEOUT'],
    ['401 Unauthorized', 'AUTH'],
    ['Invalid credentials supplied', 'AUTH'],
    ['Forbidden by upstream', 'AUTH'],
    ['some random nonsense', 'UNKNOWN'],
    ['', 'UNKNOWN'],
  ])('classifies %j as %s', (input, expected) => {
    expect(classifyFailure(input)).toBe(expected);
  });
});

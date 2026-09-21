import { describe, expect, it } from 'vitest';
import {
  automaticOutboundVoiceAllowedForSource,
  defaultAutomaticOutboundVoiceForSource,
  integrationSoftwareTypeForSource,
} from './outbound-source-policy';

describe('automaticOutboundVoiceAllowedForSource', () => {
  it('keeps established Towbook automatic calls unchanged', () => {
    expect(automaticOutboundVoiceAllowedForSource('towbook', true, undefined)).toBe(true);
  });

  it('keeps AAA automatic calls off by default', () => {
    expect(defaultAutomaticOutboundVoiceForSource('aaa_salesforce')).toBe(false);
    expect(automaticOutboundVoiceAllowedForSource('aaa_salesforce', false, 'true')).toBe(false);
  });

  it('requires both the integration toggle and AAA platform switch', () => {
    expect(automaticOutboundVoiceAllowedForSource('aaa_salesforce', true, 'true')).toBe(true);
    expect(automaticOutboundVoiceAllowedForSource('aaa_salesforce', true, 'false')).toBe(false);
  });

  it('maps job sources to their connected adopter records', () => {
    expect(integrationSoftwareTypeForSource('towbook')).toBe('TOWBOOK');
    expect(integrationSoftwareTypeForSource('aaa_salesforce')).toBe('AAA_PORTAL');
    expect(integrationSoftwareTypeForSource('manual')).toBeNull();
  });
});

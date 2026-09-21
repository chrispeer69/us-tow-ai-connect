/**
 * Connector-level safety gate for automatic customer calls.
 *
 * AAA is intentionally opt-in while a new portal connection is being
 * validated. Other established sources retain their existing behaviour.
 */
export function automaticOutboundVoiceAllowedForSource(
  source: string,
  integrationEnabled: boolean,
  aaaPlatformEnabled = process.env.AAA_AUTOMATIC_OUTBOUND_VOICE_ENABLED,
): boolean {
  if (!integrationEnabled) return false;
  if (source !== 'aaa_salesforce') return true;
  return aaaPlatformEnabled?.trim().toLowerCase() === 'true';
}

export function defaultAutomaticOutboundVoiceForSource(source: string): boolean {
  return source !== 'aaa_salesforce';
}

export function integrationSoftwareTypeForSource(source: string): string | null {
  if (source === 'towbook') return 'TOWBOOK';
  if (source === 'aaa_salesforce') return 'AAA_PORTAL';
  if (source === 'us_tow_dispatch') return 'US_TOW_DISPATCH';
  return null;
}

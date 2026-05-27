import { Logger } from '@nestjs/common';
import type { OutboundVoiceProvider } from './outbound-voice-provider.interface';
import { RetellOutboundClient } from './retell-outbound.client';
import { ThinkrrOutboundClient } from './thinkrr-outbound.client';

/**
 * Session 68 — Provider selection.
 *
 * Resolution order:
 *   1. OUTBOUND_VOICE_PROVIDER env var ("retell" | "thinkrr") — explicit override
 *   2. RETELL_API_KEY present → retell
 *   3. THINKRR_API_KEY present → thinkrr
 *   4. fallback → retell (will log-only because it's unconfigured)
 *
 * Either way both clients are constructed — cancelCall on legacy thinkrr
 * rows must keep working after the cutover, and the webhook controllers
 * both need their respective clients to verify signatures.
 */
export const OUTBOUND_VOICE_PROVIDER = Symbol('OUTBOUND_VOICE_PROVIDER');

export function pickOutboundVoiceProvider(
  retell: RetellOutboundClient,
  thinkrr: ThinkrrOutboundClient,
): OutboundVoiceProvider {
  const logger = new Logger('OutboundVoiceProviderFactory');
  const explicit = process.env.OUTBOUND_VOICE_PROVIDER?.trim().toLowerCase();

  if (explicit === 'retell') {
    logger.log('[outbound-voice] provider=retell (explicit OUTBOUND_VOICE_PROVIDER)');
    return retell;
  }
  if (explicit === 'thinkrr') {
    logger.log('[outbound-voice] provider=thinkrr (explicit OUTBOUND_VOICE_PROVIDER)');
    return thinkrr;
  }
  if (retell.isConfigured()) {
    logger.log('[outbound-voice] provider=retell (RETELL_API_KEY detected)');
    return retell;
  }
  if (thinkrr.isConfigured()) {
    logger.log('[outbound-voice] provider=thinkrr (THINKRR_API_KEY detected)');
    return thinkrr;
  }
  logger.warn('[outbound-voice] no provider configured — defaulting to retell (calls will be log-only)');
  return retell;
}

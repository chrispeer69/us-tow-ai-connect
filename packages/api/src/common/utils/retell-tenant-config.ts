/**
 * Per-tenant Retell configuration.
 *
 * Until now the Retell agent, its pinned version and the caller-ID lived in
 * three process-wide env vars. That is fine with one customer and wrong with
 * two: a script change could not be shipped to one company without moving
 * every company on the deployment at the same time.
 *
 * These three values now live on `tenants.outbound_voice_config`, with the env
 * vars kept as the fallback so an unconfigured tenant behaves exactly as it did
 * before. Nothing has to be migrated for the existing tenant to keep working.
 *
 *   outbound_voice_config: {
 *     retell_outbound_agent_id?: string,   // Retell agent for this tenant
 *     retell_agent_version?: string|number,// published version to pin, or a tag
 *     retell_from_number?: string          // E.164 caller-ID for this tenant
 *   }
 *
 * ⚠️ The one rule worth understanding — agent and version are a PAIR.
 *
 * A Retell version number is scoped to its agent: version 31 of agent A and
 * version 31 of agent B are unrelated scripts, and agent B may have no version
 * 31 at all. So a tenant that runs its own agent must pin its own version; it
 * must never inherit RETELL_AGENT_VERSION, which is a version *of the env
 * agent*. `resolveRetellTenantConfig` enforces that, and the client enforces it
 * again on the wire so a caller that skips this resolver cannot mispair them.
 *
 * A tenant with its own agent and no version set is therefore UNPINNED: Retell
 * serves its latest draft to live calls. That is the same unsafe state the env
 * path warns about, and RetellAgentService refuses draft writes while in it.
 */

export type RetellConfigSource = 'tenant' | 'env' | 'unset';

export interface RetellTenantConfig {
  /** Retell agent id for this tenant, or the deployment default. */
  agentId: string | null;
  /** Published version live calls are pinned to. Null means "latest draft". */
  agentVersion: string | null;
  /** E.164 caller-ID this tenant dials from. */
  fromNumber: string | null;
  /** Where each value came from — surfaced to operators, not used for logic. */
  source: {
    agentId: RetellConfigSource;
    agentVersion: RetellConfigSource;
    fromNumber: RetellConfigSource;
  };
}

/** jsonb can hold `31` or `"31"` for a version — both mean the same thing. */
function readConfigValue(
  config: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const raw = config?.[key];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

function readEnv(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

/**
 * Resolve the Retell settings a tenant's calls should use.
 *
 * @param config the tenant's `outbound_voice_config` jsonb (any shape)
 */
export function resolveRetellTenantConfig(
  config: Record<string, unknown> | null | undefined,
): RetellTenantConfig {
  const tenantAgentId = readConfigValue(config, 'retell_outbound_agent_id');
  const tenantVersion = readConfigValue(config, 'retell_agent_version');
  const tenantFromNumber = readConfigValue(config, 'retell_from_number');

  const envAgentId = readEnv('RETELL_AGENT_ID');
  const envVersion = readEnv('RETELL_AGENT_VERSION');
  const envFromNumber = readEnv('RETELL_FROM_NUMBER');

  const agentId = tenantAgentId ?? envAgentId;

  // See the header note: the env version is a version OF THE ENV AGENT, so it
  // may only be inherited by a tenant that is also using the env agent.
  const usesOwnAgent = tenantAgentId !== null;
  const agentVersion = usesOwnAgent ? tenantVersion : (tenantVersion ?? envVersion);

  const fromNumber = tenantFromNumber ?? envFromNumber;

  return {
    agentId,
    agentVersion,
    fromNumber,
    source: {
      agentId: tenantAgentId ? 'tenant' : envAgentId ? 'env' : 'unset',
      agentVersion: tenantVersion
        ? 'tenant'
        : !usesOwnAgent && envVersion
          ? 'env'
          : 'unset',
      fromNumber: tenantFromNumber ? 'tenant' : envFromNumber ? 'env' : 'unset',
    },
  };
}

/**
 * Retell accepts either a version number or an environment tag
 * ("prod", "latest_published"). Numbers must go over the wire as numbers.
 */
export function encodeAgentVersion(version: string): string | number {
  return /^\d+$/.test(version) ? Number(version) : version;
}

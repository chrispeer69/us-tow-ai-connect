import type { DbClient } from '../../db/db.module';
import { auditLog } from '../../db/schema';

/**
 * Thin wrapper around the Bundle B `audit_log` table for Session 27
 * features. Bundle B owns the table; this helper just keeps the writes
 * consistent across the onboarding / branding / KP-publish / impersonation
 * paths without each call site having to re-discover the column shape.
 *
 * Sanitization (redacting passwords/tokens) is Bundle B's responsibility —
 * we never write a credential into the payload from any of Session 27's
 * features anyway.
 */
export async function recordAudit(
  db: DbClient,
  args: {
    tenantId?: string | null;
    actorType: 'super_admin' | 'tenant_admin' | 'tenant_user' | 'partner' | 'system' | 'anonymous';
    actorId: string;
    action: string;
    resourceType?: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
  },
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      tenantId: args.tenantId ?? null,
      actorType: args.actorType,
      actorId: args.actorId,
      action: args.action,
      resourceType: args.resourceType ?? null,
      resourceId: args.resourceId ?? null,
      beforeState: args.beforeState ?? null,
      afterState: args.afterState ?? null,
      metadata: (args.metadata ?? {}) as never,
    });
  } catch (err) {
    // Audit writes are best-effort: if the table isn't there (e.g. a
    // dev DB without Bundle B's migrations yet) we don't want the
    // primary operation to fail. Surface the error at warn level.
    // eslint-disable-next-line no-console
    console.warn('[audit] write failed', (err as Error).message);
  }
}

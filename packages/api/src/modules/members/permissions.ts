// Session 45 — RBAC roles + permission matrix.
//
// The authoritative grants live in the `role_permissions` table (seeded by
// 0022_members_rbac.sql). This module is the TypeScript mirror: it provides the
// role/status unions used across the API and a static fallback matrix the
// service falls back to when the DB table is empty (e.g. a freshly migrated
// dev DB that hasn't been seeded). Keep in sync with S45_RBAC_MATRIX.md.

export const ROLES = ['OWNER', 'DISPATCHER', 'DRIVER', 'ACCOUNTING', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED'] as const;
export type MemberStatus = (typeof STATUSES)[number];

export const WILDCARD = '*';

/** Static mirror of the seeded matrix. OWNER is the wildcard. */
export const PERMISSION_MATRIX: Record<Role, readonly string[]> = {
  OWNER: [WILDCARD],
  DISPATCHER: [
    'command-center.read',
    'command-center.write',
    'digital-dispatch.read',
    'digital-dispatch.write',
    'drivers-live.read',
    'drivers-live.write',
    'sms-log.read',
    'sms-log.write',
    'calls.read',
    'calls.write',
  ],
  DRIVER: ['driver-portal.read', 'driver-portal.write'],
  ACCOUNTING: [
    'billing.read',
    'billing.write',
    'reports.read',
    'reports.write',
    'audit-log.read',
  ],
  VIEWER: ['integrations.read', 'command-center.read', 'reports.read'],
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** True if the given grant list satisfies the required key (wildcard-aware). */
export function grantsSatisfy(grants: readonly string[], required: string): boolean {
  return grants.includes(WILDCARD) || grants.includes(required);
}

// Session 45 — caller identity resolution for RBAC.
//
// AdminAuthGuard only attaches `req.tenantId`; it does not resolve the acting
// user. RBAC needs the caller's email to map them to a member → role. We
// resolve it here without modifying the shared guard, mirroring its
// JWT-decode approach. Resolution order:
//   1. `Authorization: Bearer <jwt>` — `email` then `sub` claim (decoded as
//      base64url only; not signature-verified — same trust model as the
//      existing AdminAuthGuard, flagged in ASSUMPTIONS.md).
//   2. `x-user-email` header — explicit dev override.
//   3. `DEFAULT_ADMIN_USER_EMAIL` env — single-operator default.
// Returns a lowercased email, or null when no identity is present.

import type { Request } from 'express';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return EMAIL_RE.test(trimmed) ? trimmed : null;
}

function fromJwt(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return asEmail(payload?.email) ?? asEmail(payload?.sub);
  } catch {
    return null;
  }
}

export function resolveUserEmail(req: Request): string | null {
  const header = req.headers['x-user-email'];
  const headerEmail = Array.isArray(header) ? header[0] : header;
  return (
    fromJwt(req.headers.authorization) ??
    asEmail(headerEmail) ??
    asEmail(process.env.DEFAULT_ADMIN_USER_EMAIL)
  );
}

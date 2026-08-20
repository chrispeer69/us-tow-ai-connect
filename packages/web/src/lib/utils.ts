import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getActiveTenantId } from './active-tenant';

/**
 * Enhanced clsx-style class merger that supports tailwind-merge.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export const TENANT_HEADER = 'x-tenant-id';
// Must be a real tenants.id UUID. The API's tenants.id column is uuid-typed,
// so a non-UUID fallback (e.g. the previous "default-tenant" literal) causes
// every admin endpoint to 500 on the Postgres cast. Mirrors the API-side
// DEFAULT_ADMIN_TENANT_ID env default — keep in sync with .env.example.
// Exported so pages that can't use api() (e.g. blob downloads) reuse the
// same value instead of declaring their own.
export const DEFAULT_TENANT_ID =
  process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';

export async function api<T = any>(
  path: string,
  opts: RequestInit & { json?: any; direct?: boolean } = {},
): Promise<T> {
  const { json, direct, headers, ...rest } = opts;
  // Session 79 — follow the ACTIVE tenant, not the build-time default. This
  // header used to be hardcoded to Roadside's uuid for every user on every
  // request, which was invisible with one real tenant and became wrong the
  // moment the tenant switcher shipped: the JWT would say one tenant and the
  // header another, and which wins is decided per-endpoint. See
  // lib/active-tenant.ts.
  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    [TENANT_HEADER]: getActiveTenantId(),
    ...(headers as Record<string, string> | undefined),
  };

  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('access_token');
    if (token) {
      finalHeaders['Authorization'] = `Bearer ${token}`;
    }
  }
  if (json !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
  }
  const baseUrl = direct
    ? (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001')
    : '';
  const urlPath = direct
    ? (path.startsWith('/') ? path : `/${path}`)
    : (path.startsWith('/api') ? path : `/api${path}`);

  const res = await fetch(`${baseUrl}${urlPath}`, {
    ...rest,
    headers: finalHeaders,
    body: json !== undefined ? JSON.stringify(json) : (opts.body ?? undefined),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    try {
      const parsed = JSON.parse(text);
      if (parsed.code === 'VALIDATION_ERROR' && Array.isArray(parsed.errors)) {
        const errorList = parsed.errors.map((e) => `${e.path}: ${e.message}`).join(', ');
        throw new Error(errorList);
      }
      const msg = parsed.message || parsed.error;
      if (msg) {
        throw new Error(Array.isArray(msg) ? msg.join(', ') : String(msg));
      }
    } catch {
      // If it's not JSON or doesn't have a message, fall through
    }
    throw new Error(text || `HTTP ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

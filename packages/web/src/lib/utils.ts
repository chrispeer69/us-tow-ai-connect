import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;
  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    [TENANT_HEADER]: DEFAULT_TENANT_ID,
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
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: finalHeaders,
    body: json !== undefined ? JSON.stringify(json) : (init.body ?? undefined),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    try {
      const parsed = JSON.parse(text);
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

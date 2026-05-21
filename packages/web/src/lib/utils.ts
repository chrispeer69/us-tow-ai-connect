import { type ClassValue } from 'clsx';

/**
 * Lightweight clsx-style class merger; avoids pulling in `clsx` as a dep
 * for one-line usage across the dashboard.
 */
export function cn(...inputs: ClassValue[]): string {
  const flatten = (v: ClassValue): string => {
    if (!v) return '';
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (Array.isArray(v)) return v.map(flatten).filter(Boolean).join(' ');
    if (typeof v === 'object') {
      return Object.entries(v)
        .filter(([, on]) => Boolean(on))
        .map(([k]) => k)
        .join(' ');
    }
    return '';
  };
  return inputs.map(flatten).filter(Boolean).join(' ');
}

const TENANT_HEADER = 'x-tenant-id';
const DEFAULT_TENANT_ID = process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID || 'default-tenant';

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
  if (json !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
  }
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: finalHeaders,
    body: json !== undefined ? JSON.stringify(json) : (init.body ?? undefined),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

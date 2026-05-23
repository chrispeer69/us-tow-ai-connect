import { NextResponse } from 'next/server';

/**
 * BFF helper: forwards driver-app requests to the NestJS API with the
 * tenant API key attached server-side. The key lives in DRIVER_TENANT_API_KEY
 * env (preferred) or NEXT_PUBLIC_DEMO_TENANT_API_KEY (dev escape hatch); a
 * production deployment SHOULD have the real key in a non-public env var.
 *
 * Returning the upstream payload verbatim keeps the client's error contract
 * identical to the underlying API.
 */

function apiBase(): string {
  return process.env.NEXT_INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
}

function tenantApiKey(): string {
  return process.env.DRIVER_TENANT_API_KEY || process.env.NEXT_PUBLIC_DEMO_TENANT_API_KEY || '';
}

function buildHeaders(extra?: Record<string, string>): HeadersInit {
  const key = tenantApiKey();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(extra ?? {}),
  };
  if (key) headers['X-Tenant-API-Key'] = key;
  return headers;
}

export async function driverProxyGet(path: string): Promise<Response> {
  try {
    const upstream = await fetch(`${apiBase()}${path}`, {
      method: 'GET',
      headers: buildHeaders(),
      cache: 'no-store',
    });
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        code: 'UPSTREAM_FETCH_FAILED',
        message: (err as Error).message,
      },
      { status: 502 },
    );
  }
}

export async function driverProxyPost(path: string, body: unknown): Promise<Response> {
  try {
    const upstream = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      headers: buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        code: 'UPSTREAM_FETCH_FAILED',
        message: (err as Error).message,
      },
      { status: 502 },
    );
  }
}

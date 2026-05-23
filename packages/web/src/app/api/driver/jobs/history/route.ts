import { NextRequest, NextResponse } from 'next/server';
import { driverProxyGet } from '../../_lib/driver-proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get('driver_phone') ?? '';
  const days = req.nextUrl.searchParams.get('days') ?? '30';
  const limit = req.nextUrl.searchParams.get('limit') ?? '30';
  if (!phone) {
    return NextResponse.json(
      { status: 'error', code: 'MISSING_DRIVER_PHONE', message: 'driver_phone required' },
      { status: 400 },
    );
  }
  return driverProxyGet(
    `/v1/driver/jobs/history?driver_phone=${encodeURIComponent(phone)}&days=${days}&limit=${limit}`,
  );
}

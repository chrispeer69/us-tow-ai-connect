import { NextRequest, NextResponse } from 'next/server';
import { driverProxyGet } from '../../_lib/driver-proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get('driver_phone') ?? '';
  if (!phone) {
    return NextResponse.json(
      { status: 'error', code: 'MISSING_DRIVER_PHONE', message: 'driver_phone required' },
      { status: 400 },
    );
  }
  return driverProxyGet(`/v1/driver/jobs/queue?driver_phone=${encodeURIComponent(phone)}`);
}

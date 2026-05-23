import { NextRequest, NextResponse } from 'next/server';
import { driverProxyPost } from '../../../_lib/driver-proxy';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await ctx.params;
  const phone = req.nextUrl.searchParams.get('driver_phone') ?? '';
  if (!phone) {
    return NextResponse.json(
      { status: 'error', code: 'MISSING_DRIVER_PHONE', message: 'driver_phone required' },
      { status: 400 },
    );
  }
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* empty body OK */
  }
  return driverProxyPost(
    `/v1/driver/jobs/${encodeURIComponent(jobId)}/status?driver_phone=${encodeURIComponent(phone)}`,
    body,
  );
}

import { NextRequest } from 'next/server';
import { driverProxyPost } from '../_lib/driver-proxy';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* upstream will validate */
  }
  return driverProxyPost('/v1/driver-pings', body);
}

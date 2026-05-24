import { driverProxyGet } from '../../_lib/driver-proxy';

export const dynamic = 'force-dynamic';

export async function GET() {
  return driverProxyGet('/v1/driver-push/vapid-public-key');
}

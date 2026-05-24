import type { Metadata, Viewport } from 'next';
import { TrackingClient } from './tracking-client';

export const metadata: Metadata = {
  title: 'Live tow tracking',
  description: 'Track your tow live, in real time.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default async function TrackPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <TrackingClient token={token} />;
}

import type { Metadata } from 'next';
import LastWeekBoard from './LastWeekBoard';

export const metadata: Metadata = {
  title: 'Alpha Crash Leads — Last Week',
  robots: { index: false, follow: false },
};

export default function AlphaFlipsLastWeekPage() {
  return <LastWeekBoard />;
}

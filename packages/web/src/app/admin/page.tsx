'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { HOME_HREF } from '@/components/admin/nav-config';
import { useConsoleProfile } from '@/lib/use-console-profile';

/**
 * Where /admin lands.
 *
 * Was an unconditional server redirect to /admin/command-center. That is right
 * for a towing operator and wrong for US Tow Alliance, which tows nothing — it
 * opened on a dispatch board with no jobs, no drivers and no trucks, which
 * reads as a broken product rather than as a page that does not apply.
 *
 * The profile is only known in the browser (it depends on the active tenant's
 * token), so this is now a client redirect. `useConsoleProfile` returns 'full'
 * until the server says otherwise, so the towing path is unchanged and only a
 * tenant explicitly marked as outreach is sent somewhere else.
 */
export default function AdminIndexPage() {
  const router = useRouter();
  const profile = useConsoleProfile();

  useEffect(() => {
    router.replace(HOME_HREF[profile] ?? '/admin/command-center');
  }, [profile, router]);

  return null;
}

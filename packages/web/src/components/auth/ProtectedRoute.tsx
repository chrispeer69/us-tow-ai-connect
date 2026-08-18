'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Send an unauthenticated visitor to sign-in WITHOUT losing where they were
 * going. Reported 2026-08-18: a /m/flip link opened on a phone bounced to
 * sign-in and then dropped the user on the command center, so the link they
 * actually followed never opened.
 *
 * Only same-origin paths are ever passed through, so this cannot be used to
 * bounce someone to another site after login.
 */
function signInHref(pathname: string | null): string {
  if (!pathname || pathname === '/sign-in' || !pathname.startsWith('/')) return '/sign-in';
  if (pathname.startsWith('//')) return '/sign-in';
  return `/sign-in?redirect=${encodeURIComponent(pathname)}`;
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!token) {
      setIsReady(false);
      router.push(signInHref(pathname));
      return;
    }

    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(window.atob(base64));
      
      if (!payload.tenantId) {
        if (payload.platformRole === 'super_admin') {
          // Super admins without a tenant should go to the tenants list to impersonate
          if (!window.location.pathname.startsWith('/admin/tenants')) {
            setIsReady(false);
            router.push('/admin/tenants');
            return;
          }
        } else {
          // Normal users without a tenant go to onboarding
          setIsReady(false);
          router.push('/onboarding');
          return;
        }
      }
    } catch (e) {
      // If token parsing fails, force sign in
      setIsReady(false);
      router.push(signInHref(pathname));
      return;
    }

    setIsReady(true);
  }, [loading, token, router]);

  if (loading || !isReady) {
    return null; // Or a loading spinner
  }

  return <>{children}</>;
}

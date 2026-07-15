'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth();
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!token) {
      setIsReady(false);
      router.push('/sign-in');
      return;
    }

    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(window.atob(base64));
      
      if (!payload.tenantId && payload.platformRole !== 'super_admin') {
        setIsReady(false);
        router.push('/onboarding');
        return;
      }
    } catch (e) {
      // If token parsing fails, force sign in
      setIsReady(false);
      router.push('/sign-in');
      return;
    }

    setIsReady(true);
  }, [loading, token, router]);

  if (loading || !isReady) {
    return null; // Or a loading spinner
  }

  return <>{children}</>;
}

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
    } else {
      setIsReady(true);
    }
  }, [loading, token, router]);

  if (loading || !isReady) {
    return null; // Or a loading spinner
  }

  return <>{children}</>;
}

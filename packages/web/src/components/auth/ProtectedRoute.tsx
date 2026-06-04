'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!token) {
      router.push('/sign-in');
    } else {
      setIsReady(true);
    }
  }, [token, router]);

  if (!isReady) {
    return null; // Or a loading spinner
  }

  return <>{children}</>;
}

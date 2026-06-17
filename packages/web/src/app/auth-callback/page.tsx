'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<AuthCallbackLoading />}>
      <AuthCallbackContent />
    </Suspense>
  );
}

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setToken } = useAuth();

  useEffect(() => {
    // Support both query param (?token=) and hash fragment (#token=).
    // The hash fragment is preferred (more secure — never sent to servers),
    // but we keep query-param support for backward compatibility.
    let token = searchParams.get('token');
    if (!token && typeof window !== 'undefined') {
      const hash = window.location.hash; // e.g. "#token=eyJ..."
      if (hash.startsWith('#token=')) {
        token = hash.slice('#token='.length);
      }
    }

    if (token) {
      setToken(token);
      // Clear the hash so the JWT isn't sitting in the URL bar
      if (typeof window !== 'undefined' && window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      router.push('/admin/command-center');
    } else {
      router.push('/sign-in?error=missing_token');
    }
  }, [searchParams, router, setToken]);

  return (
    <AuthCallbackLoading />
  );
}

function AuthCallbackLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900">
      <div className="text-lg text-white animate-pulse">Authenticating...</div>
    </div>
  );
}

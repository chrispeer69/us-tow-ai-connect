'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { SSO_ID_TOKEN_KEY, SSO_PROVIDER_KEY } from '@/lib/sso-session';

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
    // SSO: the US Tow flow adds `sso=ustow` and the `id_token` to the fragment
    // so logout can end the SSO session too; `?next=` is where to land.
    let ssoProvider: string | null = null;
    let ssoIdToken: string | null = null;
    if (!token && typeof window !== 'undefined') {
      const hash = window.location.hash; // e.g. "#token=eyJ...&sso=ustow&id_token=eyJ..."
      if (hash.startsWith('#token=')) {
        const fragment = new URLSearchParams(hash.slice(1));
        token = fragment.get('token');
        ssoProvider = fragment.get('sso');
        ssoIdToken = fragment.get('id_token');
      }
    }

    if (token) {
      setToken(token);
      try {
        if (ssoProvider) {
          localStorage.setItem(SSO_PROVIDER_KEY, ssoProvider);
          if (ssoIdToken) localStorage.setItem(SSO_ID_TOKEN_KEY, ssoIdToken);
        } else {
          localStorage.removeItem(SSO_PROVIDER_KEY);
          localStorage.removeItem(SSO_ID_TOKEN_KEY);
        }
      } catch {
        // storage unavailable — logout simply skips the SSO end-session hop
      }
      // Clear the hash so the JWT isn't sitting in the URL bar
      if (typeof window !== 'undefined' && window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      const next = searchParams.get('next');
      router.push(next && next.startsWith('/') && !next.startsWith('//') ? next : '/admin/command-center');
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

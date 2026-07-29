'use client';
import React, { useEffect, useState } from 'react';

export function ImpersonationBanner() {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    setLabel(sessionStorage.getItem('impersonationBanner'));
  }, []);
  if (!label) return null;
  return (
    <div className="bg-red-600 text-white text-center text-sm px-4 py-2 sticky top-0 z-50 flex items-center justify-center gap-4">
      <span className="font-medium">⚠ {label}</span>
      <button
        className="underline hover:text-red-200 transition-colors"
        onClick={() => {
          const original = localStorage.getItem('original_access_token');
          if (original) {
            localStorage.setItem('access_token', original);
            localStorage.removeItem('original_access_token');
          }
          sessionStorage.removeItem('impersonationBanner');
          const returnUrl = sessionStorage.getItem('impersonationReturnUrl') || '/super-admin';
          sessionStorage.removeItem('impersonationReturnUrl');
          window.location.href = returnUrl;
        }}
      >
        Exit
      </button>
    </div>
  );
}

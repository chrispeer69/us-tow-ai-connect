'use client';
import React, { useEffect, useState } from 'react';

export function ImpersonationBanner() {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    setLabel(sessionStorage.getItem('impersonationBanner'));
  }, []);
  if (!label) return null;
  return (
    <div className="bg-red-600 text-white text-center text-sm px-4 py-2 sticky top-0 z-50">
      ⚠ {label} —{' '}
      <button
        className="underline"
        onClick={() => {
          sessionStorage.removeItem('impersonationBanner');
          sessionStorage.removeItem('impersonationToken');
          window.location.reload();
        }}
      >
        Exit
      </button>
    </div>
  );
}

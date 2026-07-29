import React from 'react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <div className="dark flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
        <header className="border-b border-zinc-800 bg-zinc-900/50 px-6 py-4">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold tracking-tight text-white">Platform Monitor</h1>
            <span className="rounded bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-400 border border-rose-500/20">
              Super Admin Access
            </span>
          </div>
        </header>
        <main className="flex-1 p-6 sm:p-8">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}

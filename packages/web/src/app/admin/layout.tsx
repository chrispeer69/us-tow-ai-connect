import React from 'react';
import { BrandingProvider } from '@/components/branding/BrandingProvider';
import { ImpersonationBanner } from '@/components/branding/ImpersonationBanner';
import { Sidebar } from '@/components/admin/Sidebar';
import { TopBar } from '@/components/admin/TopBar';
import { UtilityBar } from '@/components/admin/UtilityBar';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

const DEFAULT_TENANT_ID =
  process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID ||
  '00000000-0000-0000-0000-000000000001';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <BrandingProvider tenantId={DEFAULT_TENANT_ID} source="admin">
      <div className="admin-shell flex min-h-screen flex-col bg-[var(--surface-bg)] text-[var(--text-main)]">
        <ImpersonationBanner />
        <TopBar />
        <UtilityBar />
        <div className="mx-auto flex w-full max-w-container flex-1">
          <Sidebar />
          <main className="min-w-0 flex-1 px-5 py-8 sm:px-8">{children}</main>
        </div>
      </div>
    </BrandingProvider>
    </ProtectedRoute>
  );
}

import React from 'react';
import Link from 'next/link';
import { BrandingProvider } from '@/components/branding/BrandingProvider';

const DEFAULT_TENANT_ID =
  process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID ||
  '00000000-0000-0000-0000-000000000001';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <BrandingProvider tenantId={DEFAULT_TENANT_ID} source="admin">
      <div className="flex min-h-screen bg-zinc-950 text-zinc-50">
        {/* Sidebar */}
        <aside className="w-64 border-r border-zinc-800 bg-zinc-900 p-6 flex flex-col gap-6">
          <div>
            <h2
              className="text-xl font-bold tracking-tight"
              style={{ color: 'var(--brand-primary)' }}
            >
              US Tow AI-Connect
            </h2>
            <p className="text-xs text-zinc-500">Admin Dashboard</p>
          </div>
          <nav className="flex flex-col gap-2 flex-grow">
            <Link href="/admin/integrations" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition">Integrations</Link>
            <Link href="/admin/command-center" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition">Command Center</Link>
            <Link href="/admin/digital-dispatch" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition">Digital Dispatch</Link>
            <Link href="/admin/routing" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition">Routing</Link>
            <Link href="/admin/calls" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition">Calls</Link>
            <Link href="/admin/ai-agent" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition">AI Agent</Link>
            <Link href="/admin/knowledge-pack" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition">Knowledge Pack</Link>
            <Link href="/admin/branding" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition">Branding</Link>
            <Link href="/admin/company" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition">Company</Link>
            <Link href="/admin/members" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition">Members</Link>
            <Link href="/admin/api-keys" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition">API Keys</Link>
            <Link href="/admin/billing" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition">Billing</Link>
            <Link href="/admin/audit-log" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition">Audit Log</Link>
            <Link href="/admin/digest" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition">Digest</Link>
            <Link href="/admin/tenants" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition text-zinc-500">Super Admin → Tenants</Link>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-10 overflow-y-auto">{children}</main>
      </div>
    </BrandingProvider>
  );
}

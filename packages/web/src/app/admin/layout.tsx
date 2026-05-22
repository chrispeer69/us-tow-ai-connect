import React from 'react';
import Link from 'next/link';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-50">
      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-800 bg-zinc-900 p-6 flex flex-col gap-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-blue-500">US Tow AI-Connect</h2>
          <p className="text-xs text-zinc-500">Admin Dashboard</p>
        </div>
        <nav className="flex flex-col gap-2 flex-grow">
          <Link href="/admin/integrations" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition">Integrations</Link>
          <Link href="/admin/routing" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition">Routing</Link>
          <Link href="/admin/calls" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition">Calls</Link>
          <Link href="/admin/ai-agent" className="hover:bg-zinc-800 px-3 py-2 rounded text-sm transition">AI Agent</Link>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-10 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

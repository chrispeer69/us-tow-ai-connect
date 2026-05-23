'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    title: 'Operations',
    items: [
      { href: '/admin/command-center', label: 'Command Center' },
      { href: '/admin/digital-dispatch', label: 'Digital Dispatch' },
      { href: '/admin/drivers-live', label: 'Drivers Live' },
      { href: '/admin/calls', label: 'Calls' },
      { href: '/admin/sms-log', label: 'SMS Log' },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { href: '/admin/integrations', label: 'Integrations' },
      { href: '/admin/routing', label: 'Routing' },
      { href: '/admin/ai-agent', label: 'AI Agent' },
      { href: '/admin/knowledge-pack', label: 'Knowledge Pack' },
      { href: '/admin/branding', label: 'Branding' },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/admin/company', label: 'Company' },
      { href: '/admin/members', label: 'Members' },
      { href: '/admin/api-keys', label: 'API Keys' },
      { href: '/admin/billing', label: 'Billing' },
      { href: '/admin/audit-log', label: 'Audit Log' },
      { href: '/admin/digest', label: 'Digest' },
    ],
  },
  {
    title: 'Platform',
    items: [{ href: '/admin/tenants', label: 'Tenants' }],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-64 shrink-0 border-r border-[var(--border-color)] bg-[var(--surface-card)] lg:block">
      <nav className="sticky top-[70px] flex max-h-[calc(100vh-70px)] flex-col gap-6 overflow-y-auto p-5">
        {GROUPS.map((group) => (
          <div key={group.title} className="flex flex-col gap-1">
            <div className="px-3 pb-1 font-label text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {group.title}
            </div>
            {group.items.map((item) => {
              const active =
                pathname === item.href || pathname?.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'rounded-[10px] px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-[var(--surface)] text-[var(--alliance-blue)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--surface-low)] hover:text-[var(--text-main)]',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

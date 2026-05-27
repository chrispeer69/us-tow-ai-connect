import type { IconName } from '@/components/ui/icons';

/**
 * Single source of truth for admin navigation (Session 47). Consumed by both
 * the desktop Sidebar and the mobile drawer (AdminMobileNav) so the two never
 * drift. Breadcrumbs also resolve segment labels from here.
 *
 * Group taxonomy (S47): Operations / Communications / Configuration / Account
 * / Super Admin — matches the spec. `calls` moved Operations→Communications;
 * `sms-log` + `digest` moved Account→Communications (logged in S47_DECISIONS).
 */
export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Operations',
    items: [
      { href: '/admin/command-center', label: 'Command Center', icon: 'command-center' },
      { href: '/admin/digital-dispatch', label: 'Digital Dispatch', icon: 'digital-dispatch' },
      { href: '/admin/drivers-live', label: 'Drivers Live', icon: 'drivers-live' },
    ],
  },
  {
    title: 'Communications',
    items: [
      { href: '/admin/calls', label: 'Calls', icon: 'calls' },
      { href: '/admin/sms-log', label: 'SMS Log', icon: 'sms-log' },
      { href: '/admin/outbound-voice', label: 'Outbound Voice', icon: 'outbound-voice' },
      { href: '/admin/digest', label: 'Digest', icon: 'digest' },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { href: '/admin/integrations', label: 'Integrations', icon: 'integrations' },
      { href: '/admin/routing', label: 'Routing', icon: 'routing' },
      { href: '/admin/ai-agent', label: 'AI Agent', icon: 'ai-agent' },
      { href: '/admin/knowledge-pack', label: 'Knowledge Pack', icon: 'knowledge-pack' },
      { href: '/admin/branding', label: 'Branding', icon: 'branding' },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/admin/company', label: 'Company', icon: 'company' },
      { href: '/admin/members', label: 'Members', icon: 'members' },
      { href: '/admin/api-keys', label: 'API Keys', icon: 'api-keys' },
      { href: '/admin/billing', label: 'Billing', icon: 'billing' },
      { href: '/admin/audit-log', label: 'Audit Log', icon: 'audit-log' },
    ],
  },
  {
    title: 'Super Admin',
    items: [{ href: '/admin/tenants', label: 'Tenants', icon: 'tenants' }],
  },
];

/** Flat href→label lookup for breadcrumb resolution. */
export const NAV_LABELS: Record<string, string> = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.href, i.label])),
);

/** Resolve the active item for a pathname (exact or nested route). */
export function isActiveHref(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(href + '/');
}

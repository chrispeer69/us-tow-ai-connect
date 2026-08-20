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
      { href: '/admin/flip-engine', label: 'Flip Engine', icon: 'flip-engine' },
      { href: '/admin/reports', label: 'Reports', icon: 'reports' },
    ],
  },
  {
    title: 'Communications',
    items: [
      { href: '/admin/calls', label: 'Calls', icon: 'calls' },
      { href: '/admin/sms-log', label: 'SMS Log', icon: 'sms-log' },
      { href: '/admin/outbound-voice', label: 'Outbound Voice', icon: 'outbound-voice' },
      // Outreach campaigns (S78). Under Communications, not Operations: these
      // are not tow jobs and must not read as part of the dispatch flow.
      { href: '/admin/campaigns', label: 'Campaigns', icon: 'outbound-voice' },
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
      { href: '/admin/support', label: 'Support', icon: 'support' as IconName },
    ],
  },
  {
    title: 'Super Admin',
    items: [
      { href: '/super-admin', label: 'Platform Monitor', icon: 'tenants' },
      { href: '/super-admin/flip-defaults', label: 'Global Flip Defaults', icon: 'flip-engine' },
      { href: '/super-admin/diagnostics', label: 'Diagnostics Hub', icon: 'support' as IconName },
    ],
  },
];

/**
 * Which console a tenant sees.
 *
 * Session 79. `NAV_GROUPS` is a single static array, so every tenant got the
 * towing console — including US Tow Alliance, which tows nothing. It runs a
 * calling campaign, and Command Center, Digital Dispatch, Drivers Live and Flip
 * Engine are all empty for it. Landing on a dispatch board with no jobs reads
 * as broken rather than as not-applicable.
 *
 * `NAV_GROUPS` IS DELIBERATELY LEFT UNTOUCHED. The demo page, the sidebar and
 * the mobile drawer all consume it, and the safe way to add a second console to
 * a live product is to add a filter beside the array rather than reshape the
 * array everyone already depends on.
 */
export type ConsoleProfile = 'full' | 'campaign';

/**
 * Routes a campaign tenant has no use for. Everything NOT listed here stays,
 * so a page added later shows up by default and nobody has to remember to
 * allow-list it — the failure mode is a harmless extra link, not a missing one.
 */
const HIDDEN_FOR_CAMPAIGN = new Set([
  '/admin/command-center',   // a dispatch board with no jobs
  '/admin/digital-dispatch',
  '/admin/drivers-live',
  '/admin/flip-engine',
  '/admin/outbound-voice',   // the TOW dialler, not this campaign
  '/admin/routing',
  '/admin/knowledge-pack',
  '/admin/sms-log',
]);

/** Where a profile lands when it opens the console. */
export const HOME_HREF: Record<ConsoleProfile, string> = {
  full: '/admin/command-center',
  campaign: '/admin/campaigns',
};

/**
 * The nav for a profile.
 *
 * `full` returns NAV_GROUPS by reference — identical to before this existed,
 * which is what makes shipping it against a live Command Center safe.
 */
export function navGroupsForProfile(profile: ConsoleProfile): NavGroup[] {
  if (profile !== 'campaign') return NAV_GROUPS;

  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !HIDDEN_FOR_CAMPAIGN.has(item.href)),
  })).filter((group) => group.items.length > 0);
}

/** Flat href→label lookup for breadcrumb resolution. */
export const NAV_LABELS: Record<string, string> = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.href, i.label])),
);

/** Resolve the active item for a pathname (exact or nested route). */
export function isActiveHref(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(href + '/');
}

import * as React from 'react';

/**
 * Lightweight inline-SVG icon set (Session 47).
 *
 * `lucide-react` is not a dependency and the OWNED_PATHS forbid adding one
 * for this sweep, so these are hand-rolled 24×24 stroke icons in the same
 * visual language (1.75 stroke, round caps/joins, currentColor). Add an
 * entry to PATHS to register a new icon; consume via <Icon name="…" />.
 */
export type IconName =
  | 'command-center'
  | 'digital-dispatch'
  | 'drivers-live'
  | 'calls'
  | 'sms-log'
  | 'outbound-voice'
  | 'flip-engine'
  | 'digest'
  | 'integrations'
  | 'routing'
  | 'ai-agent'
  | 'knowledge-pack'
  | 'branding'
  | 'company'
  | 'members'
  | 'api-keys'
  | 'billing'
  | 'audit-log'
  | 'tenants'
  | 'menu'
  | 'close'
  | 'search'
  | 'bell'
  | 'chevron-right'
  | 'chevron-down'
  | 'reports'
  | 'support';

// Path data drawn in a 24×24 box. Each entry is one or more <path d> strings.
const PATHS: Record<IconName, string[]> = {
  'command-center': ['M3 12h4l2 5 4-14 2 9h6'],
  'digital-dispatch': ['M4 7h16M4 12h10M4 17h7', 'M17 15l3 2-3 2'],
  'drivers-live': ['M5 17h2m10 0h2', 'M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm10 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z', 'M3 17v-4l2-5h9l4 4h3v5'],
  calls: ['M5 4h3l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z'],
  'sms-log': ['M4 5h16v10H9l-5 4V5Z', 'M8 9h8M8 12h5'],
  // Phone handset with outbound radio waves on the right.
  'outbound-voice': [
    'M5 4h3l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z',
    'M16 4a5 5 0 0 1 4 4',
    'M16 8a2 2 0 0 1 2 2',
  ],
  // Two arrows curving in opposite directions = redirect / flip.
  'flip-engine': [
    'M4 9a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5',
    'M20 15a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5',
    'M5 6L4 9l3-1',
    'M19 18l1-3-3 1',
  ],
  digest: ['M5 4h11l3 3v13H5z', 'M9 9h6M9 13h6M9 17h4'],
  integrations: ['M9 7V4h6v3', 'M5 7h14v4a7 7 0 0 1-14 0z', 'M12 18v2'],
  routing: ['M6 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm12 12a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z', 'M6 8v4a4 4 0 0 0 4 4h6'],
  'ai-agent': ['M12 3v3', 'M7 6h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z', 'M9 11h.01M15 11h.01M9 15h6'],
  'knowledge-pack': ['M5 4h9a3 3 0 0 1 3 3v13l-6-3-6 3V4Z', 'M9 8h5'],
  branding: ['M12 3l2.5 5 5.5.8-4 4 1 5.6L12 21l-5-2.9 1-5.6-4-4 5.5-.8z'],
  company: ['M4 21V6l8-3v18M12 21h8V9l-8-3', 'M8 9h.01M8 13h.01M16 12h.01M16 16h.01'],
  members: ['M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M3 20a6 6 0 0 1 12 0', 'M16 5a3 3 0 0 1 0 6m1 8a6 6 0 0 0-3-5'],
  'api-keys': [
    'm15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4',
    'm21 2-9.6 9.6',
    'M13 15.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z'
  ],
  billing: ['M3 7h18v10H3z', 'M3 11h18', 'M7 15h3'],
  'audit-log': ['M6 3h9l4 4v14H6z', 'M10 12l2 2 4-4', 'M9 7h3'],
  tenants: ['M3 21V8l6-4 6 4', 'M9 21V12h6v9', 'M15 21h6V11l-6-3', 'M18 14h.01M18 17h.01'],
  menu: ['M4 6h16M4 12h16M4 18h16'],
  close: ['M6 6l12 12M18 6 6 18'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z', 'M20 20l-3.5-3.5'],
  bell: ['M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z', 'M10 19a2 2 0 0 0 4 0'],
  'chevron-right': ['M9 6l6 6-6 6'],
  'chevron-down': ['M6 9l6 6 6-6'],
  reports: ['M18 20V10', 'M12 20V4', 'M6 20v-6'],
  support: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'],
};

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, className, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...rest}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

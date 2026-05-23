import type { UnifiedJobStatus } from './types';

const TABLE: Array<[RegExp, UnifiedJobStatus]> = [
  [/(complete|closed|done|finished)/i, 'completed'],
  [/(cancel|gone on arrival|GOA|no show)/i, 'canceled'],
  [/(declin|reject)/i, 'declined'],
  [/(in tow|towing)/i, 'in_tow'],
  [/(on[\s_-]?scene|arrived)/i, 'on_scene'],
  [/(en[\s_-]?route|enroute|on the way|otw|dispatched out)/i, 'en_route'],
  [/(assigned|accepted|claim|dispatched)/i, 'assigned'],
  [/(new|pending|in[\s_-]?progress|waiting|received)/i, 'new'],
];

export function mapAdapterStatus(raw: string | null | undefined): UnifiedJobStatus {
  if (!raw) return 'new';
  for (const [pattern, status] of TABLE) {
    if (pattern.test(raw)) return status;
  }
  return 'new';
}

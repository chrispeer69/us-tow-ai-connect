import { JSONPath } from 'jsonpath-plus';
import type { UnifiedJobRow } from '../../db/schema';

export type ConditionType =
  | 'distance_max_miles'
  | 'time_of_day'
  | 'day_of_week'
  | 'service_type_in'
  | 'estimated_payout_min'
  | 'driver_available_count_min'
  | 'job_age_minutes_max'
  | 'caller_phone_blacklist'
  | 'custom_jsonpath';

export interface DistanceCondition {
  type: 'distance_max_miles';
  miles: number;
}
export interface TimeOfDayCondition {
  type: 'time_of_day';
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}
export interface DayOfWeekCondition {
  type: 'day_of_week';
  days: number[]; // 0=Sun ... 6=Sat
}
export interface ServiceTypeInCondition {
  type: 'service_type_in';
  values: string[];
}
export interface EstimatedPayoutMinCondition {
  type: 'estimated_payout_min';
  amount: number;
}
export interface DriverAvailableCountMinCondition {
  type: 'driver_available_count_min';
  count: number;
}
export interface JobAgeMinutesMaxCondition {
  type: 'job_age_minutes_max';
  minutes: number;
}
export interface CallerPhoneBlacklistCondition {
  type: 'caller_phone_blacklist';
  phones: string[];
}
export interface CustomJsonpathCondition {
  type: 'custom_jsonpath';
  expression: string;
}

export type Condition =
  | DistanceCondition
  | TimeOfDayCondition
  | DayOfWeekCondition
  | ServiceTypeInCondition
  | EstimatedPayoutMinCondition
  | DriverAvailableCountMinCondition
  | JobAgeMinutesMaxCondition
  | CallerPhoneBlacklistCondition
  | CustomJsonpathCondition;

export interface EvaluationContext {
  job: UnifiedJobRow;
  tenantTimezone: string;
  drivers: Array<{
    id: string;
    status: string;
    currentLat: string | null;
    currentLng: string | null;
    lastPingAt: Date | null;
  }>;
  now: Date;
}

export interface ConditionResult {
  type: ConditionType;
  matched: boolean;
  reason: string;
  details?: Record<string, unknown>;
}

const DRIVER_PING_STALE_MIN = 30;

export function evaluateCondition(c: Condition, ctx: EvaluationContext): ConditionResult {
  switch (c.type) {
    case 'distance_max_miles':
      return evalDistance(c, ctx);
    case 'time_of_day':
      return evalTimeOfDay(c, ctx);
    case 'day_of_week':
      return evalDayOfWeek(c, ctx);
    case 'service_type_in':
      return evalServiceTypeIn(c, ctx);
    case 'estimated_payout_min':
      return evalEstimatedPayoutMin(c, ctx);
    case 'driver_available_count_min':
      return evalDriverAvailableCountMin(c, ctx);
    case 'job_age_minutes_max':
      return evalJobAgeMinutesMax(c, ctx);
    case 'caller_phone_blacklist':
      return evalCallerPhoneBlacklist(c, ctx);
    case 'custom_jsonpath':
      return evalCustomJsonpath(c, ctx);
    default: {
      const exhaustive: never = c;
      return {
        type: (exhaustive as { type: ConditionType }).type,
        matched: false,
        reason: 'unknown condition type',
      };
    }
  }
}

export function evaluateAll(
  conditions: Condition[],
  ctx: EvaluationContext,
): { matched: boolean; results: ConditionResult[] } {
  const results = conditions.map((c) => evaluateCondition(c, ctx));
  return { matched: results.every((r) => r.matched), results };
}

// ------------ implementations ------------

function evalDistance(c: DistanceCondition, ctx: EvaluationContext): ConditionResult {
  const jobLat = numOrNull(ctx.job.pickupLat);
  const jobLng = numOrNull(ctx.job.pickupLng);
  if (jobLat === null || jobLng === null) {
    return {
      type: c.type,
      matched: false,
      reason: 'job pickup not geocoded',
    };
  }
  const recent = ctx.drivers
    .map((d) => {
      const lat = numOrNull(d.currentLat);
      const lng = numOrNull(d.currentLng);
      if (lat === null || lng === null) return null;
      if (!isRecentPing(d.lastPingAt, ctx.now)) return null;
      return { id: d.id, lat, lng, dist: haversineMiles(jobLat, jobLng, lat, lng) };
    })
    .filter((x): x is { id: string; lat: number; lng: number; dist: number } => x !== null);
  if (recent.length === 0) {
    return { type: c.type, matched: false, reason: 'no driver with recent location ping' };
  }
  const closest = recent.reduce((a, b) => (a.dist < b.dist ? a : b));
  const matched = closest.dist <= c.miles;
  return {
    type: c.type,
    matched,
    reason: matched
      ? `closest driver ${closest.dist.toFixed(2)}mi <= ${c.miles}mi`
      : `closest driver ${closest.dist.toFixed(2)}mi > ${c.miles}mi`,
    details: { closestDriverId: closest.id, miles: closest.dist },
  };
}

function evalTimeOfDay(c: TimeOfDayCondition, ctx: EvaluationContext): ConditionResult {
  const local = formatHHMM(ctx.now, ctx.tenantTimezone);
  const matched = isWithinHHMM(local, c.start, c.end);
  return {
    type: c.type,
    matched,
    reason: matched ? `${local} within ${c.start}-${c.end}` : `${local} outside ${c.start}-${c.end}`,
    details: { localTime: local, tenantTimezone: ctx.tenantTimezone },
  };
}

function evalDayOfWeek(c: DayOfWeekCondition, ctx: EvaluationContext): ConditionResult {
  const dow = getDow(ctx.now, ctx.tenantTimezone);
  const matched = c.days.includes(dow);
  return {
    type: c.type,
    matched,
    reason: matched ? `day ${dow} in ${JSON.stringify(c.days)}` : `day ${dow} not in ${JSON.stringify(c.days)}`,
    details: { dow },
  };
}

function evalServiceTypeIn(c: ServiceTypeInCondition, ctx: EvaluationContext): ConditionResult {
  const value = (ctx.job.serviceType ?? '').toLowerCase();
  const set = new Set(c.values.map((v) => v.toLowerCase()));
  const matched = set.has(value);
  return {
    type: c.type,
    matched,
    reason: matched ? `service_type "${value}" allowed` : `service_type "${value || '<empty>'}" not in list`,
  };
}

function evalEstimatedPayoutMin(c: EstimatedPayoutMinCondition, ctx: EvaluationContext): ConditionResult {
  const payload = (ctx.job.sourcePayload ?? {}) as Record<string, unknown>;
  const raw =
    pickNumber(payload, 'estimated_payout') ??
    pickNumber(payload, 'payout') ??
    pickNumber(payload, 'amount');
  if (raw === null) {
    return { type: c.type, matched: false, reason: 'no payout field in source_payload' };
  }
  const matched = raw >= c.amount;
  return {
    type: c.type,
    matched,
    reason: matched ? `payout ${raw} >= ${c.amount}` : `payout ${raw} < ${c.amount}`,
    details: { payout: raw },
  };
}

function evalDriverAvailableCountMin(
  c: DriverAvailableCountMinCondition,
  ctx: EvaluationContext,
): ConditionResult {
  const count = ctx.drivers.filter((d) => d.status === 'available').length;
  const matched = count >= c.count;
  return {
    type: c.type,
    matched,
    reason: matched ? `${count} drivers available >= ${c.count}` : `${count} drivers available < ${c.count}`,
    details: { available: count },
  };
}

function evalJobAgeMinutesMax(c: JobAgeMinutesMaxCondition, ctx: EvaluationContext): ConditionResult {
  const ageMs = ctx.now.getTime() - new Date(ctx.job.createdAt).getTime();
  const ageMin = ageMs / 60000;
  const matched = ageMin <= c.minutes;
  return {
    type: c.type,
    matched,
    reason: matched ? `job ${ageMin.toFixed(1)}min old <= ${c.minutes}` : `job ${ageMin.toFixed(1)}min old > ${c.minutes}`,
    details: { ageMinutes: ageMin },
  };
}

function evalCallerPhoneBlacklist(
  c: CallerPhoneBlacklistCondition,
  ctx: EvaluationContext,
): ConditionResult {
  const phone = (ctx.job.callerPhone ?? '').replace(/\D/g, '');
  if (!phone) {
    return { type: c.type, matched: true, reason: 'no caller phone — not on blacklist' };
  }
  const set = new Set(c.phones.map((p) => p.replace(/\D/g, '')).filter(Boolean));
  const blacklisted = set.has(phone);
  return {
    type: c.type,
    matched: !blacklisted,
    reason: blacklisted ? `phone ${phone} is blacklisted` : `phone ${phone} not blacklisted`,
  };
}

function evalCustomJsonpath(c: CustomJsonpathCondition, ctx: EvaluationContext): ConditionResult {
  try {
    const result = JSONPath({ path: c.expression, json: ctx.job.sourcePayload as unknown as object });
    const matched = Array.isArray(result) ? result.length > 0 && truthy(result[0]) : truthy(result);
    return {
      type: c.type,
      matched,
      reason: matched ? `jsonpath returned truthy` : `jsonpath returned empty/falsy`,
      details: { expression: c.expression },
    };
  } catch (err) {
    return {
      type: c.type,
      matched: false,
      reason: `jsonpath error: ${(err as Error).message}`,
      details: { expression: c.expression },
    };
  }
}

// ------------ helpers ------------

function numOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function truthy(v: unknown): boolean {
  if (v === false || v === null || v === undefined) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return !!v;
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.7613; // miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isRecentPing(last: Date | null, now: Date): boolean {
  if (!last) return false;
  const age = (now.getTime() - new Date(last).getTime()) / 60000;
  return age <= DRIVER_PING_STALE_MIN;
}

function formatHHMM(d: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h.padStart(2, '0')}:${m}`;
}

function getDow(d: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
  const wd = fmt.format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
}

function isWithinHHMM(local: string, start: string, end: string): boolean {
  const l = toMin(local);
  const s = toMin(start);
  const e = toMin(end);
  if (s <= e) return l >= s && l <= e;
  // window crosses midnight
  return l >= s || l <= e;
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => Number(n));
  return (h || 0) * 60 + (m || 0);
}

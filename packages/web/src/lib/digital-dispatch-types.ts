export type RuleAction = 'accept' | 'decline' | 'flag';

export type Condition =
  | { type: 'distance_max_miles'; miles: number }
  | { type: 'time_of_day'; start: string; end: string }
  | { type: 'day_of_week'; days: number[] }
  | { type: 'service_type_in'; values: string[] }
  | { type: 'estimated_payout_min'; amount: number }
  | { type: 'driver_available_count_min'; count: number }
  | { type: 'job_age_minutes_max'; minutes: number }
  | { type: 'caller_phone_blacklist'; phones: string[] }
  | { type: 'custom_jsonpath'; expression: string };

export type ConditionType = Condition['type'];

export interface Rule {
  id: string;
  tenantId: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: Condition[];
  action: RuleAction;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionRow {
  decision: {
    id: string;
    jobId: string;
    ruleId: string | null;
    decision: 'accepted' | 'declined' | 'flagged' | 'manual';
    reason: string | null;
    evaluatedConditions: Array<{
      ruleId: string;
      ruleName: string;
      matched: boolean;
      results: Array<{ type: string; matched: boolean; reason: string }>;
    }>;
    decidedAt: string;
    decidedBy: 'ai' | 'human';
  };
  job: {
    id: string;
    source: string;
    sourceJobId: string;
    callerName: string | null;
    pickupAddress: string | null;
  };
}

export interface Stats {
  totals: { total: number; accepted: number; declined: number; flagged: number };
  acceptRate: number;
  byDecision: { decision: string; count: number }[];
  daily: { day: string; decision: string; count: number }[];
  topDeclineReasons: { reason: string | null; count: number }[];
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const CONDITION_LABEL: Record<ConditionType, string> = {
  distance_max_miles: 'Distance ≤',
  time_of_day: 'Time of day',
  day_of_week: 'Day of week',
  service_type_in: 'Service type in',
  estimated_payout_min: 'Payout ≥',
  driver_available_count_min: 'Available drivers ≥',
  job_age_minutes_max: 'Job age ≤',
  caller_phone_blacklist: 'Caller phone not in blacklist',
  custom_jsonpath: 'Custom JSONPath',
};

export function describeCondition(c: Condition): string {
  switch (c.type) {
    case 'distance_max_miles':
      return `Distance ≤ ${c.miles} mi`;
    case 'time_of_day':
      return `Time ${c.start}–${c.end}`;
    case 'day_of_week':
      return `Days: ${c.days.map((d) => DAY_LABELS[d]).join(', ')}`;
    case 'service_type_in':
      return `Service in [${c.values.join(', ')}]`;
    case 'estimated_payout_min':
      return `Payout ≥ $${c.amount}`;
    case 'driver_available_count_min':
      return `Available drivers ≥ ${c.count}`;
    case 'job_age_minutes_max':
      return `Job age ≤ ${c.minutes}m`;
    case 'caller_phone_blacklist':
      return `Phone NOT in [${c.phones.join(', ')}]`;
    case 'custom_jsonpath':
      return `JSONPath: ${c.expression}`;
  }
}

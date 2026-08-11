/**
 * Session 73 — the shape the daily analyst returns.
 *
 * This is enforced by the Messages API via `output_config.format` (structured
 * outputs), so the model cannot hand back prose we then have to parse. Keep
 * ANALYSIS_SCHEMA and the TypeScript types below in sync.
 */

export interface ObjectionBucket {
  /** Short label, e.g. "already told the shop we're coming". */
  label: string;
  count: number;
  /** Which rung it killed: offer_1 | offer_2 | offer_3 | before_pitch. */
  stage: string;
  /** Verbatim customer lines, so a human can sanity-check the bucket. */
  quotes: string[];
}

export interface DefectFinding {
  /** Machine slug, e.g. "agent_never_pitched", "issue_type_unknown". */
  code: string;
  summary: string;
  affectedCallIds: string[];
  /** Why this is a defect (something that should work) and not a copy problem. */
  evidence: string;
}

export interface Recommendation {
  target: string;
  title: string;
  problem: string;
  proposedText?: string | null;
  currentText?: string | null;
  rationale: string;
  evidence: Array<{ callId: string; quote: string }>;
  kind: 'WORDING' | 'DEFECT' | 'TARGETING' | 'DATA_QUALITY';
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  expectedLift?: string | null;
  scenario?: string | null;
}

export interface DailyAnalysis {
  summary: string;
  objections: ObjectionBucket[];
  defects: DefectFinding[];
  recommendations: Recommendation[];
}

/**
 * JSON Schema handed to `output_config.format`. Structured outputs reject
 * several JSON Schema keywords (numeric/length constraints, recursion), so this
 * stays deliberately plain: objects with `additionalProperties: false`, every
 * property required, enums where the value set is closed.
 */
export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description:
        'Two to four sentences a busy operator can read: what changed yesterday and the single most important thing to act on.',
    },
    objections: {
      type: 'array',
      description:
        'Customer objections grouped by what they actually said, most frequent first.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          count: { type: 'integer' },
          stage: {
            type: 'string',
            enum: ['before_pitch', 'offer_1', 'offer_2', 'offer_3', 'convini'],
          },
          quotes: { type: 'array', items: { type: 'string' } },
        },
        required: ['label', 'count', 'stage', 'quotes'],
        additionalProperties: false,
      },
    },
    defects: {
      type: 'array',
      description:
        'Things that are supposed to work and did not — the agent skipping a scripted step, a variable rendering blank, a call dying in the opening. NOT copy opinions.',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          summary: { type: 'string' },
          affectedCallIds: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'string' },
        },
        required: ['code', 'summary', 'affectedCallIds', 'evidence'],
        additionalProperties: false,
      },
    },
    recommendations: {
      type: 'array',
      description:
        'Concrete, testable changes. Ranked by expected value. Empty array is a valid and correct answer on a quiet day.',
      items: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description:
              'Which part of the call: opening, confirm_details, offer_1, offer_2, offer_3, convini, close, targeting, or data_quality.',
          },
          title: { type: 'string' },
          problem: { type: 'string' },
          proposedText: {
            type: ['string', 'null'],
            description:
              'The exact replacement wording, when the change is a wording change. Null for defects and targeting changes.',
          },
          currentText: {
            type: ['string', 'null'],
            description: 'The current wording being replaced, quoted from the script provided.',
          },
          rationale: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                callId: { type: 'string' },
                quote: { type: 'string' },
              },
              required: ['callId', 'quote'],
              additionalProperties: false,
            },
          },
          kind: {
            type: 'string',
            enum: ['WORDING', 'DEFECT', 'TARGETING', 'DATA_QUALITY'],
          },
          confidence: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          expectedLift: { type: ['string', 'null'] },
          scenario: { type: ['string', 'null'] },
        },
        required: [
          'target',
          'title',
          'problem',
          'proposedText',
          'currentText',
          'rationale',
          'evidence',
          'kind',
          'confidence',
          'expectedLift',
          'scenario',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'objections', 'defects', 'recommendations'],
  additionalProperties: false,
} as const;

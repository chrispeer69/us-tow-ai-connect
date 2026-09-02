/**
 * The daily-analyst schema for Alpha's crash-lead outbound caller ("Maya").
 *
 * Mirrors call-review.types.ts's shape (summary/objections/defects/
 * recommendations) but with its own stage/target vocabulary — this caller has
 * no offer ladder, no CONVINI pitch, no flip. It calls someone from a public
 * crash report to ask whether the vehicle still needs collision repair, and
 * either books/soft-books an estimate or logs why not. Kept as a SEPARATE
 * schema rather than widening call-review.types.ts's enums, so this pipeline
 * can evolve without touching the one already running in production.
 */

export interface AlphaObjectionBucket {
  /** Short label, e.g. "already has an attorney". */
  label: string;
  count: number;
  /** Where in the call it came up. */
  stage: string;
  /** Verbatim customer lines, so a human can sanity-check the bucket. */
  quotes: string[];
}

export interface AlphaDefectFinding {
  /** Machine slug, e.g. "call_dropped_mid_pitch". */
  code: string;
  summary: string;
  affectedCallIds: string[];
  /** Why this is a defect (something that should work) and not a copy problem. */
  evidence: string;
}

export interface AlphaRecommendation {
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
}

export interface AlphaDailyAnalysis {
  summary: string;
  objections: AlphaObjectionBucket[];
  defects: AlphaDefectFinding[];
  recommendations: AlphaRecommendation[];
}

export const ALPHA_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description:
        'Two to four sentences a busy operator can read: what happened in the last 24 hours and the single most important thing to act on. If the lead feed produced zero calls, say so plainly as the headline — do not analyze zero calls as if it were a quiet-but-normal day.',
    },
    objections: {
      type: 'array',
      description:
        'Reasons real people declined or disengaged, grouped by what they actually said, most frequent first.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          count: { type: 'integer' },
          stage: {
            type: 'string',
            enum: ['identity_confirm', 'opening_pitch', 'estimate_offer', 'after_offer'],
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
        'Things that are supposed to work and did not — a call dropping mid-pitch, a promised text never confirmed, the agent repeating a question the customer already answered, an unprompted line that reads as pressure rather than help. NOT copy opinions.',
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
              'Which part of the call: opening, identity_confirm, pitch, objection_handling, close, targeting, or data_quality.',
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
            description: 'The current wording being replaced, quoted from a transcript provided.',
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
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'objections', 'defects', 'recommendations'],
  additionalProperties: false,
} as const;

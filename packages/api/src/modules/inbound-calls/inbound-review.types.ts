/**
 * Daily performance review of Emily INBOUND (the 844-701-1345 line).
 *
 * Chris, 2026-09-10: "email me a full performance review of the inbound
 * caller at 6 AM every day with successes, failures and recommendations for
 * improvements."
 *
 * Its own schema, not call-review.types.ts's: this line has no offer ladder.
 * Its job is to find the caller's tow (by phone, PO number or job number),
 * give the useful facts, take a message or a new tow, and transfer only when
 * it should. The review is judged on that.
 */

export interface InboundSuccess {
  /** Short label, e.g. "found the job on the caller's own number". */
  label: string;
  count: number;
  /** Verbatim lines from the transcripts that show it working. */
  quotes: Array<{ callId: string; quote: string }>;
}

export interface InboundFailure {
  /** Machine slug, e.g. "transferred_after_lookup_found". */
  code: string;
  summary: string;
  affectedCallIds: string[];
  /** What in the transcript shows it, quoted. */
  evidence: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface InboundRecommendation {
  /** Which part of the call: greeting, sorting, lookup, eta_answer, new_tow_intake, motor_club, message_taking, transfer, pacing, tools, data. */
  target: string;
  title: string;
  problem: string;
  proposedText?: string | null;
  currentText?: string | null;
  rationale: string;
  evidence: Array<{ callId: string; quote: string }>;
  kind: 'PROMPT' | 'TOOL' | 'DATA' | 'POLICY';
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface InboundDailyAnalysis {
  summary: string;
  successes: InboundSuccess[];
  failures: InboundFailure[];
  recommendations: InboundRecommendation[];
}

export const INBOUND_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description:
        'Three to five sentences for the owner: how the line performed in the last 24 hours, the one thing that went best, the one thing that most needs fixing. Plain language, no hedging.',
    },
    successes: {
      type: 'array',
      description:
        'Things Emily did right that a human dispatcher would be pleased with, grouped, most frequent first. Each backed by quotes. Empty is allowed but unusual — most days have at least one clean, found-and-answered call.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          count: { type: 'integer' },
          quotes: {
            type: 'array',
            items: {
              type: 'object',
              properties: { callId: { type: 'string' }, quote: { type: 'string' } },
              required: ['callId', 'quote'],
              additionalProperties: false,
            },
          },
        },
        required: ['label', 'count', 'quotes'],
        additionalProperties: false,
      },
    },
    failures: {
      type: 'array',
      description:
        'Things that went wrong: a transfer that was avoidable, a lookup that should have found the job, a wrong branch, a question asked twice, speaking over the caller, reading the ETA field, promising a price, a call that died with nothing done. Severity HIGH = a caller was failed; MEDIUM = handled but badly; LOW = cosmetic.',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          summary: { type: 'string' },
          affectedCallIds: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'string' },
          severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
        },
        required: ['code', 'summary', 'affectedCallIds', 'evidence', 'severity'],
        additionalProperties: false,
      },
    },
    recommendations: {
      type: 'array',
      description:
        'Concrete, testable changes ranked by expected value. PROMPT = wording or instruction in the agent prompt; TOOL = a lookup or tool-schema change; DATA = something wrong in the job data Emily is reading; POLICY = a business decision the owner has to make. Empty array is a correct answer on a clean day.',
      items: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description:
              'One of: greeting, sorting, lookup, eta_answer, new_tow_intake, motor_club, message_taking, transfer, pacing, tools, data.',
          },
          title: { type: 'string' },
          problem: { type: 'string' },
          proposedText: {
            type: ['string', 'null'],
            description: 'Exact replacement wording when the change is wording. Null otherwise.',
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
              properties: { callId: { type: 'string' }, quote: { type: 'string' } },
              required: ['callId', 'quote'],
              additionalProperties: false,
            },
          },
          kind: { type: 'string', enum: ['PROMPT', 'TOOL', 'DATA', 'POLICY'] },
          confidence: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
        },
        required: ['target', 'title', 'problem', 'proposedText', 'currentText', 'rationale', 'evidence', 'kind', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'successes', 'failures', 'recommendations'],
  additionalProperties: false,
} as const;

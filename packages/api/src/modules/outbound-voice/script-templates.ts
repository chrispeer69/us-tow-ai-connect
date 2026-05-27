/**
 * Session 49 — Outbound voice script templates.
 *
 * Each template defines:
 *   - `key`             stable id used in the DB column `script_template`
 *   - `purpose`         the call purpose enum value (1:1 mapping today)
 *   - `requiredVariables`  variables that MUST be provided to render the
 *                       template; missing ones raise during enqueueCall.
 *   - `body`            the template body. Variable interpolation uses the
 *                       `{{name}}` syntax — straight string replacement, no
 *                       expression evaluation.
 *
 * The body is the script the Thinkrr outbound agent reads to the recipient.
 * Keep them concise; the platform charges per minute.
 */

export type OutboundVoicePurpose =
  | 'customer_status_update'
  | 'eta_confirmation'
  | 'post_job_followup'
  | 'driver_escalation'
  | 'motor_club_update'
  | 'custom';

export interface ScriptTemplate {
  key: string;
  purpose: OutboundVoicePurpose;
  requiredVariables: string[];
  body: string;
}

export const SCRIPT_TEMPLATES: Record<string, ScriptTemplate> = {
  customer_status_update: {
    key: 'customer_status_update',
    purpose: 'customer_status_update',
    requiredVariables: ['customer_name', 'company_name', 'job_id', 'status'],
    body:
      'Hello {{customer_name}}, this is {{company_name}} calling with an update on your tow request, ' +
      'job number {{job_id}}. The current status is {{status}}. ' +
      'If you have any questions please call us back. Thank you.',
  },
  eta_confirmation: {
    key: 'eta_confirmation',
    purpose: 'eta_confirmation',
    requiredVariables: [
      'customer_name',
      'company_name',
      'driver_first_name',
      'eta_minutes',
    ],
    body:
      'Hello {{customer_name}}, this is {{company_name}} calling. Your driver, ' +
      '{{driver_first_name}}, is on the way and should arrive in approximately ' +
      '{{eta_minutes}} minutes. Please stay with your vehicle in a safe location. ' +
      'Reply STOP to opt out of automated calls.',
  },
  post_job_followup: {
    key: 'post_job_followup',
    purpose: 'post_job_followup',
    requiredVariables: ['customer_name', 'company_name'],
    body:
      'Hi {{customer_name}}, this is {{company_name}}. We are following up after your recent ' +
      'service to make sure everything went well. If you have a moment, we would appreciate a ' +
      'review. Press one to leave feedback, or stay on the line to speak with our team.',
  },
  driver_escalation: {
    key: 'driver_escalation',
    purpose: 'driver_escalation',
    requiredVariables: ['driver_first_name', 'job_id', 'company_name', 'reason'],
    body:
      'This is an urgent dispatch alert from {{company_name}}. Driver {{driver_first_name}}, ' +
      'please respond regarding job {{job_id}}. Reason: {{reason}}. ' +
      'Press one to acknowledge, or call dispatch immediately.',
  },
  motor_club_update: {
    key: 'motor_club_update',
    purpose: 'motor_club_update',
    requiredVariables: ['motor_club', 'job_id', 'status', 'company_name'],
    body:
      'This is {{company_name}} with a status update for {{motor_club}} regarding job ' +
      '{{job_id}}. Current status: {{status}}. This message confirms an update has been ' +
      'sent to your dispatch system. Goodbye.',
  },
  custom: {
    key: 'custom',
    purpose: 'custom',
    requiredVariables: ['body'],
    body: '{{body}}',
  },
};

export function listTemplateKeys(): string[] {
  return Object.keys(SCRIPT_TEMPLATES);
}

export function getTemplate(key: string): ScriptTemplate | null {
  return SCRIPT_TEMPLATES[key] ?? null;
}

/**
 * Substitutes {{var}} tokens with the provided values.
 *
 * Missing variables raise a `MissingVariableError` so the enqueue path
 * can fail loudly instead of dialing with `{{...}}` literals on the wire.
 * Unknown variables in the values bag are silently ignored.
 */
export class MissingVariableError extends Error {
  constructor(public readonly templateKey: string, public readonly missing: string[]) {
    super(
      `Outbound voice template "${templateKey}" is missing required variables: ` +
        missing.join(', '),
    );
    this.name = 'MissingVariableError';
  }
}

export function renderTemplate(
  key: string,
  variables: Record<string, unknown>,
): { body: string; resolvedVariables: Record<string, string> } {
  const template = getTemplate(key);
  if (!template) {
    throw new Error(`Unknown outbound voice template: ${key}`);
  }
  const missing = template.requiredVariables.filter((v) => {
    const val = variables[v];
    return val === undefined || val === null || val === '';
  });
  if (missing.length > 0) {
    throw new MissingVariableError(key, missing);
  }
  const resolvedVariables: Record<string, string> = {};
  for (const [k, v] of Object.entries(variables)) {
    resolvedVariables[k] = String(v);
  }
  const body = template.body.replace(/\{\{(\w+)\}\}/g, (_match, name) => {
    return resolvedVariables[name] ?? '';
  });
  return { body, resolvedVariables };
}

import { describe, it, expect } from 'vitest';
import {
  getTemplate,
  listTemplateKeys,
  MissingVariableError,
  renderTemplate,
  SCRIPT_TEMPLATES,
} from './script-templates';

describe('script-templates', () => {
  it('exposes all 6 purposes and the keys match the purpose enum', () => {
    const keys = listTemplateKeys().sort();
    expect(keys).toEqual([
      'custom',
      'customer_status_update',
      'driver_escalation',
      'eta_confirmation',
      'motor_club_update',
      'post_job_followup',
    ]);
    for (const key of keys) {
      const t = getTemplate(key);
      expect(t).not.toBeNull();
      expect(t!.purpose).toBe(key === 'custom' ? 'custom' : key);
    }
  });

  it('renders the customer_status_update template with all variables', () => {
    const { body, resolvedVariables } = renderTemplate('customer_status_update', {
      customer_name: 'Pat',
      company_name: 'Roadside Towing',
      job_id: 'J-101',
      status: 'driver en-route',
    });
    expect(body).toContain('Hello Pat');
    expect(body).toContain('Roadside Towing');
    expect(body).toContain('J-101');
    expect(body).toContain('driver en-route');
    expect(resolvedVariables.customer_name).toBe('Pat');
  });

  it('renders the eta_confirmation template', () => {
    const { body } = renderTemplate('eta_confirmation', {
      customer_name: 'Pat',
      company_name: 'Roadside Towing',
      driver_first_name: 'Mike',
      eta_minutes: 15,
    });
    expect(body).toContain('Mike');
    expect(body).toContain('15 minutes');
  });

  it('renders the post_job_followup template', () => {
    const { body } = renderTemplate('post_job_followup', {
      customer_name: 'Pat',
      company_name: 'Roadside Towing',
    });
    expect(body).toContain('Pat');
    expect(body).toContain('Roadside Towing');
  });

  it('renders the driver_escalation template', () => {
    const { body } = renderTemplate('driver_escalation', {
      driver_first_name: 'Mike',
      job_id: 'J-101',
      company_name: 'Roadside Towing',
      reason: 'no driver response in 5 minutes',
    });
    expect(body).toContain('Mike');
    expect(body).toContain('J-101');
    expect(body).toContain('no driver response in 5 minutes');
  });

  it('renders the motor_club_update template', () => {
    const { body } = renderTemplate('motor_club_update', {
      motor_club: 'AAA',
      job_id: 'J-101',
      status: 'completed',
      company_name: 'Roadside Towing',
    });
    expect(body).toContain('AAA');
    expect(body).toContain('completed');
  });

  it('renders the custom template by passing through the provided body', () => {
    const { body } = renderTemplate('custom', { body: 'Hello, this is custom.' });
    expect(body).toBe('Hello, this is custom.');
  });

  it('throws MissingVariableError when a required variable is empty', () => {
    expect(() =>
      renderTemplate('customer_status_update', {
        customer_name: 'Pat',
        company_name: '',
        job_id: 'J-101',
        status: 'queued',
      }),
    ).toThrow(MissingVariableError);
  });

  it('throws MissingVariableError when a required variable is missing', () => {
    try {
      renderTemplate('eta_confirmation', {
        customer_name: 'Pat',
        company_name: 'Roadside Towing',
      });
      throw new Error('expected MissingVariableError');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingVariableError);
      const mve = err as MissingVariableError;
      expect(mve.missing.sort()).toEqual(['driver_first_name', 'eta_minutes']);
    }
  });

  it('throws on unknown template key', () => {
    expect(() => renderTemplate('does_not_exist', {})).toThrow(/Unknown outbound voice template/);
  });

  it('SCRIPT_TEMPLATES is keyed by template key', () => {
    for (const [key, t] of Object.entries(SCRIPT_TEMPLATES)) {
      expect(t.key).toBe(key);
    }
  });

  it('does not leave {{var}} placeholders when a variable is provided', () => {
    const { body } = renderTemplate('eta_confirmation', {
      customer_name: 'Pat',
      company_name: 'Roadside',
      driver_first_name: 'Mike',
      eta_minutes: 12,
    });
    expect(body).not.toMatch(/\{\{\w+\}\}/);
  });
});

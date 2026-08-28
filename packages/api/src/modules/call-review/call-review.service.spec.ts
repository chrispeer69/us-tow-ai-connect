import { describe, expect, it } from 'vitest';
import type { OutboundCallLogRow } from '../../db/schema';
import { computeFunnel } from './call-review.service';

function makeRow(overrides: Partial<OutboundCallLogRow> = {}): OutboundCallLogRow {
  return {
    id: 'row-id',
    tenantId: 'tenant-id',
    customerName: 'Test Customer',
    customerPhone: '+15555550100',
    motorClub: null,
    vehicle: null,
    issueType: null,
    originalDestination: null,
    destinationBusinessName: null,
    destinationType: null,
    flipEligible: false,
    noFlipReason: null,
    nearestOurShop: null,
    offer1Result: 'NOT_ATTEMPTED',
    offer2Result: 'NOT_ATTEMPTED',
    offer3Result: 'NOT_ATTEMPTED',
    flipOutcome: 'NOT_ATTEMPTED',
    newDestination: null,
    conviniLinkSent: false,
    conviniSellType: null,
    towbookNotesUpdated: false,
    correctionsMade: null,
    callDurationSeconds: null,
    callRecordingUrl: null,
    transcript: null,
    managementNotified: false,
    callTime: new Date('2026-08-27T12:00:00Z'),
    scriptVersion: null,
    scenario: null,
    scriptVariant: 'control',
    keysAndPresence: null,
    accessNotes: null,
    vehicleCondition: null,
    vehicleDetails: null,
    issueDescription: null,
    confirmedDestination: null,
    ...overrides,
  } as OutboundCallLogRow;
}

describe('computeFunnel', () => {
  it('counts an eligible, unpitched competitor_repair call as never-pitched', () => {
    const metrics = computeFunnel([
      makeRow({ flipEligible: true, scenario: 'competitor_repair', offer1Result: 'NOT_ATTEMPTED' }),
    ]);
    expect(metrics.eligible).toBe(1);
    expect(metrics.neverPitched).toBe(1);
  });

  it('excludes auto_body soft-mention calls from eligible/never-pitched — they never enter the offer_1 ladder by design', () => {
    const metrics = computeFunnel([
      makeRow({ flipEligible: true, scenario: 'auto_body', offer1Result: 'NOT_ATTEMPTED' }),
      makeRow({ flipEligible: true, scenario: 'competitor_repair', offer1Result: 'NOT_ATTEMPTED' }),
    ]);
    expect(metrics.calls).toBe(2);
    expect(metrics.eligible).toBe(1);
    expect(metrics.neverPitched).toBe(1);
  });

  it('still counts an auto_body row toward calls and its own byScenario bucket', () => {
    const metrics = computeFunnel([makeRow({ flipEligible: true, scenario: 'auto_body' })]);
    const bucket = metrics.byScenario.find((s) => s.scenario === 'auto_body');
    expect(bucket).toEqual({ scenario: 'auto_body', calls: 1, eligible: 1, wins: 0 });
  });

  it('counts a win regardless of scenario', () => {
    const metrics = computeFunnel([
      makeRow({ flipEligible: true, scenario: 'auto_body', flipOutcome: 'ACCEPTED' }),
    ]);
    expect(metrics.wins).toBe(1);
    expect(metrics.winRateOfCalls).toBe(100);
  });

  it('returns zeroed rates on an empty set rather than dividing by zero', () => {
    const metrics = computeFunnel([]);
    expect(metrics).toMatchObject({
      calls: 0,
      eligible: 0,
      winRateOfCalls: 0,
      winRateOfPitched: 0,
      winRateOfEligible: 0,
    });
  });
});

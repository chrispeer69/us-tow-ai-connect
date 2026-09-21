import { describe, expect, it } from 'vitest';
import {
  assembleAaaActiveJobs,
  classifyAaaClearedOutcome,
  isVerifiedAaaStatus,
  parseAaaWorkOrderTable,
} from '../aaa-portal.adapter';

const LIVE_HEADERS = [
  'Item Number',
  'Sort\nWork Order Number\nShow Work Order Number Column Actions',
  'Sort\nCall ID\nShow Call ID Column Actions',
  'Sort\nCall Date\nShow Call Date Column Actions',
  'Sort\nStatus\nShow Status Column Actions',
  'Sort\nService Territory\nShow Service Territory Column Actions',
  'Sort\nContact\nShow Contact Column Actions',
  'Sort\nMember Number\nShow Member Number Column Actions',
  'Sort\nPhone Number\nShow Phone Number Column Actions',
  'Action',
];

describe('AAA Work Orders parsing', () => {
  it('maps the live Salesforce row-header layout by semantic column name', () => {
    const rows = parseAaaWorkOrderTable(LIVE_HEADERS, [
      [
        '',
        '16026698',
        '16026698',
        '2026-09-18',
        'In Progress',
        'OH744-AUTO LYFT USA INC.',
        'BRIAN WILSON',
        '4382124983619006',
        '(614) 551-0934',
        'Show Actions',
      ],
    ]);

    expect(rows).toEqual([
      {
        workOrderNumber: '16026698',
        callId: '16026698',
        callDate: '2026-09-18',
        status: 'In Progress',
        serviceTerritory: 'OH744-AUTO LYFT USA INC.',
        customerName: 'BRIAN WILSON',
        memberNumber: '4382124983619006',
        customerPhone: '6145510934',
      },
    ]);
  });

  it('uses Call ID, preserves Cleared, and collapses the two verified AAA stages', () => {
    const now = '2026-09-21T00:00:00.000Z';
    const jobs = assembleAaaActiveJobs(
      [
        {
          workOrderNumber: 'WO-1',
          callId: 'CALL-1',
          callDate: '2026-09-21',
          status: 'En Route',
          serviceTerritory: 'OH744',
          customerName: 'Customer One',
          memberNumber: 'M-1',
          customerPhone: '6145550101',
        },
        {
          workOrderNumber: 'WO-1-STAGE-2',
          callId: 'CALL-1',
          callDate: '2026-09-21',
          status: 'Tow Loaded',
          serviceTerritory: 'OH744',
          customerName: 'Customer One',
          memberNumber: 'M-1',
          customerPhone: '6145550101',
        },
        {
          workOrderNumber: 'WO-2',
          callId: 'CALL-2',
          callDate: '2026-09-20',
          status: 'Cleared',
          serviceTerritory: 'OH744',
          customerName: 'Finished Customer',
          memberNumber: 'M-2',
          customerPhone: '6145550102',
        },
      ],
      now,
    );

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      jobId: 'CALL-1',
      status: 'Tow Loaded',
      customerPhone: '6145550101',
      lastUpdated: now,
    });
    expect(jobs[1]).toMatchObject({ jobId: 'CALL-2', status: 'Cleared' });
  });

  it('does not complete a call when one stage is cleared but another remains active', () => {
    const jobs = assembleAaaActiveJobs([
      {
        workOrderNumber: 'WO-1-A',
        callId: 'CALL-1',
        callDate: '2026-09-21',
        status: 'Cleared',
        serviceTerritory: 'OH744',
        customerName: 'Customer One',
        memberNumber: 'M-1',
        customerPhone: '6145550101',
      },
      {
        workOrderNumber: 'WO-1-B',
        callId: 'CALL-1',
        callDate: '2026-09-21',
        status: 'Tow Loaded',
        serviceTerritory: 'OH744',
        customerName: 'Customer One',
        memberNumber: 'M-1',
        customerPhone: '6145550101',
      },
    ]);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ jobId: 'CALL-1', status: 'Tow Loaded' });
  });

  it('fails closed for guessed or otherwise unverified AAA statuses', () => {
    expect(isVerifiedAaaStatus('In Progress')).toBe(true);
    expect(isVerifiedAaaStatus('En Route')).toBe(true);
    expect(isVerifiedAaaStatus('On Location')).toBe(true);
    expect(isVerifiedAaaStatus('Tow Loaded')).toBe(true);
    expect(isVerifiedAaaStatus('Cleared')).toBe(true);
    expect(isVerifiedAaaStatus('In Tow')).toBe(false);
    expect(isVerifiedAaaStatus('On Scene')).toBe(false);
    expect(isVerifiedAaaStatus('Cancelled')).toBe(false);

    const jobs = assembleAaaActiveJobs([
      {
        workOrderNumber: 'WO-UNKNOWN',
        callId: 'CALL-UNKNOWN',
        callDate: '2026-09-21',
        status: 'Cancelled',
        serviceTerritory: 'OH744',
        customerName: 'Unknown Outcome',
        memberNumber: 'M-3',
        customerPhone: '6145550103',
      },
    ]);

    expect(jobs).toEqual([]);
  });

  it('requires a Tow Complete timestamp before treating Cleared as completed', () => {
    expect(
      classifyAaaClearedOutcome({
        towCompleteTimestamp: '9/17/2026, 10:22 AM',
        canceledTimestamp: '',
      }),
    ).toBe('Tow Complete');

    expect(
      classifyAaaClearedOutcome({ towCompleteTimestamp: '', canceledTimestamp: '' }),
    ).toBe('Closed Without Tow Complete');

    expect(
      classifyAaaClearedOutcome({
        towCompleteTimestamp: '9/17/2026, 10:22 AM',
        canceledTimestamp: '9/17/2026, 10:20 AM',
      }),
    ).toBe('Closed Without Tow Complete');
  });

  it('fails closed when Salesforce removes a required semantic column', () => {
    expect(() => parseAaaWorkOrderTable(['Work Order Number', 'Status'], [])).toThrow(
      /missing required columns/i,
    );
  });
});

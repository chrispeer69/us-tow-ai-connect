import { describe, it, expect } from 'vitest';
import {
  renderBatchSummarySms,
  renderDailyReportSms,
  renderFlipWinSms,
} from './flip-sms-templates';

describe('renderFlipWinSms', () => {
  it('renders all sections in the spec order', () => {
    const body = renderFlipWinSms({
      companyName: 'Roadside Towing',
      customer: { name: 'Pat', phone: '614-555-1212' },
      vehicle: '2019 Honda Civic',
      issue: 'brake noise',
      pickup: 'I-71 S, MM 42',
      originalDestination: 'Midas, 2640 N High St',
      redirectedTo: "Wayne's Westerville",
      distanceSavedMiles: 2.3,
      acceptedOffer: 1,
      conviniLinkSent: true,
      rentalMentioned: true,
      driverName: 'Dustin DeLauder',
      jobNumber: 'TB-121737',
      callTimeLocal: '14:22 EDT',
      callDuration: '2m 41s',
      transcriptUrl: 'https://app.ustowdispatch.com/calls/uvc-9k3m',
    });
    expect(body).toContain('FLIP WIN — Roadside Towing');
    expect(body).toContain('Pat (614-555-1212)');
    expect(body).toContain('ORIGINAL: Midas');
    expect(body).toContain("REDIRECTED TO: Wayne's Westerville");
    expect(body).toContain('Distance saved for driver: 2.3 mi');
    expect(body).toContain('Offer 1 (free diagnostic + 10% off)');
    expect(body).toContain('CONVINI link: sent');
    expect(body).toContain('Rental mentioned: yes');
    expect(body).toContain('Driver: Dustin DeLauder (assigned)');
    expect(body).toContain('Job #: TB-121737');
    expect(body).toContain('Transcript: https://');
  });

  it('omits distance line when distanceSavedMiles is null', () => {
    const body = renderFlipWinSms({
      companyName: 'Co',
      customer: { name: 'A', phone: '1' },
      vehicle: 'v',
      issue: 'i',
      pickup: 'p',
      originalDestination: 'o',
      redirectedTo: 'r',
      distanceSavedMiles: null,
      acceptedOffer: 2,
      conviniLinkSent: false,
      rentalMentioned: false,
      driverName: null,
      jobNumber: 'X',
      callTimeLocal: 't',
      callDuration: 'd',
    });
    expect(body).not.toMatch(/Distance saved/i);
    expect(body).toContain('Offer 2 (same-day priority + 1hr estimate)');
    expect(body).toContain('CONVINI link: not sent');
    expect(body).toContain('Rental mentioned: no');
    expect(body).not.toMatch(/Driver:/); // driverName null = line omitted
  });
});

describe('renderBatchSummarySms', () => {
  it('renders the spec format: header, wins, losses, on-the-day total', () => {
    const body = renderBatchSummarySms({
      companyName: 'Roadside Towing',
      windowSize: 10,
      wins: [
        { jobNumber: 'TB-121737', redirectedTo: "Wayne's Westerville", offer: 1 },
        { jobNumber: 'TB-121752', redirectedTo: "Petty's Auto", offer: 2 },
        { jobNumber: 'TB-121762', redirectedTo: "Wayne's Columbus", offer: 1 },
      ],
      losses: [
        'TB-121730', 'TB-121745', 'AAA-14801130',
        'TB-121758', 'AAA-14801141', 'AAA-14801158',
        'TB-121767',
      ],
      todayWins: 7,
      todayLosses: 33,
    });
    expect(body).toContain('FLIP BATCH — Roadside Towing');
    expect(body).toContain('Last 10: 3 wins / 7 losses');
    expect(body).toContain("TB-121737  Wayne's Westerville (Off 1)");
    expect(body).toContain('LOSSES:');
    expect(body).toContain('TB-121730');
    expect(body).toContain('ON THE DAY: 7 wins / 33 losses');
  });

  it('skips empty wins or losses sections cleanly', () => {
    const body = renderBatchSummarySms({
      companyName: 'Co',
      windowSize: 10,
      wins: [],
      losses: ['A'],
      todayWins: 0,
      todayLosses: 1,
    });
    expect(body).not.toMatch(/^WINS:/m);
    expect(body).toContain('LOSSES:');
  });
});

describe('renderDailyReportSms', () => {
  it('renders the daily report with shop + offer + source + skipped breakdown', () => {
    const body = renderDailyReportSms({
      companyName: 'Roadside Towing',
      dateLocal: '2026-05-27',
      totalAttempts: 28,
      wins: 16,
      losses: 12,
      winsByShop: [
        { shopName: "Wayne's Westerville", count: 5 },
        { shopName: "Wayne's Columbus", count: 4 },
        { shopName: 'Hilliard Auto', count: 3 },
      ],
      winsByOffer: { offer1: 9, offer2: 4, offer3: 3 },
      source: { towbookAttempts: 21, towbookWins: 12, aaaAttempts: 7, aaaWins: 4 },
      conviniSent: 28,
      skippedAaaBranded: 2,
    });
    expect(body).toContain('FLIP DAILY — Roadside Towing');
    expect(body).toContain('2026-05-27');
    expect(body).toContain('28 attempts. 16 wins / 12 losses.');
    expect(body).toContain('WINS BY SHOP:');
    expect(body).toContain("Wayne's Westerville: 5");
    expect(body).toContain('Off 1: 9  |  Off 2: 4  |  Off 3: 3');
    expect(body).toContain('Towbook: 21 (12 wins)');
    expect(body).toContain('AAA: 7 (4 wins)');
    expect(body).toContain('CONVINI links sent: 28');
    expect(body).toContain('Skipped (AAA-branded): 2');
  });
});

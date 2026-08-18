import { describe, expect, it } from 'vitest';
import { extractRetellAnalysis } from '../outbound-voice/retell-call-mapping';
import { composeAiNotes } from './ai-notes.composer';

/**
 * Session 77 — the join that was missing.
 *
 * `composeAiNotes` was tested. `extractRetellAnalysis` was tested. Between them
 * sat a gap nothing covered: the agent emitted no intake fields, the extractor
 * read nulls, the sweep hardcoded nulls on top of that, and the KEYS / ACCESS /
 * CONDITION / VEHICLE lines were structurally incapable of rendering. Every
 * individual piece passed its own tests while the feature produced nothing.
 *
 * These tests run a REAL Retell `call_analysis` payload — the shape returned by
 * `GET /v2/get-call` — all the way to the block that gets typed into the job,
 * so the two halves cannot drift apart again.
 */
describe('AI Notes pipeline — Retell analysis to a driver-ready note', () => {
  // Shaped exactly like a live payload: custom_analysis_data nested under
  // call_analysis, which is where Retell actually puts the custom fields.
  const liveCall = {
    call_summary: 'Confirmed tow details and captured intake.',
    custom_analysis_data: {
      flip_eligible: true,
      flip_outcome: 'FAILED',
      offer_1_result: 'DECLINED',
      destination_type: 'competitor_repair',
      corrections_made: 'Pickup corrected from 760 to 670 Pemberley Park Drive, unit 205.',
      keys_and_presence: 'Customer will be on scene with the keys',
      access_notes: 'In an empty warehouse, nose out, tight turn to get in',
      vehicle_condition: 'All four tyres up',
      vehicle_details: 'Blue, rear-wheel drive',
      issue_description: 'Will not start, not the battery',
      confirmed_destination: '270 Broad Street, Westerville - repair shop',
    },
  };

  it('carries every intake answer from the Retell payload into the note', () => {
    const a = extractRetellAnalysis(liveCall);
    const block = composeAiNotes({
      keysAndPresence: a.keys_and_presence,
      accessNotes: a.access_notes,
      vehicleCondition: a.vehicle_condition,
      vehicleDetails: a.vehicle_details,
      issueDescription: a.issue_description,
      confirmedDestination: a.confirmed_destination,
      correctionsMade: a.corrections_made,
      newDestination: a.new_destination,
      flipOutcome: a.flip_outcome,
      callTimeIso: '2026-08-18T14:22:00.000Z',
    });

    expect(block).not.toBeNull();
    // The customer's own words survive the whole trip — this is the point of
    // the feature. A driver needs "tight turn to get in", not "parking lot".
    expect(block).toContain('tight turn to get in');
    expect(block).toContain('Customer will be on scene with the keys');
    expect(block).toContain('All four tyres up');
    expect(block).toContain('Blue, rear-wheel drive');
    expect(block).toContain('Will not start, not the battery');
    expect(block).toContain('670 Pemberley Park Drive');
  });

  it('reads the fields whether Retell nests them or puts them at the root', () => {
    // Retell places custom fields at the root or under custom_analysis_data
    // depending on how the agent was configured, and that has changed under us
    // before. Both must work or the note silently empties out.
    const rootShaped = {
      keys_and_presence: 'Keys in the mailbox',
      access_notes: 'Underground garage, low clearance',
    };
    const a = extractRetellAnalysis(rootShaped);
    expect(a.keys_and_presence).toBe('Keys in the mailbox');
    expect(a.access_notes).toBe('Underground garage, low clearance');
  });

  it('produces a note from intake alone, with no correction and no flip', () => {
    // The pre-Session-77 sweep only looked for corrections_made or
    // new_destination, so a call like this one — the ordinary case — produced
    // nothing at all. It is the whole reason the feature looked like it worked
    // and delivered 24.7% coverage.
    const a = extractRetellAnalysis({
      custom_analysis_data: {
        keys_and_presence: 'Customer on scene with keys',
        access_notes: 'Street parking, nose in',
        vehicle_condition: 'Left rear flat',
        vehicle_details: 'White, drivetrain unknown',
      },
    });
    const block = composeAiNotes({
      keysAndPresence: a.keys_and_presence,
      accessNotes: a.access_notes,
      vehicleCondition: a.vehicle_condition,
      vehicleDetails: a.vehicle_details,
      callTimeIso: '2026-08-18T14:22:00.000Z',
    });
    expect(block).not.toBeNull();
    expect(block).toContain('Left rear flat');
    // An honest unknown is information a driver acts on — it means "do not
    // assume, check before you dolly it" — so it must not be filtered out.
    expect(block).toContain('drivetrain unknown');
  });

  it('still returns null when the call captured nothing', () => {
    const a = extractRetellAnalysis({
      custom_analysis_data: { flip_eligible: false, offer_1_result: 'NOT_ATTEMPTED' },
    });
    const block = composeAiNotes({
      keysAndPresence: a.keys_and_presence,
      accessNotes: a.access_notes,
      vehicleCondition: a.vehicle_condition,
      vehicleDetails: a.vehicle_details,
      issueDescription: a.issue_description,
      confirmedDestination: a.confirmed_destination,
      correctionsMade: a.corrections_made,
      callTimeIso: '2026-08-18T14:22:00.000Z',
    });
    // Silence beats noise: a details box full of "nothing to report" teaches
    // dispatchers to ignore the block entirely.
    expect(block).toBeNull();
  });

  it('does not invent a destination change when the agent left new_destination empty', () => {
    // The agent is instructed to leave new_destination empty unless the
    // customer gave an unambiguous yes. An empty string must not read as a flip.
    const a = extractRetellAnalysis({
      custom_analysis_data: {
        flip_outcome: 'FAILED',
        offer_1_result: 'DECLINED',
        new_destination: '',
        keys_and_presence: 'Customer on scene with keys',
      },
    });
    const block = composeAiNotes({
      keysAndPresence: a.keys_and_presence,
      newDestination: a.new_destination,
      flipOutcome: a.flip_outcome,
      callTimeIso: '2026-08-18T14:22:00.000Z',
    })!;
    expect(block).not.toBeNull();
    expect(block).not.toContain('DESTINATION CHANGED');
  });

  it('surfaces an accepted flip as the top line', () => {
    const a = extractRetellAnalysis({
      custom_analysis_data: {
        flip_outcome: 'SUCCESS',
        offer_1_result: 'ACCEPTED',
        new_destination: "Wayne's Auto Repair - Powell",
        keys_and_presence: 'Customer on scene with keys',
      },
    });
    const block = composeAiNotes({
      keysAndPresence: a.keys_and_presence,
      newDestination: a.new_destination,
      flipOutcome: a.flip_outcome,
      callTimeIso: '2026-08-18T14:22:00.000Z',
    })!;
    expect(block).toContain("Wayne's Auto Repair - Powell");
    // The driver is going somewhere other than the ticket says. If that is not
    // the first thing read, the note has failed at its only urgent job.
    expect(block.indexOf("Wayne's")).toBeLessThan(block.indexOf('KEYS:'));
  });
});

import { describe, it, expect } from 'vitest';
import {
  AI_NOTES_HEADER,
  alreadyContainsAiNote,
  appendAiNotes,
  composeAiNotes,
} from './ai-notes.composer';

describe('AI Notes composer', () => {
  const callTimeIso = '2026-08-14T19:42:00.000Z'; // 15:42 ET

  // The real 2026-08-14 rows. These are the whole reason the module exists.
  it('writes a real correction, verbatim', () => {
    const block = composeAiNotes({
      correctionsMade:
        'Corrected pickup address from 766 to 763 South Richardson Avenue and clarified car is parked in the alley behind the address.',
      callTimeIso,
    });
    expect(block).toContain(AI_NOTES_HEADER);
    expect(block).toContain('766 to 763 South Richardson Avenue');
    expect(block).toContain('alley behind the address');
    expect(block).toContain('2026-08-14 15:42 ET');
  });

  it('writes a corrected drop-off', () => {
    const block = composeAiNotes({
      correctionsMade:
        'Corrected drop-off address from 1688 Integrity Drive East to 2064 Integrity Drive South.',
    });
    expect(block).toContain('2064 Integrity Drive South');
  });

  // Roughly 70% of calls. Writing "nothing to report" into a live ticket is how
  // you teach dispatchers to ignore the block.
  it.each([
    'No corrections were made as the agent did not reach the motorist.',
    'No corrections made; call did not reach the customer.',
    'No corrections made; agent was unable to proceed past the automated menu.',
    'none',
    'N/A',
    '',
    null,
  ])('returns null for the no-op case: %s', (corrections) => {
    expect(composeAiNotes({ correctionsMade: corrections as string | null })).toBeNull();
  });

  it('keeps text that merely mentions no change but also carries real detail', () => {
    const block = composeAiNotes({
      correctionsMade:
        'Corrected pickup to 763 South Richardson Avenue; no changes to the vehicle.',
    });
    expect(block).not.toBeNull();
    expect(block).toContain('763 South Richardson Avenue');
  });

  it('flags an accepted destination change loudly — the driver is going elsewhere', () => {
    const block = composeAiNotes({
      correctionsMade: 'Customer agreed to switch shops.',
      newDestination: "Wayne's Auto Repair — Powell",
      flipOutcome: 'ACCEPTED',
    });
    expect(block).toContain('DESTINATION CHANGED');
    expect(block).toContain("Wayne's Auto Repair — Powell");
  });

  it('does not claim a destination change when the offer was declined', () => {
    const block = composeAiNotes({
      correctionsMade: 'Corrected the vehicle colour.',
      newDestination: "Wayne's Auto Repair — Powell",
      flipOutcome: 'FAILED',
    });
    expect(block).not.toContain('DESTINATION CHANGED');
  });

  it('ignores an unknown issue rather than writing the word "unknown"', () => {
    expect(composeAiNotes({ issueDescription: 'unknown' })).toBeNull();
    const block = composeAiNotes({ issueDescription: 'check engine light, running rough' });
    expect(block).toContain('Customer described: check engine light, running rough');
  });

  it('omits the stamp rather than inventing one when the time is unusable', () => {
    const block = composeAiNotes({ correctionsMade: 'Corrected pickup.', callTimeIso: 'nonsense' });
    expect(block).toContain(AI_NOTES_HEADER);
    expect(block).not.toContain('NaN');
    expect(block).not.toContain('Invalid');
  });
});

describe('AI Notes append safety', () => {
  const block = composeAiNotes({
    correctionsMade: 'Corrected pickup to 763 South Richardson Avenue.',
    callTimeIso: '2026-08-14T19:42:00.000Z',
  })!;

  it('never overwrites what a dispatcher already typed', () => {
    const existing = 'AEP Ohio building - Left of parking lot. CS HAS KEYS - SHE IS WORKING.';
    const result = appendAiNotes(existing, block);
    expect(result.startsWith(existing)).toBe(true);
    expect(result).toContain('763 South Richardson Avenue');
  });

  it('writes the block alone into an empty details box', () => {
    expect(appendAiNotes('', block)).toBe(block);
    expect(appendAiNotes(null, block)).toBe(block);
  });

  // A webhook delivered twice, or a backfill re-run, must not stack blocks.
  it('is idempotent — a second append is a no-op', () => {
    const once = appendAiNotes('Dispatcher note.', block);
    const twice = appendAiNotes(once, block);
    expect(twice).toBe(once);
    expect(twice.split('763 South Richardson Avenue').length - 1).toBe(1);
  });

  it('detects an existing block by its stamped header', () => {
    expect(alreadyContainsAiNote('', block)).toBe(false);
    expect(alreadyContainsAiNote('unrelated text', block)).toBe(false);
    expect(alreadyContainsAiNote(block, block)).toBe(true);
  });

  it('still appends a later call for the same job — different stamp', () => {
    const later = composeAiNotes({
      correctionsMade: 'Customer called back, gate code is 4471.',
      callTimeIso: '2026-08-14T21:05:00.000Z',
    })!;
    const result = appendAiNotes(appendAiNotes('Dispatcher note.', block), later);
    expect(result).toContain('763 South Richardson Avenue');
    expect(result).toContain('gate code is 4471');
  });
});

export interface DecryptedCredentials {
  username: string;
  password: string;
}

export interface ActiveJob {
  jobId: string;
  customerName: string;
  customerPhone: string; // digits-only
  vehicle: string;
  status: string;
  driverName: string;
  eta: string;
  /** Pickup / origin address ("Tow From"). Empty string when not captured. */
  pickup: string;
  /** Destination / drop-off address ("Tow To"). Empty string when not present (e.g. tow-to TBD). */
  destination: string;
  lastUpdated: string;
}

export interface AdapterConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs: number;
}

/**
 * Result of a physical accept/decline action against a portal. Adapters
 * MUST NOT throw from acceptJob/declineJob — they return this so the
 * dispatch audit trail reflects whether the click actually landed. On
 * success, `confirmationEvidence` carries a human-readable string read off
 * the page (toast text, status change) proving the action took effect.
 */
export interface AdapterActionResult {
  success: boolean;
  confirmedAt?: string; // ISO timestamp
  confirmationEvidence?: string;
  error?: string;
}

export interface TowingSoftwareAdapter {
  login(tenantId: string, creds: DecryptedCredentials): Promise<void>;
  scrapeAllActiveJobs(tenantId: string): Promise<ActiveJob[]>;
  testConnection(creds: DecryptedCredentials): Promise<AdapterConnectionTestResult>;
  // Optional motor-club style actions. Implemented for adapters that
  // represent inbound work queues (AAA); Towbook ships a no-op since it is
  // dispatch-out, not accept-in.
  acceptJob?(tenantId: string, sourceJobId: string): Promise<AdapterActionResult>;
  declineJob?(
    tenantId: string,
    sourceJobId: string,
    reason: string,
  ): Promise<AdapterActionResult>;

  /**
   * Session 75 — write an "AI Notes" block into the job's details box.
   *
   * The point of the integration: on 2026-08-14, 118 of 421 calls carried a
   * real correction ("Corrected pickup address from 766 to 763 South Richardson
   * Avenue and clarified car is parked in the alley behind the address") and not
   * one of them ever reached the dispatch system. The driver went to the address
   * on the ticket.
   *
   * CONTRACT — every implementation must hold all four:
   *
   *  1. APPEND ONLY. Read the current value, append, write back. The details box
   *     belongs to the customer and may carry dispatcher notes a driver depends
   *     on. Compose the new value with `appendAiNotes` rather than concatenating
   *     by hand — that is what keeps this a property rather than a promise.
   *  2. IDEMPOTENT. A webhook delivered twice must not stack blocks. Check with
   *     `alreadyContainsAiNote` before writing.
   *  3. NEVER THROW. Return the result, like accept/decline, so a failed write
   *     is visible in the audit trail instead of killing the caller.
   *  4. VERIFY. Read the field back after writing and only report success when
   *     the text is actually there. A click that silently did nothing is the
   *     failure mode these portals actually have.
   *
   *  5. VERIFY IDENTITY FIRST, FAIL CLOSED. Chris, 2026-08-15: a job can be
   *     verified by phone number, customer name, or job number. Pass all three
   *     you hold in `verify`; the implementation must refuse to write when any
   *     of them contradicts the record it opened. Writing an AI note onto the
   *     wrong customer's ticket is worse than not writing at all.
   *
   * Optional: implemented only for portals whose job records we are permitted to
   * write to.
   */
  updateJobNotes?(
    tenantId: string,
    sourceJobId: string,
    notesBlock: string,
    options?: UpdateJobNotesOptions,
  ): Promise<AdapterActionResult>;
}

/** Identity evidence and safety switches for an AI Notes write. */
export interface UpdateJobNotesOptions {
  /** Customer name we believe is on the job. Checked against the open record. */
  expectCustomerName?: string | null;
  /** Customer phone we believe is on the job. Digits are compared, not format. */
  expectCustomerPhone?: string | null;
  /**
   * Do everything except the write: open the record, verify identity, compose the
   * exact new field value, then report it and change nothing. The rollout path —
   * run for a day, read the logs, then enable for real.
   */
  dryRun?: boolean;
}

export enum SoftwareType {
  TOWBOOK = 'TOWBOOK',
  TOWLOGS = 'TOWLOGS',
  OMADI = 'OMADI',
  AAA_PORTAL = 'AAA_PORTAL',
  DISPATCH_ANYWHERE = 'DISPATCH_ANYWHERE',
  NATIVE = 'NATIVE',
}

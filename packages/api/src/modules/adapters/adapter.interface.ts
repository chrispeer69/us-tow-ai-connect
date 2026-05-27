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
}

export enum SoftwareType {
  TOWBOOK = 'TOWBOOK',
  TOWLOGS = 'TOWLOGS',
  OMADI = 'OMADI',
  AAA_PORTAL = 'AAA_PORTAL',
  DISPATCH_ANYWHERE = 'DISPATCH_ANYWHERE',
  NATIVE = 'NATIVE',
}

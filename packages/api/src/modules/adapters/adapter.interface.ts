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

export interface TowingSoftwareAdapter {
  login(tenantId: string, creds: DecryptedCredentials): Promise<void>;
  scrapeAllActiveJobs(tenantId: string): Promise<ActiveJob[]>;
  testConnection(creds: DecryptedCredentials): Promise<AdapterConnectionTestResult>;
  // Optional motor-club style actions. Implemented for adapters that
  // represent inbound work queues (AAA); Towbook ships a stub since it is
  // dispatch-out, not accept-in.
  acceptJob?(tenantId: string, sourceJobId: string): Promise<void>;
  declineJob?(tenantId: string, sourceJobId: string, reason: string): Promise<void>;
}

export enum SoftwareType {
  TOWBOOK = 'TOWBOOK',
  TOWLOGS = 'TOWLOGS',
  OMADI = 'OMADI',
  AAA_PORTAL = 'AAA_PORTAL',
  NATIVE = 'NATIVE',
}

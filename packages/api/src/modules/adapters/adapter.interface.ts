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
}

export enum SoftwareType {
  TOWBOOK = 'TOWBOOK',
  TOWLOGS = 'TOWLOGS',
  OMADI = 'OMADI',
  AAA_PORTAL = 'AAA_PORTAL',
  NATIVE = 'NATIVE',
}

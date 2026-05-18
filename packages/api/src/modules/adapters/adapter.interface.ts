/**
 * Standard interface that ALL towing software adapters must implement.
 * This is the core abstraction that allows the system to support
 * Towbook, TowLogs, Omadi, and native US Tow Dispatch queries
 * through a single unified contract.
 */
export interface TowingSoftwareAdapter {
  /**
   * Look up an active tow job by the customer's phone number.
   * Returns ETA, driver name, job status, and vehicle info.
   */
  lookupByPhone(tenantId: string, phone: string): Promise<AdapterLookupResult>;

  /**
   * Validate that the stored credentials can successfully authenticate.
   * Used by the "Test Connection" button in the dashboard.
   */
  testConnection(tenantId: string): Promise<AdapterConnectionTest>;
}

export interface AdapterLookupResult {
  jobFound: boolean;
  data: {
    eta: string;
    driverName: string;
    jobStatus: string;
    vehicle?: string;
  } | null;
  latencyMs: number;
}

export interface AdapterConnectionTest {
  success: boolean;
  message: string;
  latencyMs: number;
}

/**
 * Enum of supported towing software platforms.
 * Used in the tenants table to route requests to the correct adapter.
 */
export enum TowingSoftwareType {
  TOWBOOK = 'TOWBOOK',
  TOWLOGS = 'TOWLOGS',
  OMADI = 'OMADI',
  NATIVE = 'NATIVE',
}

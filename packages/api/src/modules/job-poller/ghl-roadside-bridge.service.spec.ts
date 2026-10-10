import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GhlRoadsideBridgeService } from './ghl-roadside-bridge.service';

describe('GHL towing fields before workflow triggers', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let values: ReturnType<typeof vi.fn>;
  let service: GhlRoadsideBridgeService;
  let stored: Array<{ id: string; value: string }>;
  const job = {
    id: 'job-1', tenantId: '00000000-0000-0000-0000-000000000001',
    sourceJobId: '286707681', source: 'towbook', callerPhone: '+15555550123',
    callerName: 'Test Customer', status: 'completed', sourcePayload: { driverName: 'Test Driver' },
    completedAt: new Date('2026-10-09T12:00:00Z'),
  };
  const keys = ['towbook_job_id', 'towbook_source', 'towbook_driver_name', 'tow_completed_at', 'blue_collar_tips_review'];
  beforeEach(() => {
    vi.stubEnv('GHL_ROADSIDE_BRIDGE_ENABLED', 'true');
    vi.stubEnv('GHL_ROADSIDE_BRIDGE_TEST_MODE', 'false');
    vi.stubEnv('GHL_PRIVATE_INTEGRATION_TOKEN', 'test-only');
    vi.stubEnv('GHL_LOCATION_ID', 'test-location');
    vi.stubEnv('GHL_BLUECOLLARTIPS_URL_FIELD_KEY', 'contact.blue_collar_tips_review');
    ['GHL_TOWBOOK_JOB_FIELD_KEY', 'GHL_TOWBOOK_SOURCE_FIELD_KEY', 'GHL_TOWBOOK_DRIVER_FIELD_KEY', 'GHL_TOW_COMPLETED_AT_FIELD_KEY'].forEach((env, i) => vi.stubEnv(env, `contact.${keys[i]}`));
    values = vi.fn().mockResolvedValue(undefined);
    service = new GhlRoadsideBridgeService({
      query: { jobEvents: { findFirst: vi.fn().mockResolvedValue(null) } },
      insert: vi.fn(() => ({ values })),
    } as any);
    stored = [];
    fetchMock = vi.fn(async (url: string, init: any = {}) => {
      if (url.includes('/customFields?')) return Response.json({ customFields: keys.map((key, i) => ({ id: `field-${i}`, fieldKey: `contact.${key}` })) });
      if (url.endsWith('/upsert')) return Response.json({ contact: { id: 'contact-1' } });
      if (init.method === 'PUT') {
        stored = JSON.parse(init.body).customFields.map((field: any) => ({ id: field.id, value: field.fieldValue }));
        return Response.json({});
      }
      if (url.endsWith('/contact-1') && !init.method) return Response.json({ contact: { customFields: stored } });
      if (url.endsWith('/tags')) return Response.json({});
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it.each(['new', 'completed'])('writes fields by ID and verifies before %s tags', async (stage) => {
    if (stage === 'new') await service.handleNewJob(job as any);
    else await service.handleCompletedJob(job as any);
    const calls = fetchMock.mock.calls;
    const put = calls.findIndex(([, init]) => init?.method === 'PUT');
    const read = calls.findIndex(([url, init]) => url.endsWith('/contact-1') && !init?.method);
    const tag = calls.findIndex(([url]) => url.endsWith('/tags'));
    expect(put).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(put);
    expect(tag).toBeGreaterThan(read);
    expect(stored).toContainEqual({ id: 'field-0', value: job.sourceJobId });
    expect(values).toHaveBeenCalledOnce();
  });

  it('withholds tags and success marker if GHL accepts but loses the fields', async () => {
    const handler = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      if (url.endsWith('/contact-1') && !init?.method) return Response.json({ contact: { customFields: [] } });
      return handler(url, init);
    });
    await expect(service.handleCompletedJob(job as any)).rejects.toThrow('verification mismatch');
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/tags'))).toBe(false);
    expect(values).not.toHaveBeenCalled();
  });

  it('fails closed for a missing field definition', async () => {
    fetchMock.mockImplementation(async () => Response.json({ contact: { id: 'contact-1' }, customFields: [] }));
    await expect(service.handleCompletedJob(job as any)).rejects.toThrow('custom field not found');
    expect(values).not.toHaveBeenCalled();
  });

  it('verifies the review URL and towing data together before in-tow tags', async () => {
    vi.spyOn(service as any, 'createBlueCollarTipsLink').mockResolvedValue('https://example.test/review');
    await service.handleInTowJob({ ...job, status: 'in_tow' } as any);
    expect(stored).toContainEqual({ id: 'field-0', value: job.sourceJobId });
    expect(stored).toContainEqual({ id: 'field-4', value: 'https://example.test/review' });
    expect(values).toHaveBeenCalledOnce();
  });
});

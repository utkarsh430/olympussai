// @vitest-environment node
//
// fetchControlService is server-only (fetch to an external HTTP endpoint),
// same rationale as src/tests/unit/fleetData.test.ts for its per-file node
// environment.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ENV_KEYS = ['CONTROL_SERVICE_BASE_URL', 'CONTROL_SERVICE_SERVICE_TOKEN'] as const;

describe('fetchControlService', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CONTROL_SERVICE_BASE_URL = 'https://control.example.test';
    process.env.CONTROL_SERVICE_SERVICE_TOKEN = 'test-token';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('throws ControlServiceConfigError when the base URL/token are unset', async () => {
    delete process.env.CONTROL_SERVICE_BASE_URL;
    const { fetchControlService, ControlServiceConfigError } = await import('@/lib/controlService/client');
    await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceConfigError);
  });

  it('sends the bearer token and returns parsed JSON on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ routeDirections: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchControlService } = await import('@/lib/controlService/client');
    const result = await fetchControlService('/v1/route-directions');

    expect(result).toEqual({ routeDirections: [] });
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('throws ControlServiceRequestError with the structured error code on a 4xx/5xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: { code: 'unknown_route_direction', message: 'not found' } }),
      }),
    );

    const { fetchControlService, ControlServiceRequestError } = await import('@/lib/controlService/client');
    await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceRequestError);

    try {
      await fetchControlService('/v1/route-directions');
      expect.unreachable('expected fetchControlService to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ControlServiceRequestError);
      const requestError = error as InstanceType<typeof ControlServiceRequestError>;
      expect(requestError.status).toBe(404);
      expect(requestError.code).toBe('unknown_route_direction');
      expect(requestError.message).toBe('not found');
    }
  });

  it('throws ControlServiceUnavailableError when the request times out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }),
    );

    const { fetchControlService, ControlServiceUnavailableError } = await import('@/lib/controlService/client');
    await expect(fetchControlService('/v1/route-directions', { timeoutMs: 5 })).rejects.toBeInstanceOf(
      ControlServiceUnavailableError,
    );
  });

  it('opens the circuit after repeated failures and short-circuits further calls without a network call', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connection refused'));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchControlService, ControlServiceUnavailableError } = await import('@/lib/controlService/client');

    await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // 4th call: circuit is now open, must reject without invoking fetch again.
    await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

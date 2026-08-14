// @vitest-environment node
//
// fetchControlService is server-only (fetch to an external HTTP endpoint),
// same rationale as src/tests/unit/fleetData.test.ts for its per-file node
// environment.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchControlService,
  ControlServiceConfigError,
  ControlServiceRequestError,
  ControlServiceUnavailableError,
  _resetControlServiceCircuitForTests,
} from '@/lib/controlService/client';
import { _setRedisClientForTests } from '@/lib/redis/client';
import { FakeRedis, UnreachableRedis } from '@/tests/helpers/fakeRedis';

const ENV_KEYS = ['CONTROL_SERVICE_BASE_URL', 'CONTROL_SERVICE_SERVICE_TOKEN'] as const;

/**
 * Breaker state is cleared through the module's own async test reset rather
 * than `vi.resetModules()`, so this file and the client share ONE instance of
 * src/lib/redis/client.ts — otherwise the fake installed here would not be
 * the client the breaker reads. `readConfig()` reads process.env per call, so
 * nothing else needed the module reload either.
 */
async function resetBreaker(): Promise<void> {
  await _resetControlServiceCircuitForTests();
}

describe('fetchControlService', () => {
  beforeEach(async () => {
    _setRedisClientForTests(null);
    await resetBreaker();
    process.env.CONTROL_SERVICE_BASE_URL = 'https://control.example.test';
    process.env.CONTROL_SERVICE_SERVICE_TOKEN = 'test-token';
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await resetBreaker();
    _setRedisClientForTests(undefined);
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('throws ControlServiceConfigError when the base URL/token are unset', async () => {
    delete process.env.CONTROL_SERVICE_BASE_URL;
    await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceConfigError);
  });

  it('sends the bearer token and returns parsed JSON on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ routeDirections: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

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

    await expect(fetchControlService('/v1/route-directions', { timeoutMs: 5 })).rejects.toBeInstanceOf(
      ControlServiceUnavailableError,
    );
  });

  it('opens the circuit after repeated failures and short-circuits further calls without a network call', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connection refused'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // 4th call: circuit is now open, must reject without invoking fetch again.
    await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

/**
 * WHAT THE BREAKER IS FOR, stated as tests because the distinction is the
 * whole safety property.
 *
 * The breaker exists to stop this process hammering a control service that
 * cannot answer. "Cannot answer" is not the same as "answered with an error".
 * A 404 is a complete, cheap, authoritative HTTP response: the service is up,
 * it read the request, and it is telling us that route or resource does not
 * exist. Counting it as an outage means one endpoint's 404 can take every
 * OTHER control-service consumer in the process offline — and the consumers
 * sharing this breaker include the command path a control room uses to reach
 * a driver.
 *
 * That is not hypothetical. The driver route screen polls
 * /api/ops/pilot-driver/journey continuously. Against a control service
 * without the arrivals route, that is a permanent 404 stream, and at the old
 * threshold the third poll opened the breaker for everything — /commands
 * included, which then answered 503 CONTROL_SERVICE_UNAVAILABLE while the
 * control service was perfectly healthy.
 *
 * Both directions are asserted. Relaxing the breaker so far that a real
 * outage stops tripping it would be the more dangerous defect of the two.
 */
describe('fetchControlService circuit breaker — an answer is not an outage', () => {
  beforeEach(async () => {
    _setRedisClientForTests(null);
    await resetBreaker();
    process.env.CONTROL_SERVICE_BASE_URL = 'https://control.example.test';
    process.env.CONTROL_SERVICE_SERVICE_TOKEN = 'test-token';
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await resetBreaker();
    _setRedisClientForTests(undefined);
    for (const key of ENV_KEYS) delete process.env[key];
  });

  function respondWith(status: number, body: unknown = { error: { code: 'x', message: 'x' } }) {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status, json: async () => body });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('never opens the circuit on a 404 stream, however long it runs', async () => {
    const fetchMock = respondWith(404, {
      error: { code: 'not_found', message: 'No route for GET /v1/vehicles/abc/arrivals' },
    });

    // Well past the failure threshold: a poller does this every few seconds.
    for (let i = 0; i < 12; i += 1) {
      await expect(fetchControlService('/v1/vehicles/abc/arrivals')).rejects.toBeInstanceOf(
        ControlServiceRequestError,
      );
    }
    // Every one of them reached the network — none was short-circuited.
    expect(fetchMock).toHaveBeenCalledTimes(12);

    // And the SHARED path is still open for everyone else. This is the
    // command path in the reported incident.
    const commands = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ commands: [] }) });
    vi.stubGlobal('fetch', commands);
    await expect(fetchControlService('/v1/commands')).resolves.toEqual({ commands: [] });
  });

  it.each([400, 401, 403, 404, 409, 422])(
    'treats %i as an answer rather than an outage',
    async (status) => {
      const fetchMock = respondWith(status);
      for (let i = 0; i < 5; i += 1) {
        await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceRequestError);
      }
      expect(fetchMock).toHaveBeenCalledTimes(5);
    },
  );

  it.each([500, 502, 503, 504])('still opens the circuit on a %i stream', async (status) => {
    const fetchMock = respondWith(status);

    for (let i = 0; i < 3; i += 1) {
      await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceRequestError);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Threshold reached: the next call must not reach the network at all.
    await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([408, 429])('still opens the circuit on a %i stream, which asks us to back off', async (status) => {
    // The two 4xx codes that are not "your request was wrong" but "stop
    // sending them". Retrying into either at poll rate is the behaviour the
    // breaker exists to prevent.
    const fetchMock = respondWith(status);

    for (let i = 0; i < 3; i += 1) {
      await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceRequestError);
    }
    await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('still opens the circuit on a timeout stream', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    for (let i = 0; i < 3; i += 1) {
      await expect(fetchControlService('/v1/route-directions', { timeoutMs: 5 })).rejects.toBeInstanceOf(
        ControlServiceUnavailableError,
      );
    }
    await expect(fetchControlService('/v1/route-directions', { timeoutMs: 5 })).rejects.toBeInstanceOf(
      ControlServiceUnavailableError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not let a 4xx in the middle of an outage reset the streak', async () => {
    // The subtle way this fix could go wrong. If a 4xx counted as proof of
    // life and cleared the counter, a high-frequency 404 poller interleaved
    // with a genuinely failing service would hold the breaker permanently
    // shut — an outage that never trips. A 4xx is neither an outage signal
    // nor evidence of recovery: it leaves the streak exactly as it was.
    const failing = vi.fn().mockRejectedValue(new Error('connection refused'));
    vi.stubGlobal('fetch', failing);
    for (let i = 0; i < 2; i += 1) {
      await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    }

    respondWith(404);
    await expect(fetchControlService('/v1/vehicles/abc/arrivals')).rejects.toBeInstanceOf(ControlServiceRequestError);

    // Third genuine failure still trips it.
    const failingAgain = vi.fn().mockRejectedValue(new Error('connection refused'));
    vi.stubGlobal('fetch', failingAgain);
    await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    expect(failingAgain).toHaveBeenCalledTimes(1);

    await expect(fetchControlService('/v1/route-directions')).rejects.toThrow(/circuit open/);
    expect(failingAgain).toHaveBeenCalledTimes(1);
  });

  it('a real success still clears the streak', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('connection refused'));
    vi.stubGlobal('fetch', failing);
    for (let i = 0; i < 2; i += 1) {
      await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await fetchControlService('/v1/route-directions');

    const failingAgain = vi.fn().mockRejectedValue(new Error('connection refused'));
    vi.stubGlobal('fetch', failingAgain);
    for (let i = 0; i < 2; i += 1) {
      await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    }
    expect(failingAgain).toHaveBeenCalledTimes(2);
  });
});

/**
 * Same breaker contract, shared backend. What the Redis backend buys is that
 * the failure streak is one streak across every instance, so instance B does
 * not have to rediscover an outage instance A already found — the reason the
 * module-scoped variables were not good enough on a serverless deploy.
 */
describe('fetchControlService circuit breaker — redis backend', () => {
  let redis: FakeRedis;

  beforeEach(async () => {
    redis = new FakeRedis();
    _setRedisClientForTests(redis);
    await resetBreaker();
    process.env.CONTROL_SERVICE_BASE_URL = 'https://control.example.test';
    process.env.CONTROL_SERVICE_SERVICE_TOKEN = 'test-token';
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await resetBreaker();
    _setRedisClientForTests(undefined);
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('trips on the same threshold and reports the shared failure count in its message', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connection refused'));
    vi.stubGlobal('fetch', fetchMock);

    for (let i = 0; i < 3; i += 1) {
      await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await expect(fetchControlService('/v1/route-directions')).rejects.toThrow(
      /circuit open \(\d+s remaining\) after 3 consecutive failures/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('closes again once the cooldown elapses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    for (let i = 0; i < 3; i += 1) {
      await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    }

    redis.advance(31_000); // past CIRCUIT_COOLDOWN_MS

    const okFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ routeDirections: [] }) });
    vi.stubGlobal('fetch', okFetch);
    await expect(fetchControlService('/v1/route-directions')).resolves.toEqual({ routeDirections: [] });
    expect(okFetch).toHaveBeenCalledTimes(1);
  });

  it('a success clears the shared streak, so two isolated failures never trip a third instance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await fetchControlService('/v1/route-directions');

    const failing = vi.fn().mockRejectedValue(new Error('connection refused'));
    vi.stubGlobal('fetch', failing);
    for (let i = 0; i < 2; i += 1) {
      await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    }
    // Streak restarted at the success, so these two are still under threshold.
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('falls back to the per-process breaker when Redis is unreachable, rather than opening or disabling the circuit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    _setRedisClientForTests(new UnreachableRedis());
    await resetBreaker();

    const okFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', okFetch);
    // Not failing closed: a healthy control service is still reachable.
    await expect(fetchControlService('/v1/route-directions')).resolves.toEqual({ ok: true });

    // Not failing open either: the local breaker still protects the caller.
    const failing = vi.fn().mockRejectedValue(new Error('connection refused'));
    vi.stubGlobal('fetch', failing);
    for (let i = 0; i < 3; i += 1) {
      await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    }
    await expect(fetchControlService('/v1/route-directions')).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    expect(failing).toHaveBeenCalledTimes(3);

    vi.restoreAllMocks();
  });
});

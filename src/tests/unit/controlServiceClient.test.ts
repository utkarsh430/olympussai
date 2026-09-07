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
  ControlServiceTimeoutError,
  ControlServiceCircuitOpenError,
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

// ─────────────────────────────────────────────────────────────────────────
// OUR OWN DEADLINE IS NOT THE SERVICE'S FAILURE
// ─────────────────────────────────────────────────────────────────────────
//
// Every timeout in this client used to be reported as `ControlServiceUnavailableError` -
// the same class as a refused connection or a DNS failure - and the ops
// consoles render that as "the control service is temporarily unreachable".
//
// For a poll on an 8-second budget that is fair: nothing answered in a time a
// live read had any business taking. For the fleet trial it was false and
// expensively so. MEASURED, the inter-city preset at 1,000 buses per phase
// takes about 32 seconds against what was a 30-second budget, so the console
// timed out its own deliberate computation, told the operator the simulator
// service could not be reached, and sent a supervisor to look at a service
// that was healthy, answering, and had in fact finished the trial and cached
// the result. Two failures, two different fixes, one message.
describe('fetchControlService — a deadline this client set is not an outage', () => {
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

  const abort = () => {
    const error = new Error('This operation was aborted');
    error.name = 'AbortError';
    return vi.fn().mockRejectedValue(error);
  };

  it('reports a timeout as a timeout, distinctly from an unreachable service', async () => {
    vi.stubGlobal('fetch', abort());
    await expect(fetchControlService('/v1/fleet-trial')).rejects.toBeInstanceOf(
      ControlServiceTimeoutError,
    );
  });

  it('still reports a refused connection as unreachable', async () => {
    // The distinction is only worth having if the other side of it survives.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const error = await fetchControlService('/v1/alerts').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ControlServiceUnavailableError);
    expect(error).not.toBeInstanceOf(ControlServiceTimeoutError);
  });

  it('counts an ordinary timeout toward the breaker, because a poll that slow IS an outage', async () => {
    vi.stubGlobal('fetch', abort());
    for (let i = 0; i < 3; i++) {
      await fetchControlService('/v1/alerts').catch(() => {});
    }
    // Fourth call is refused by the open circuit without reaching fetch.
    await expect(fetchControlService('/v1/alerts')).rejects.toBeInstanceOf(
      ControlServiceUnavailableError,
    );
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });

  it('does NOT let a long computation own deadline trip the breaker for everything else', async () => {
    // The breaker is SHARED by every control-service consumer in this process
    // and trips at three. Three fleet trials - a thing an operator does on
    // purpose, one after another - would otherwise take the alert inbox, the
    // command path and every ops dashboard dark for thirty seconds, over a
    // service that never missed a beat. A deadline this client chose for one
    // deliberately slow call is evidence about the deadline, not the service.
    vi.stubGlobal('fetch', abort());
    for (let i = 0; i < 5; i++) {
      await fetchControlService('/v1/fleet-trial', {
        timeoutMs: 1,
        deadlineIsOurs: true,
      }).catch(() => {});
    }
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(5);

    // And an unrelated read still goes through, rather than meeting an open circuit.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alerts: [] }) }),
    );
    await expect(fetchControlService('/v1/alerts')).resolves.toEqual({ alerts: [] });
  });

  it('still counts a REFUSED CONNECTION on that same call, because nothing answered', async () => {
    // `deadlineIsOurs` excuses our own clock, never the service's silence.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    for (let i = 0; i < 3; i++) {
      await fetchControlService('/v1/fleet-trial', { deadlineIsOurs: true }).catch(() => {});
    }
    await expect(
      fetchControlService('/v1/fleet-trial', { deadlineIsOurs: true }),
    ).rejects.toBeInstanceOf(ControlServiceUnavailableError);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// THREE FAILURES, THREE MESSAGES
// ─────────────────────────────────────────────────────────────────────────
//
// This client's own doc comments described `ControlServiceUnavailableError` as
// meaning "unreachable, timed out, or circuit open" - three conditions with
// three different fixes, collapsed into one class and therefore into one
// sentence on every ops console. Somebody reading "the control service is
// temporarily unreachable" cannot tell whether to go and look at the service
// (it is down), wait a moment (this request ran out of ITS OWN time, and the
// service is fine), or stop retrying and escalate (this process has stopped
// calling because the service has genuinely been failing).
//
// They stay one family - every one of these still IS unavailability, and every
// existing caller catching the base class keeps degrading exactly as it did -
// but each is now nameable by a caller that has something better to say.
describe('fetchControlService — the circuit being open is its own answer', () => {
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

  /** Trip the breaker the honest way: three genuine connection failures. */
  async function tripBreaker() {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    for (let i = 0; i < 3; i++) {
      await fetchControlService('/v1/alerts').catch(() => {});
    }
  }

  it('reports an open circuit distinctly from a service that simply did not answer', async () => {
    await tripBreaker();
    const refused = await fetchControlService('/v1/alerts').catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ControlServiceCircuitOpenError);
  });

  it('is still an unavailability, so every existing caller keeps degrading', async () => {
    // The three are a FAMILY. Narrowing them must not turn a failure some
    // console already handles into one it does not.
    await tripBreaker();
    const refused = await fetchControlService('/v1/alerts').catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ControlServiceUnavailableError);
  });

  it('is not confused with a timeout, which is the opposite diagnosis', async () => {
    await tripBreaker();
    const refused = await fetchControlService('/v1/alerts').catch((e: unknown) => e);
    expect(refused).not.toBeInstanceOf(ControlServiceTimeoutError);
  });

  it('says how long it will keep refusing, and on what evidence', async () => {
    // What distinguishes this from the other two operationally: it is not
    // about one request, it is this process having stopped trying, and the
    // operator needs to know for how long and why.
    await tripBreaker();
    const refused = (await fetchControlService('/v1/alerts').catch(
      (e: unknown) => e,
    )) as Error;
    expect(refused.message).toMatch(/circuit open/i);
    expect(refused.message).toMatch(/consecutive failures/i);
  });

  it('still refuses a call marked deadlineIsOurs, because the circuit is not about our clock', async () => {
    // `deadlineIsOurs` exempts a call's own timeout from COUNTING toward the
    // breaker. It does not exempt it from OBEYING one that is already open:
    // the service has genuinely been failing, and a thirty-second trial is the
    // last thing to send at it.
    await tripBreaker();
    const refused = await fetchControlService('/v1/fleet-trial', {
      deadlineIsOurs: true,
    }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ControlServiceCircuitOpenError);
  });
});

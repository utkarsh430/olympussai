// HTTP layer for the fleet trial: auth, refusal-not-clamping, and the
// difference between "no trial has been run" and "a trial found nothing".
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const { createApp } = await import('../../src/app.js');
const { _resetFleetTrialCacheForTests } = await import('../../src/routes/fleetTrial.js');
const { _resetTrialRunnerForTests, _setTrialJobFactoryForTests } = await import(
  '../../src/fleetTrial/runner.js'
);
const { runFleetTrial } = await import('../../src/fleetTrial/run.js');

/** The trial itself, run in-process - these tests are about the HTTP layer. */
const realTrial = (spec: Parameters<typeof runFleetTrial>[0]) =>
  Promise.resolve(runFleetTrial(spec));

/** A trial that never finishes, so the runner stays busy for the whole test. */
const neverFinishes = () => new Promise<never>(() => {});

const AUTH_HEADER = 'Bearer test-service-token-secret-value';
const PATH = '/v1/fleet-trial';

/** Small enough to keep the suite fast; every rule under test is size-independent. */
const SMALL = { vehiclesPerPhase: 20, scenarios: ['steady_variability', 'slow_bus'] };

describe('POST /v1/fleet-trial', () => {
  beforeEach(() => {
    _resetFleetTrialCacheForTests();
  });

  it('requires the service token like every other /v1 route', async () => {
    const response = await request(createApp()).post(PATH).send(SMALL);
    expect(response.status).toBe(401);
  });

  it('runs a trial and returns both arms of every phase', async () => {
    const response = await request(createApp())
      .post(PATH)
      .set('Authorization', AUTH_HEADER)
      .send(SMALL);

    expect(response.status).toBe(200);
    const body = response.body as {
      vehiclesSimulated: number;
      phases: { controlled: unknown; uncontrolled: unknown; scenarios: unknown[] }[];
      provenance: { source: string }[];
    };
    expect(body.vehiclesSimulated).toBe(40);
    expect(body.phases).toHaveLength(2);
    for (const phase of body.phases) {
      // The counterfactual is not optional: a phase that returned only the
      // controlled arm would be a phase whose numbers mean nothing.
      expect(phase.uncontrolled).toBeTruthy();
      expect(phase.scenarios).toHaveLength(2);
    }
    expect(body.provenance.some((entry) => entry.source === 'modelled')).toBe(true);
  });

  it('REFUSES an out-of-range fleet rather than clamping it', async () => {
    // A clamp would quietly run a different experiment from the one asked for
    // and return it as if it were the answer.
    const response = await request(createApp())
      .post(PATH)
      .set('Authorization', AUTH_HEADER)
      .send({ vehiclesPerPhase: 5000 });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'invalid_request' } });
  });

  it('refuses a scenario the library does not define', async () => {
    const response = await request(createApp())
      .post(PATH)
      .set('Authorization', AUTH_HEADER)
      .send({ scenarios: ['not_a_scenario'] });
    expect(response.status).toBe(400);
  });
});

describe('GET /v1/fleet-trial/latest', () => {
  beforeEach(() => {
    _resetFleetTrialCacheForTests();
  });

  it('says no trial has been run rather than returning an empty one', async () => {
    // "Nothing has been run" and "a trial ran and found nothing" are opposite
    // statements, and a caller must not have to tell them apart by inspecting
    // a zero.
    const response = await request(createApp())
      .get('/v1/fleet-trial/latest')
      .set('Authorization', AUTH_HEADER);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'no_trial_run' } });
  });

  it('serves exactly the report the last POST produced, not a fresh run', async () => {
    // An operator reading a page must not have its numbers change underneath
    // them because the page was refreshed.
    const app = createApp();
    const ran = await request(app).post(PATH).set('Authorization', AUTH_HEADER).send(SMALL);
    const first = await request(app).get('/v1/fleet-trial/latest').set('Authorization', AUTH_HEADER);
    const second = await request(app).get('/v1/fleet-trial/latest').set('Authorization', AUTH_HEADER);

    expect(first.status).toBe(200);
    expect(first.body).toEqual(ran.body);
    expect(second.body).toEqual(first.body);
  });
});

describe('two trials at once', () => {
  beforeEach(() => {
    _resetFleetTrialCacheForTests();
    _resetTrialRunnerForTests();
  });

  it('REFUSES a second trial while one is running rather than starting it', async () => {
    // The double-click, at the layer that can actually enforce it. Disabling
    // the button covers one tab; two tabs, or a reload mid-run, do not go
    // through that button at all.
    _setTrialJobFactoryForTests(neverFinishes);
    const app = createApp();

    // Kick off a trial that never finishes, and do not await it.
    void request(app).post(PATH).set('Authorization', AUTH_HEADER).send(SMALL).end(() => {});
    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = await request(app).post(PATH).set('Authorization', AUTH_HEADER).send(SMALL);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: { code: 'trial_already_running' } });
  });

  it('does not overwrite the last good report when a second trial is refused', async () => {
    // The refusal must cost the operator nothing: whatever was on the console
    // before is still what the console shows.
    _setTrialJobFactoryForTests(async (spec, onProgress) => {
      onProgress({ done: 1, total: 1, stage: 'phases', label: 'a run' });
      return { ...(await realTrial(spec)) };
    });
    const app = createApp();
    const first = await request(app).post(PATH).set('Authorization', AUTH_HEADER).send(SMALL);
    expect(first.status).toBe(200);

    _setTrialJobFactoryForTests(neverFinishes);
    void request(app).post(PATH).set('Authorization', AUTH_HEADER).send(SMALL).end(() => {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    await request(app).post(PATH).set('Authorization', AUTH_HEADER).send(SMALL);

    const latest = await request(app).get(`${PATH}/latest`).set('Authorization', AUTH_HEADER);
    expect(latest.status).toBe(200);
    expect(latest.body).toMatchObject({ vehiclesSimulated: first.body.vehiclesSimulated });
  });

  it('reports the trial FAILING rather than hanging or returning a half report', async () => {
    // Never exercised by hand: a trial that throws needs a spec that breaks
    // it, and the route refuses those before they reach the trial.
    _setTrialJobFactoryForTests(() =>
      Promise.reject(new Error('the corridor came apart')),
    );
    const response = await request(createApp())
      .post(PATH)
      .set('Authorization', AUTH_HEADER)
      .send(SMALL);
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ error: { code: 'trial_failed' } });
    expect(String(response.body.error.message)).toContain('the corridor came apart');
  });

  it('accepts a new trial after one failed', async () => {
    _setTrialJobFactoryForTests(() => Promise.reject(new Error('boom')));
    const app = createApp();
    await request(app).post(PATH).set('Authorization', AUTH_HEADER).send(SMALL);

    _setTrialJobFactoryForTests((spec) => realTrial(spec));
    const second = await request(app).post(PATH).set('Authorization', AUTH_HEADER).send(SMALL);
    expect(second.status).toBe(200);
  });
});

describe('GET /v1/fleet-trial/progress', () => {
  beforeEach(() => {
    _resetFleetTrialCacheForTests();
    _resetTrialRunnerForTests();
  });

  it('answers while a trial is running - the whole point of the worker', async () => {
    // If this returns anything at all, the trial is not on the request thread.
    // Before the worker it could not: `runFleetTrial` is synchronous, so this
    // process answered nothing for the thirty seconds a trial took.
    let report!: (p: {
      done: number;
      total: number;
      stage: 'phases';
      label: string;
    }) => void;
    _setTrialJobFactoryForTests(
      (_spec, onProgress) =>
        new Promise<never>(() => {
          report = onProgress;
        }),
    );
    const app = createApp();
    void request(app).post(PATH).set('Authorization', AUTH_HEADER).send(SMALL).end(() => {});
    await new Promise((resolve) => setTimeout(resolve, 20));

    report({ done: 12, total: 437, stage: 'phases', label: 'Phase 1 - Ordinary day' });
    const response = await request(app)
      .get(`${PATH}/progress`)
      .set('Authorization', AUTH_HEADER);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      running: true,
      done: 12,
      total: 437,
      stage: 'phases',
      label: 'Phase 1 - Ordinary day',
    });
    expect(typeof response.body.startedAtMs).toBe('number');
  });

  it('says no trial is running rather than 404ing, because that is an answer', async () => {
    const response = await request(createApp())
      .get(`${PATH}/progress`)
      .set('Authorization', AUTH_HEADER);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ running: false });
  });

  it('requires the service token like every other /v1 route', async () => {
    const response = await request(createApp()).get(`${PATH}/progress`);
    expect(response.status).toBe(401);
  });

  it('reports a started trial that has not finished a run yet without inventing a total', async () => {
    // "0 of 0" would be a made-up denominator, and a console cannot tell it
    // from a trial with no work to do.
    _setTrialJobFactoryForTests(neverFinishes);
    const app = createApp();
    void request(app).post(PATH).set('Authorization', AUTH_HEADER).send(SMALL).end(() => {});
    await new Promise((resolve) => setTimeout(resolve, 20));

    const response = await request(app)
      .get(`${PATH}/progress`)
      .set('Authorization', AUTH_HEADER);
    expect(response.body).toMatchObject({ running: true, done: 0, total: null });
  });
});

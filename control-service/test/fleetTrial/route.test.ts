// HTTP layer for the fleet trial: auth, refusal-not-clamping, and the
// difference between "no trial has been run" and "a trial found nothing".
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const { createApp } = await import('../../src/app.js');
const { _resetFleetTrialCacheForTests } = await import('../../src/routes/fleetTrial.js');

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

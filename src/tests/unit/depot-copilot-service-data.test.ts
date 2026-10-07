// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { loadFleetFixture } from '@/lib/upsrtc/fleetFixture';
import { normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { defaultServiceHoldStore } from '@/lib/depot/live/serviceHold';
import { routeTableOf } from '@/lib/depot/live/routeInputs';
import { createMemoryHourlyObservationRepository } from '@/lib/depot/repositories/memoryHourlyObservationRepository';
import { createMemoryScheduledTripRepository } from '@/lib/depot/repositories/memoryScheduledTripRepository';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { renderDraft } from '@/lib/depot/copilot/render';
import { prepareCopilotRequest, type Prepared } from '@/lib/depot/copilot/service/prepare';
import { parseCopilotBody, type ValidCopilotRequest } from '@/lib/depot/copilot/service/schema';
import { loadServiceData, type ServiceSources } from '@/lib/depot/copilot/service/serviceData';
import type { CopilotApiRequest } from '@/lib/depot/copilot/wire';
import { networkHoursFixture } from './depot-copilot-network-hours.fixtures';
import { routeHourlyFixture } from './depot-service-fixtures';

const rows = normalizeDepotRows(loadFleetFixture()).rows;
const view: FleetSnapshotView = {
  rows,
  feedNow: '2026-10-06T15:38:00.000Z',
  fetchedAt: '2026-10-06T10:08:05.000Z',
  source: 'live',
  stale: false,
  recordCount: rows.length,
};
const ROUTE = 'VND_1613_ORD_OUT';

const sources = (o: Partial<ServiceSources> = {}): ServiceSources => ({
  services: {
    hourly: createMemoryHourlyObservationRepository(() => defaultServiceHoldStore()),
    scheduled: createMemoryScheduledTripRepository(),
  },
  ...o,
});

function valid(raw: CopilotApiRequest): ValidCopilotRequest {
  const body = parseCopilotBody(JSON.stringify(raw));
  if (!body) throw new Error('fixture must parse');
  return body;
}

async function prepare(raw: CopilotApiRequest, s: ServiceSources = sources()): Promise<Prepared> {
  const body = valid(raw);
  return prepareCopilotRequest(body, view, await loadServiceData(body, view, s));
}

const ask = (question: string): CopilotApiRequest => ({
  task: 'ask',
  question,
  scope: { kind: 'network' },
});

function rendered(p: Prepared) {
  if (!p.ok) throw new Error('expected an answer');
  const r = renderDraft(p.request.scriptedDraft, p.request.facts);
  if (!r.ok) throw new Error(r.reason);
  return { prepared: p, r };
}

beforeEach(() => resetAnalysisForTests());

describe('the copilot on the recorded sample', () => {
  it('carries the route the questions name', () => {
    expect(routeTableOf(view).some((r) => r.routeName === ROUTE)).toBe(true);
  });

  it("answers a route's hour from the route's own day", async () => {
    const { prepared, r } = rendered(await prepare(ask(`why is route ${ROUTE} short at 10am`)));
    if (!prepared.ok) return;
    expect(prepared.interpretedAs).toBe(`Route ${ROUTE} at 10:00`);
    expect(r.headline).toBe(`${ROUTE} at 10:00–11:00`);
    expect(prepared.request.facts.find((f) => f.id === 'hour.needed')?.provenance).toBe('modelled');
  });

  it("answers a route's day", async () => {
    const { r } = rendered(await prepare(ask(`how is ${ROUTE.toLowerCase()} doing today`)));
    expect(r.headline).toBe(`The day of ${ROUTE}`);
  });

  it('declines a route the sample does not carry', async () => {
    const { r } = rendered(await prepare(ask('why is route NOPE_1_X short at 10')));
    expect(r.headline).toBe('That route is not in the current feed');
  });

  it('says the network kinds are not available until the network view is wired', async () => {
    const { r } = rendered(await prepare(ask('what is the plan for today')));
    expect(r.headline).toBe('That answer is not available');
  });

  it("answers the network kinds from the network view's loader", async () => {
    const withNetwork = sources({ networkHours: async () => networkHoursFixture() });
    const brief = rendered(await prepare(ask('what is the plan for today'), withNetwork));
    expect(brief.r.headline).toBe('Service brief: 6 Oct 2026');
    const band = rendered(await prepare(ask('which routes are over-served after 6 pm'), withNetwork));
    expect(band.r.headline).toBe('Routes short and in surplus: evening peak, 16:00–20:00');
    if (band.prepared.ok) expect(band.prepared.table?.columns).toEqual(['Route', 'Gap over the band']);
  });

  it('loads nothing for the depot kinds', async () => {
    const body = valid(ask('how is the network doing'));
    let called = false;
    const data = await loadServiceData(body, view, sources({ networkHours: async () => {
      called = true;
      return null;
    } }));
    expect(data).toEqual({});
    expect(called).toBe(false);
  });
});

describe('the rationale for a route proposal', () => {
  const day = routeHourlyFixture();
  const proposal = day.proposals[0]!;

  it('explains a proposal that is in its route day', () => {
    const body = valid({ task: 'rationale', proposalId: 'p-0a1b2c3d', routeName: day.routeName.replace('-', '_') });
    const withId = { ...day, routeName: day.routeName.replace('-', '_'), proposals: [{ ...proposal, id: 'p-0a1b2c3d' }] };
    const { r, prepared } = rendered(prepareCopilotRequest(body, view, { routeDay: withId }));
    expect(prepared.ok && prepared.request.task).toBe('rationale');
    expect(r.headline).toBe('KANPUR_LUCKNOW, proposed change: add 3 buses');
  });

  it('is a 404 for a proposal not in the day, another route, or no day at all', () => {
    const body = valid({ task: 'rationale', proposalId: 'p-0a1b2c3d', routeName: 'KANPUR_LUCKNOW' });
    const other = { ...day, routeName: 'OTHER_1', proposals: [{ ...proposal, id: 'p-0a1b2c3d' }] };
    expect(prepareCopilotRequest(body, view, { routeDay: { ...day, routeName: 'KANPUR_LUCKNOW' } })).toEqual({ ok: false, status: 404 });
    expect(prepareCopilotRequest(body, view, { routeDay: other })).toEqual({ ok: false, status: 404 });
    expect(prepareCopilotRequest(body, view)).toEqual({ ok: false, status: 404 });
  });

  it("loads the proposal's route day through the route view", async () => {
    const body = valid({ task: 'rationale', proposalId: 'p-0a1b2c3d', routeName: ROUTE });
    const data = await loadServiceData(body, view, sources());
    expect(data.routeDay?.routeName).toBe(ROUTE);
  });
});

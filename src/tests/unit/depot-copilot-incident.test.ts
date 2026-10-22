import { describe, expect, it } from 'vitest';
import { breakdownSummaryAnswer, buildReplacementRationale, replacementForAnswer } from '@/lib/depot/copilot/facts/incident';
import { renderDraft } from '@/lib/depot/copilot/render';
import type { CopilotRequest } from '@/lib/depot/copilot/types';
import type { IncidentView, IncidentsResponse } from '@/lib/depot/incident/api';
import { planReplacement } from '@/lib/depot/incident/replace';
import type { Incident, ReplacementInput } from '@/lib/depot/incident/types';

const incident: Incident = {
  id: 'inc:UP32AB1234:2026-10-12', origin: 'detected', registrationNumber: 'UP32AB1234', depotId: '7', routeName: 'KANPUR-LUCKNOW', journeyId: 'J1',
  position: { lat: 26.5, lng: 80.3 }, stoppedMinutes: 14, signals: ['stopped_on_route', 'power_off'], confidence: 'medium',
  nearestStop: { name: 'Unnao', distanceM: 900, sequence: 4 }, profileState: 'profiled', scheduledEnd: '2026-10-12T12:30:00Z', lastHeardMin: 2,
};
const roadTime = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const km = Math.hypot(a.lat - b.lat, a.lng - b.lng) * 111 * 1.3;
  return { km: Math.round(km * 10) / 10, minutes: (km / 30) * 60 };
};
const base: ReplacementInput = {
  incident, depotName: 'KANPUR', feedMinute: 600, remainingTrip: { stops: 6, km: 42.5, minutes: 150, destination: 'Lucknow' },
  passengersAboard: { value: 30, provenance: 'modelled' },
  ownSpares: [{ registrationNumber: 'UP32SP0001', position: { lat: 26.45, lng: 80.33 }, seats: 52 }], ownFerryDriverSlotsFree: 2,
  otherDepots: [], busesOnRoute: [], blockEndingBuses: [], cycleMinutes: 135, busesOnRouteNow: 3, nextBusSeatsFree: 22,
  restOfBlock: null, dayKnockOn: null, roadTime,
};
const view: IncidentView = { incident, plan: planReplacement(base) };
const none: IncidentView = { incident: { ...incident, position: null, routeName: null }, plan: planReplacement({ ...base, incident: { ...incident, position: null, routeName: null }, ownSpares: [], cycleMinutes: null, busesOnRouteNow: 0 }) };
const body = (incidents: readonly IncidentView[]): IncidentsResponse => ({
  feedNow: null, fetchedAt: '2026-10-12T10:00:05Z', source: 'live', stale: false, depotId: '7', depotName: 'KANPUR', operatingDate: '2026-10-12',
  incidents, detection: { considered: 40, excluded: { in_yard: 20 }, routesNotProfiled: 3 },
});
const PLACEHOLDER = /\{\{fact:[^}]+\}\}/g;
const prose = (r: CopilotRequest): string => [r.scriptedDraft.headline, ...r.scriptedDraft.paragraphs].join(' ');

const REQUESTS: readonly [string, CopilotRequest][] = [
  ['breakdowns some', breakdownSummaryAnswer(body([view, none]))],
  ['breakdowns none', breakdownSummaryAnswer(body([]))],
  ['replacement', replacementForAnswer(view, 'KANPUR', '7')],
  ['replacement none', replacementForAnswer(none, 'KANPUR', '7')],
  ['rationale', buildReplacementRationale(view, 'KANPUR', '7')],
];

describe('the AI Engine incident answers', () => {
  it.each(REQUESTS)('%s renders through the vocabulary with no digit and no origin word in its prose', (_label, request) => {
    const rendered = renderDraft(request.scriptedDraft, request.facts);
    expect(rendered).toMatchObject({ ok: true });
    expect(prose(request).replace(PLACEHOLDER, ' ')).not.toMatch(/\d/);
    expect(prose(request)).not.toMatch(/\bmodel(led|ling|s)?\b/i);
  });
});

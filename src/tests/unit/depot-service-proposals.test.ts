// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bandLabel, bandsOf, isProposalId, proposalId } from '@/lib/depot/service/bands';
import { buildProposals, primaryOperatorDepot } from '@/lib/depot/service/proposals';
import type { ObservedRouteHour } from '@/lib/depot/service/types';
import { context, DATE, day, depotHour } from './depot-service-proposals.fixtures';

describe('bands and ids', () => {
  it('merges consecutive hours and drops runs shorter than the minimum', () => {
    expect(bandsOf([9, 7, 8, 12, 15, 16], 2)).toEqual([
      { fromHour: 7, toHour: 9 },
      { fromHour: 15, toHour: 16 },
    ]);
    expect(bandsOf([], 2)).toEqual([]);
    expect(bandLabel({ fromHour: 7, toHour: 9 })).toBe('07:00–10:00');
    expect(bandLabel({ fromHour: 22, toHour: 23 })).toBe('22:00–24:00');
  });

  it('makes a deterministic, valid id that changes with any part', () => {
    const band = { fromHour: 7, toHour: 9 };
    const id = proposalId(DATE, 'add_buses', 'R1', band);
    expect(id).toBe(proposalId(DATE, 'add_buses', 'R1', band));
    expect(isProposalId(id)).toBe(true);
    expect(proposalId('2026-10-07', 'add_buses', 'R1', band)).not.toBe(id);
    expect(proposalId(DATE, 'hold_buses', 'R1', band)).not.toBe(id);
    expect(proposalId(DATE, 'add_buses', 'R2', band)).not.toBe(id);
    expect(proposalId(DATE, 'add_buses', 'R1', { fromHour: 7, toHour: 8 })).not.toBe(id);
    expect(isProposalId('p-1234')).toBe(false);
    expect(isProposalId('p-ZZZZZZZZ')).toBe(false);
    expect(isProposalId(42)).toBe(false);
  });
});

describe('add_buses', () => {
  const short = day({ 7: 6, 8: 6, 9: 6, 13: 6 }, { 7: 10, 8: 11, 9: 9, 13: 12 });

  it('proposes a band where the gap meets the threshold for two hours or more', () => {
    const adds = buildProposals(context({ hours: short })).filter((p) => p.kind === 'add_buses');
    expect(adds).toHaveLength(1);
    expect(adds[0]).toMatchObject({
      band: { fromHour: 7, toHour: 9 },
      change: 4,
      deployed: 6,
      needed: 10,
      tier: 'B',
      maybeCoveredByUnrouted: false,
    });
    expect(isProposalId(adds[0]?.id)).toBe(true);
    expect(adds[0]?.impact?.passengersPerDay.high).toBeGreaterThan(0);
  });

  it('needs at least two buses and a fifth of the need', () => {
    // 1 short of 4: under two buses. 2 short of 20: under a fifth.
    const small = day({ 7: 3, 8: 3, 10: 18, 11: 18 }, { 7: 4, 8: 4, 10: 20, 11: 20 });
    expect(buildProposals(context({ hours: small })).filter((p) => p.kind === 'add_buses')).toEqual(
      [],
    );
  });

  it('draws on the yard observed in the hour before the band', () => {
    const [add] = buildProposals(context({ hours: short, depotHours: [depotHour(6)] }));
    expect(add?.source).toEqual({
      depotId: 'D1',
      depotName: 'Charbagh',
      standingInYard: 7,
      basis: 'observed',
    });
    expect(add?.reason).toContain('7 standing in its yard');
  });

  it('falls back to the modelled day plan when the yard was not observed', () => {
    const [add] = buildProposals(
      context({
        hours: short,
        depotHours: [depotHour(6, { slotsObserved: 3 })],
        modelledIdleBuses: 5,
      }),
    );
    expect(add?.source).toMatchObject({
      standingInYard: null,
      basis: 'modelled',
      idleInDayPlan: 5,
    });
    expect(add?.reason).toContain('5 idle in the modelled day plan');
  });

  it('names no source without an operating depot', () => {
    const [add] = buildProposals(context({ hours: short, depot: null }));
    expect(add?.source).toBeNull();
  });

  it('rests on modelled figures only (tier C) when the deployment is modelled too', () => {
    const modelled = day({ 7: 6, 8: 6 }, { 7: 10, 8: 10 }, { deployedBasis: 'modelled' });
    const [add] = buildProposals(context({ hours: modelled }));
    expect(add?.tier).toBe('C');
  });

  it('drops a tier when unrouted buses on the road could cover the gap', () => {
    const depotHours = [depotHour(7, { unroutedOnRoadMean: 5 })];
    const [add] = buildProposals(context({ hours: short, depotHours }));
    expect(add).toMatchObject({ maybeCoveredByUnrouted: true, tier: 'C' });
  });
});

describe('hold_buses', () => {
  it('proposes holding the surplus while keeping a bus and the scheduled supply', () => {
    const quiet = day({ 13: 8, 14: 8, 15: 8 }, { 13: 3, 14: 2, 15: 4 });
    const [hold] = buildProposals(context({ hours: quiet })).filter((p) => p.kind === 'hold_buses');
    expect(hold).toMatchObject({ band: { fromHour: 13, toHour: 15 }, change: -4, tier: 'B' });
    expect(hold?.impact?.busKmPerDay.high).toBeLessThan(0);
  });

  it('never holds below the scheduled bus-hours of the hour', () => {
    const quiet = day({ 13: 8, 14: 8 }, { 13: 2, 14: 2 }).map((h) =>
      h.hour === 13 || h.hour === 14 ? { ...h, scheduled: 6.5 } : h,
    );
    const [hold] = buildProposals(context({ hours: quiet })).filter((p) => p.kind === 'hold_buses');
    expect(hold?.change).toBe(-1);
  });

  it('never holds the last bus', () => {
    const empty = day({ 13: 1, 14: 1 }, { 13: 0, 14: 0 });
    expect(
      buildProposals(context({ hours: empty })).filter((p) => p.kind === 'hold_buses'),
    ).toEqual([]);
  });

  it('needs the surplus for two hours or more', () => {
    const blip = day({ 13: 8 }, { 13: 2 });
    expect(buildProposals(context({ hours: blip })).filter((p) => p.kind === 'hold_buses')).toEqual(
      [],
    );
  });
});

describe('ordering', () => {
  it('puts the larger impact first, then the earlier hour', () => {
    const hours = day(
      { 7: 6, 8: 6, 17: 6, 18: 6, 13: 9, 14: 9 },
      { 7: 9, 8: 9, 17: 14, 18: 14, 13: 3, 14: 3 },
    );
    const kinds = buildProposals(context({ hours })).map((p) => `${p.kind}@${p.band.fromHour}`);
    expect(kinds).toEqual(['add_buses@17', 'add_buses@7', 'hold_buses@13']);
  });
});

describe('primaryOperatorDepot', () => {
  const seen = (hour: number, operators: Record<string, number>): ObservedRouteHour => ({
    routeName: 'R1',
    operatingDate: DATE,
    hour,
    slotsObserved: 12,
    deployedMean: 1,
    deployedMax: 1,
    inServiceMean: 1,
    states: { inService: 1, onRoad: 0, standing: 0, dark: 0, offRoad: 0 },
    delayMedianMin: null,
    lateShare: null,
    delayCoverage: { n: 0, of: 0 },
    operators,
  });

  it('is the depot with the most bus-hours on the route, ties to the lower id', () => {
    expect(primaryOperatorDepot([seen(7, { D2: 3, D1: 1 }), seen(8, { D1: 1 })])).toBe('D2');
    expect(primaryOperatorDepot([seen(7, { D2: 2, D1: 2 })])).toBe('D1');
    expect(primaryOperatorDepot([])).toBeNull();
  });
});

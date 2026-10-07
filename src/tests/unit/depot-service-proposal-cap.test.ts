import { describe, expect, it } from 'vitest';
import { JUDGEMENT_WORDS } from '@/lib/depot/copilot/vocabulary/judgement';
import { capAddsAtStanding } from '@/lib/depot/service/proposalCap';
import type { NeedInputs, Proposal } from '@/lib/depot/service/types';
import { FIXTURE_PROPOSALS, routeHourlyFixture } from './depot-service-fixtures';

const BODY = routeHourlyFixture();
const NEED: NeedInputs = BODY.need;
const ADD = FIXTURE_PROPOSALS.find((p) => p.kind === 'add_buses') as Proposal;

function cap(proposals: readonly Proposal[]): Proposal[] {
  return capAddsAtStanding({ proposals, hours: BODY.hours, need: NEED, lengthKm: 80 });
}

const words = (text: string): string[] => text.toLowerCase().match(/[a-z]+/g) ?? [];

describe('an add capped at the standing pool of its source depot', () => {
  it('leaves an add the yard can cover, a hold and a finding as they are', () => {
    expect(cap(FIXTURE_PROPOSALS)).toEqual(FIXTURE_PROPOSALS);
  });

  it('adds no more buses than stood in the yard, and says fewer stand there than the gap needs', () => {
    const wanting = { ...ADD, change: 9 };
    const [capped] = cap([wanting]);
    expect(capped?.change).toBe(6);
    expect(capped?.reason).toContain('add 6 buses from Alambagh');
    expect(capped?.reason).toContain('Only 6 stand in that yard, fewer than the 9 the gap calls for.');
    expect(capped?.impact?.passengersPerDay.high).toBeGreaterThan(0);
    expect(capped?.id).toBe(ADD.id);
  });

  it('keeps a band no yard bus can serve, with no bus to add and no impact claimed', () => {
    const none = {
      ...ADD,
      change: 4,
      source: { ...ADD.source!, standingInYard: 0 },
    };
    const [capped] = cap([none]);
    expect(capped?.change).toBe(0);
    expect(capped?.impact).toBeNull();
    expect(capped?.reason).toContain('Alambagh had none standing in its yard the hour before');
  });

  it('never caps an add whose source is the modelled day plan', () => {
    const modelled = {
      ...ADD,
      change: 9,
      source: { ...ADD.source!, basis: 'modelled' as const, standingInYard: null, idleInDayPlan: 2 },
    };
    expect(cap([modelled])).toEqual([modelled]);
  });

  it('writes no judgement word', () => {
    const banned = new Set(JUDGEMENT_WORDS);
    for (const p of cap([{ ...ADD, change: 9 }, { ...ADD, source: { ...ADD.source!, standingInYard: 0 } }])) {
      expect(words(p.reason).filter((w) => banned.has(w))).toEqual([]);
    }
  });

  it('orders by passengers carried again once an add is capped', () => {
    const big = { ...ADD, id: 'p-big', change: 9 };
    const small = { ...ADD, id: 'p-small', band: { fromHour: 15, toHour: 16 }, change: 2 };
    const ordered = cap([big, small]);
    const carried = ordered.map((p) => p.impact?.passengersPerDay.high ?? 0);
    expect([...carried].sort((a, b) => b - a)).toEqual(carried);
  });
});

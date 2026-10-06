// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildProposals } from '@/lib/depot/service/proposals';
import { proposalReason } from '@/lib/depot/service/proposalReasons';
import { timetableFindings } from '@/lib/depot/service/timetableFindings';
import type { Proposal, ProposalKind } from '@/lib/depot/service/types';
import { JUDGEMENT_WORDS } from '@/lib/depot/copilot/vocabulary/judgement';
import { context, day, depotHour, hour, journey } from './depot-service-proposals.fixtures';

const kinds = (ps: readonly Proposal[], kind: ProposalKind): Proposal[] =>
  ps.filter((p) => p.kind === kind);

describe('trips_not_run', () => {
  it('finds scheduled journeys long past their time with no actual start, banded by start hour', () => {
    const ledger = [
      journey('a', { scheduledStart: '09:10', actualStart: null }),
      journey('b', { scheduledStart: '10:20', actualStart: null }),
      journey('c', { scheduledStart: '11:40', actualStart: null }), // only 20 min past 12:00
      journey('d', { scheduledStart: '09:30' }), // ran
      journey('e', { scheduledStart: null, actualStart: null }),
    ];
    const found = kinds(
      timetableFindings(context({ ledger, feedMinute: 12 * 60 })),
      'trips_not_run',
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      band: { fromHour: 9, toHour: 10 },
      tier: 'A',
      change: 0,
      impact: null,
    });
    expect(found[0]?.reason).toContain('2 scheduled journeys');
  });

  it('says nothing without a feed clock', () => {
    const ledger = [journey('a', { scheduledStart: '09:10', actualStart: null })];
    expect(
      kinds(timetableFindings(context({ ledger, feedMinute: null })), 'trips_not_run'),
    ).toEqual([]);
  });
});

describe('service_span_gap', () => {
  // Demand from 06 to 21; journeys known from 08:00 to 18:45.
  const hours = day({}, {}).map((h) => ({ ...h, demand: h.hour >= 6 && h.hour <= 21 ? 100 : 0 }));
  const ledger = [
    journey('a', { scheduledStart: '08:00', scheduledEnd: '09:45' }),
    journey('b', { scheduledStart: '12:00', scheduledEnd: '13:45' }),
    journey('c', { scheduledStart: '17:00', scheduledEnd: '18:45' }),
  ];

  it('finds demand before the first scheduled start and after the last scheduled end', () => {
    const found = kinds(timetableFindings(context({ hours, ledger })), 'service_span_gap');
    expect(found.map((p) => p.band)).toEqual([
      { fromHour: 6, toHour: 7 },
      { fromHour: 19, toHour: 21 },
    ]);
    expect(found.every((p) => p.tier === 'A')).toBe(true);
  });

  it('needs a few journeys before judging the span', () => {
    expect(
      kinds(timetableFindings(context({ hours, ledger: ledger.slice(0, 2) })), 'service_span_gap'),
    ).toEqual([]);
  });
});

describe('headway_gap', () => {
  it('finds daytime hours with demand and no start between two starts an hour or more apart', () => {
    const ledger = ['06:10', '07:00', '07:40', '10:30', '11:00', '23:00'].map((s, i) =>
      journey(`j${i}`, { scheduledStart: s, scheduledEnd: null }),
    );
    const hours = day({}, {}).map((h) => ({ ...h, demand: 50 }));
    const found = kinds(timetableFindings(context({ hours, ledger })), 'headway_gap');
    expect(found.map((p) => p.band)).toEqual([
      { fromHour: 8, toHour: 9 },
      { fromHour: 12, toHour: 21 },
    ]);
    expect(found[0]?.reason).toContain('07:40');
    expect(found[0]?.reason).toContain('10:30');
  });
});

describe('revise_running_time', () => {
  it('finds three or more hours running late with enough journeys behind each median', () => {
    const late = (start: string, id: string, delay: number) =>
      journey(id, { scheduledStart: start, delayMinutes: delay });
    const ledger = [8, 9, 10].flatMap((h) =>
      [14, 16, 18].map((d, i) => late(`${String(h).padStart(2, '0')}:1${i}`, `${h}-${i}`, d)),
    );
    const thin = [late('15:00', 't1', 30), late('16:00', 't2', 30), late('17:00', 't3', 30)];
    const found = kinds(
      timetableFindings(context({ ledger: [...ledger, ...thin] })),
      'revise_running_time',
    );
    expect(found.map((p) => p.band)).toEqual([{ fromHour: 8, toHour: 10 }]);
    expect(found[0]?.reason).toContain('16');
  });
});

describe('every reason', () => {
  const banned = new Set([...JUDGEMENT_WORDS, 'simulated', 'simulation']);
  const wordsOf = (s: string): string[] => s.toLowerCase().match(/[a-z]+/g) ?? [];

  it('uses no judgement or person word and never says simulated, in every form', () => {
    const shortDay = day({ 7: 6, 8: 6, 13: 9, 14: 9 }, { 7: 10, 8: 10, 13: 2, 14: 2 }).map((h) =>
      hour(h.hour, h.deployed, h.needed, { demand: h.hour >= 6 && h.hour <= 21 ? 300 : 0 }),
    );
    const ledger = [
      journey('a', { scheduledStart: '09:00', actualStart: null, delayMinutes: null }),
      journey('b', { scheduledStart: '10:00', scheduledEnd: '11:45' }),
      journey('c', { scheduledStart: '15:00', scheduledEnd: '16:45' }),
    ];
    const contexts = [
      context({ hours: shortDay, ledger, depotHours: [depotHour(6)] }),
      context({ hours: shortDay, ledger, modelledIdleBuses: 4 }),
      context({ hours: shortDay, ledger, depot: null }),
    ];
    const reasons = contexts.flatMap((c) => buildProposals(c).map((p) => p.reason));
    expect(
      new Set(contexts.flatMap((c) => buildProposals(c).map((p) => p.kind))).size,
    ).toBeGreaterThanOrEqual(5);
    for (const reason of reasons) {
      expect(wordsOf(reason).filter((w) => banned.has(w))).toEqual([]);
    }
  });

  it('is one sentence', () => {
    const r = proposalReason({
      kind: 'headway_gap',
      band: { fromHour: 8, toHour: 9 },
      from: '07:40',
      to: '10:30',
      minutes: 170,
      demand: 100,
    });
    expect(r.endsWith('.')).toBe(true);
    expect(r.slice(0, -1)).not.toMatch(/\.\s/);
  });
});

import { describe, expect, it } from 'vitest';
import { DEI_COMPONENTS, MIN_FLEET_FOR_RANK, MIN_PEER_GROUP } from '@/lib/depot/score/config';
import { componentValues, scoreDepots } from '@/lib/depot/score/dei';
import { assignPeerGroups } from '@/lib/depot/score/peerGroups';
import type { DepotKind, DepotSummary, StateMix } from '@/lib/depot/types';

interface Spec {
  readonly id: string;
  readonly fleet?: number;
  readonly kind?: DepotKind;
  readonly states?: Partial<StateMix>;
  readonly assigned?: number;
  readonly powerCut?: number;
  readonly tamperFlagged?: number;
}

/** Builds a depot whose states sum to its fleet; `standing` absorbs the remainder. */
function depot(spec: Spec): DepotSummary {
  const fleet = spec.fleet ?? 100;
  const given = { inService: 0, onRoad: 0, dark: 0, offRoad: 0, ...spec.states };
  const used = given.inService + given.onRoad + given.dark + given.offRoad;
  return {
    id: spec.id,
    name: spec.id,
    kind: spec.kind ?? 'depot',
    fleet,
    status: { live: 0, stationary: 0, noSignal: 0, underMaintenance: 0, unknown: 0 },
    states: { ...given, standing: fleet - used },
    reporting: 0,
    positioned: 0,
    assigned: spec.assigned ?? 0,
    powerCut: spec.powerCut ?? 0,
    tamperFlagged: spec.tamperFlagged ?? 0,
    centroid: null,
  };
}

/** Twelve ordinary depots of one size band with spread-out behaviour. */
function peers(): DepotSummary[] {
  return Array.from({ length: 12 }, (_, i) =>
    depot({
      id: `p${String(i).padStart(2, '0')}`,
      fleet: 100 + i,
      states: { inService: 20 + i, onRoad: 10 + (i % 4), dark: 5 + (i % 5), offRoad: 3 + (i % 3) },
      assigned: 40 + 2 * i,
      powerCut: i % 4,
      tamperFlagged: i % 3,
    }),
  );
}

describe('config', () => {
  it('weights sum to exactly 1', () => {
    const total = DEI_COMPONENTS.reduce((sum, c) => sum + c.weight, 0);
    expect(Math.abs(total - 1)).toBeLessThan(1e-12);
    expect(total).toBe(1);
  });
});

describe('componentValues', () => {
  it('computes each rate from the depot counts', () => {
    const d = depot({
      id: 'a',
      fleet: 100,
      states: { inService: 30, onRoad: 20, dark: 10, offRoad: 20 },
      assigned: 40,
      powerCut: 5,
      tamperFlagged: 5,
    });
    const v = componentValues(d);
    expect(v.onRoad).toBeCloseTo(50 / 80, 12);
    expect(v.offRoad).toBe(0.2);
    expect(v.dark).toBe(0.1);
    expect(v.scheduled).toBe(0.4);
    expect(v.deviceHealth).toBe(0.9);
  });
  it('is null where the denominator is zero and floors device health at 0', () => {
    const allOff = depot({ id: 'a', fleet: 10, states: { offRoad: 10 } });
    expect(componentValues(allOff).onRoad).toBeNull();
    const broken = depot({ id: 'b', fleet: 10, powerCut: 8, tamperFlagged: 8 });
    expect(componentValues(broken).deviceHealth).toBe(0);
    const empty = depot({ id: 'c', fleet: 0 });
    expect(componentValues(empty).deviceHealth).toBeNull();
    expect(componentValues(empty).dark).toBeNull();
  });
});

describe('assignPeerGroups', () => {
  it('splits rankable depots into fleet-size terciles', () => {
    const depots = Array.from({ length: 15 }, (_, i) => depot({ id: `d${i}`, fleet: 50 + i * 10 }));
    const groups = assignPeerGroups(depots);
    expect(groups.get('d0')).toBe('small');
    expect(groups.get('d4')).toBe('small');
    expect(groups.get('d5')).toBe('medium');
    expect(groups.get('d9')).toBe('medium');
    expect(groups.get('d10')).toBe('large');
    expect(groups.get('d14')).toBe('large');
  });
  it('collapses to one group when any tercile is under MIN_PEER_GROUP', () => {
    const depots = Array.from({ length: 6 }, (_, i) => depot({ id: `d${i}`, fleet: 50 + i * 10 }));
    expect(MIN_PEER_GROUP).toBeGreaterThan(2);
    const groups = assignPeerGroups(depots);
    expect([...groups.values()].every((g) => g === 'all')).toBe(true);
    expect(groups.size).toBe(6);
  });
  it('leaves unrankable depots out', () => {
    const groups = assignPeerGroups([
      depot({ id: 'tiny', fleet: MIN_FLEET_FOR_RANK - 1 }),
      depot({ id: 'sq', kind: 'enforcement', fleet: 500 }),
      depot({ id: 'ok', fleet: 100 }),
    ]);
    expect([...groups.keys()]).toEqual(['ok']);
  });
  it('does not mutate its input', () => {
    const input = Object.freeze(peers().map((d) => Object.freeze(d)));
    assignPeerGroups(input);
    expect(input.map((d) => d.id)).toEqual(peers().map((d) => d.id));
  });
});

describe('scoreDepots', () => {
  it('scores a depot identical to its peer median exactly 50', () => {
    const same = Array.from({ length: 11 }, (_, i) =>
      depot({
        id: `s${i}`,
        states: { inService: 30 + i - 5, onRoad: 10, dark: 10, offRoad: 5 },
        assigned: 50,
      }),
    );
    // Every depot but the 6th differs on onRoad only; the median depot sits in the middle.
    const scores = scoreDepots(same);
    const middle = scores.find((s) => s.depotId === 's5');
    expect(middle?.index).toBe(50);
  });

  it('gives every depot 50, and no NaN, when the peer group is all identical', () => {
    const clones = Array.from({ length: 12 }, (_, i) =>
      depot({ id: `c${i}`, states: { inService: 30, dark: 10, offRoad: 5 }, assigned: 40 }),
    );
    for (const s of scoreDepots(clones)) {
      expect(s.index).toBe(50);
      for (const c of s.components) {
        expect(c.z).toBe(0);
        expect(Number.isFinite(c.contribution)).toBe(true);
        expect(Object.is(c.contribution, -0)).toBe(false);
      }
    }
  });

  it('keeps the index within 0 to 100 at one decimal', () => {
    const outlier = depot({ id: 'zz', states: { dark: 100 }, powerCut: 100 });
    for (const s of scoreDepots([...peers(), outlier])) {
      expect(s.index).not.toBeNull();
      expect(s.index as number).toBeGreaterThanOrEqual(0);
      expect(s.index as number).toBeLessThanOrEqual(100);
      expect(Math.round((s.index as number) * 10) / 10).toBe(s.index);
    }
  });

  it('never lowers the index when only onRoad rises', () => {
    const base = peers();
    let previous = -Infinity;
    for (let extra = 0; extra <= 40; extra += 2) {
      // Moving standing buses onto the road changes onRoad and nothing else.
      const target = depot({
        id: 'target',
        fleet: 105,
        states: { inService: 15, onRoad: 5 + extra, dark: 6, offRoad: 4 },
        assigned: 60,
        powerCut: 1,
        tamperFlagged: 1,
      });
      const score = scoreDepots([...base, target]).find((s) => s.depotId === 'target');
      expect(score?.index as number).toBeGreaterThanOrEqual(previous);
      previous = score?.index as number;
    }
  });

  it('never raises the index when only dark rises', () => {
    const base = peers();
    let previous = Infinity;
    for (let dark = 0; dark <= 40; dark += 2) {
      const target = depot({
        id: 'target',
        fleet: 105,
        states: { inService: 15, onRoad: 15, dark, offRoad: 4 },
        assigned: 60,
        powerCut: 1,
        tamperFlagged: 1,
      });
      const score = scoreDepots([...base, target]).find((s) => s.depotId === 'target');
      expect(score?.index as number).toBeLessThanOrEqual(previous);
      previous = score?.index as number;
    }
  });

  it('is unranked below MIN_FLEET_FOR_RANK but keeps raw component values', () => {
    const small = depot({
      id: 'small',
      fleet: MIN_FLEET_FOR_RANK - 1,
      states: { inService: 3 },
      assigned: 2,
    });
    const [score] = scoreDepots([small, ...peers()]);
    expect(score.ranked).toBe(false);
    expect(score.reason).toBe('fleet_too_small');
    expect(score.index).toBeNull();
    expect(score.rank).toBeNull();
    expect(score.peerGroup).toBeNull();
    const onRoad = score.components.find((c) => c.key === 'onRoad');
    expect(onRoad?.value).toBeCloseTo(3 / (MIN_FLEET_FOR_RANK - 1), 12);
    expect(onRoad?.z).toBeNull();
    expect(onRoad?.contribution).toBe(0);
    expect(score.components.map((c) => c.key)).toEqual(DEI_COMPONENTS.map((c) => c.key));
  });

  it('never ranks non-depot kinds', () => {
    const squad = depot({ id: 'sq', kind: 'enforcement', fleet: 300 });
    const [score] = scoreDepots([squad, ...peers()]);
    expect(score.reason).toBe('not_a_depot');
    expect(score.ranked).toBe(false);
    expect(score.index).toBeNull();
  });

  it('ranks by index descending and breaks ties by depot id', () => {
    const clones = ['d', 'b', 'a', 'c', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map((id) =>
      depot({ id, states: { inService: 30 } }),
    );
    const byId = new Map(scoreDepots(clones).map((s) => [s.depotId, s]));
    expect(byId.get('a')?.rank).toBe(1);
    expect(byId.get('b')?.rank).toBe(2);
    expect(byId.get('l')?.rank).toBe(12);
    expect(byId.get('a')?.peerCount).toBe(12);

    const scored = scoreDepots(peers());
    const ordered = [...scored].sort((a, b) => (a.rank as number) - (b.rank as number));
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i - 1].index as number).toBeGreaterThanOrEqual(ordered[i].index as number);
    }
  });

  it('puts every depot in one group when a tercile is too small', () => {
    const few = peers().slice(0, 6);
    const scores = scoreDepots(few);
    expect(scores.every((s) => s.peerGroup === 'all')).toBe(true);
    expect(scores.every((s) => s.peerCount === 6)).toBe(true);
  });

  it('gives each depot the same score, rank and group for a shuffled copy', () => {
    const input = [...peers(), depot({ id: 'sq', kind: 'hired' }), depot({ id: 'tiny', fleet: 3 })];
    const shuffled = [...input].reverse().sort((a, b) => (a.id.charCodeAt(1) % 3) - (b.id.charCodeAt(1) % 3));
    expect(shuffled.map((d) => d.id)).not.toEqual(input.map((d) => d.id));
    const byId = (list: readonly DepotSummary[]) =>
      new Map(scoreDepots(list).map((s) => [s.depotId, s]));
    const a = byId(input);
    const b = byId(shuffled);
    for (const [id, score] of a) expect(b.get(id)).toEqual(score);
  });

  it('does not mutate its input', () => {
    const input = Object.freeze(peers().map((d) => Object.freeze(d)));
    const before = JSON.stringify(input);
    scoreDepots(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('returns one score per depot, in input order', () => {
    const input = peers();
    expect(scoreDepots(input).map((s) => s.depotId)).toEqual(input.map((d) => d.id));
  });
});

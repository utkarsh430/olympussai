import { describe, expect, it } from 'vitest';
import {
  LOWEST_OPERATING_LABEL,
  depotLink,
  lowestOperatingDepot,
  markerLabel,
  peerRankLine,
  positionNote,
  unpositionedSentence,
} from '@/lib/depot/network/mapWords';
import { joinScores, type DepotRow } from '@/lib/depot/network/overviewModel';
import type { DepotKind, DepotSummary } from '@/lib/depot/types';
import type { DepotScore, RankReason } from '@/lib/depot/score/types';

function depot(id: string, overrides: Partial<DepotSummary> = {}): DepotSummary {
  return {
    id,
    name: id.toUpperCase(),
    kind: 'depot',
    fleet: 200,
    status: { live: 20, stationary: 10, noSignal: 5, underMaintenance: 5, unknown: 0 },
    states: { inService: 15, onRoad: 5, standing: 10, dark: 5, offRoad: 5 },
    reporting: 35,
    positioned: 35,
    assigned: 20,
    powerCut: 0,
    tamperFlagged: 0,
    centroid: { lat: 26.8, lng: 80.9 },
    ...overrides,
  };
}

function score(depotId: string, index: number | null, reason: RankReason = 'ok'): DepotScore {
  const ranked = reason === 'ok' && index !== null;
  return {
    depotId,
    peerGroup: ranked ? 'small' : null,
    ranked,
    reason,
    index,
    rank: ranked ? 1 : null,
    peerCount: ranked ? 41 : null,
    components: [],
  };
}

function row(id: string, index: number | null, kind: DepotKind = 'depot', reason?: RankReason): DepotRow {
  const [joined] = joinScores([depot(id, { kind })], [score(id, index, reason)]);
  return joined!;
}

describe('markerLabel', () => {
  it('names the depot, its fleet and its index', () => {
    expect(markerLabel(row('kaushambi', 68.1))).toBe('KAUSHAMBI, 200 buses, index 68.1');
  });

  it('says why a depot has no index, and uses "bus" for one', () => {
    const small = joinScores([depot('tiny', { fleet: 1 })], [score('tiny', null, 'fleet_too_small')])[0]!;
    expect(markerLabel(small)).toBe('TINY, 1 bus, not ranked: Fewer than 10 buses');
  });
});

describe('positionNote', () => {
  it('says where the node is drawn', () => {
    expect(positionNote(depot('a'))).toBe('Position: median of 35 positioned buses (derived)');
    expect(positionNote(depot('a', { positioned: 1 }))).toBe(
      'Position: median of 1 positioned bus (derived)',
    );
  });

  it('says the depot is not on the map when no bus is positioned', () => {
    expect(positionNote(depot('a', { positioned: 0, centroid: null }))).toBe(
      'No positioned buses; not drawn on the map',
    );
  });
});

describe('lowestOperatingDepot', () => {
  it('picks the ranked operating depot with the lowest index', () => {
    const rows = [row('a', 40), row('b', 12.5), row('c', 80), row('enf', 5, 'enforcement')];
    expect(lowestOperatingDepot(rows)?.depot.id).toBe('b');
    expect(LOWEST_OPERATING_LABEL).toBe('Lowest index among operating depots');
  });

  it('breaks ties on the smaller id and returns null when nothing is ranked', () => {
    expect(lowestOperatingDepot([row('z', 10), row('m', 10)])?.depot.id).toBe('m');
    expect(lowestOperatingDepot([row('a', null, 'depot', 'fleet_too_small')])).toBeNull();
  });
});

describe('depotLink', () => {
  it('links operating depots and the other real fleets into the depot scope', () => {
    expect(depotLink(depot('kaushambi'))).toBe('/project/depots/d/kaushambi');
    expect(depotLink(depot('hired-1', { kind: 'hired' }))).toBe('/project/depots/d/hired-1');
  });

  it('never links the unassigned bucket', () => {
    expect(depotLink(depot('unassigned', { kind: 'unassigned' }))).toBeNull();
  });
});

describe('unpositionedSentence', () => {
  it('counts units that are not on the map', () => {
    expect(unpositionedSentence(0)).toBe('Every unit has at least one positioned bus.');
    expect(unpositionedSentence(1)).toBe('1 unit has no positioned buses and is not on the map.');
    expect(unpositionedSentence(3)).toBe('3 units have no positioned buses and are not on the map.');
  });
});

describe('peerRankLine', () => {
  it('says the rank is within the peer group, so the count is not read as all depots', () => {
    expect(peerRankLine(1, 41, 'small')).toBe('Rank 1 of 41 in its peer group (Small fleets)');
  });
});

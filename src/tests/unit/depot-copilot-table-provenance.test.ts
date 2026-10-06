// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildDepotDetail } from '@/lib/depot/live/depotView';
import { buildDistributionResponse } from '@/lib/depot/live/distributionView';
import { buildNetworkResponse } from '@/lib/depot/live/networkView';
import { buildAnswer } from '@/lib/depot/copilot/facts/answers';
import { answerTable } from '@/lib/depot/copilot/service/interpret';
import { DEPOT_MEASURES, type CopilotQuery } from '@/lib/depot/copilot/queries';
import type { CopilotFact } from '@/lib/depot/copilot/types';
import type { CopilotAnswerTable } from '@/lib/depot/copilot/wire';

const rows = normalizeDepotRows(liveFixture).rows;
const view: FleetSnapshotView = {
  rows,
  feedNow: deriveFeedNow(rows),
  fetchedAt: '2026-10-06T08:00:05.000Z',
  source: 'live',
  stale: false,
  recordCount: rows.length,
};

const METRICS = ['index', 'onRoad', 'offRoad', 'dark', 'scheduled'] as const;

/** One query of every kind the router can produce, about the fixture's first two depots. */
function everyQuery(a: string, b: string): CopilotQuery[] {
  return [
    { kind: 'networkSummary' },
    { kind: 'depotSummary', depotId: a },
    ...DEPOT_MEASURES.map((measure): CopilotQuery => ({
      kind: 'depotMeasure',
      depotId: a,
      measure,
    })),
    ...METRICS.flatMap((metric) =>
      (['top', 'bottom'] as const).map((order): CopilotQuery => ({
        kind: 'rankDepots',
        metric,
        order,
        limit: 5,
      })),
    ),
    { kind: 'depotsInDeficit' },
    { kind: 'depotsInSurplus' },
    { kind: 'transfersFor', depotId: a },
    { kind: 'exceptionsFor', depotId: a },
    { kind: 'compareDepots', depotA: a, depotB: b },
    { kind: 'outshedStatus', depotId: a },
    { kind: 'unsupported' },
  ];
}

function tablesFor(): { query: CopilotQuery; table: CopilotAnswerTable }[] {
  const network = buildNetworkResponse(view);
  const [a, b] = network.depots.map((d) => d.id);
  if (a === undefined || b === undefined) throw new Error('fixture needs two depots');
  const details = Object.fromEntries(
    [a, b].flatMap((id) => {
      const detail = buildDepotDetail(view, id);
      return detail ? [[id, detail] as const] : [];
    }),
  );
  const data = { network, details, distribution: buildDistributionResponse(view) };
  return everyQuery(a, b).flatMap((query) => {
    const table = answerTable(query, buildAnswer(query, data).facts);
    return table ? [{ query, table }] : [];
  });
}

/** Facts shaped as a list answer: names, then one figure per row, of the given provenance. */
function listFacts(prefix: string, key: string, provenance: CopilotFact['provenance']) {
  return [1, 2].flatMap((n): CopilotFact[] => [
    { id: `${prefix}.${n}.name`, label: 'Depot', text: `D${n}`, provenance: 'live', kind: 'name' },
    { id: `${prefix}.${n}.${key}`, label: 'Value', text: String(n), provenance },
  ]);
}

beforeEach(() => resetAnalysisForTests());

describe('answer table column provenance', () => {
  it("every answer kind's table tags each figure column and leaves the name column unset", () => {
    const tables = tablesFor();
    expect(tables.some(({ query }) => query.kind === 'rankDepots')).toBe(true);
    for (const { table } of tables) {
      expect(table.provenance).toHaveLength(table.columns.length);
      expect(table.provenance?.[0]).toBeNull();
      expect(table.provenance?.slice(1).every((p) => p !== null)).toBe(true);
    }
  });

  it('rankings say derived', () => {
    for (const { query, table } of tablesFor()) {
      if (query.kind === 'rankDepots') expect(table.provenance).toEqual([null, 'derived']);
    }
  });

  it('shortfall and surplus, built from the modelled requirement, say modelled', () => {
    for (const { query, table } of tablesFor()) {
      if (query.kind === 'depotsInDeficit' || query.kind === 'depotsInSurplus') {
        expect(table.provenance).toEqual([null, 'modelled']);
      }
    }
    for (const kind of ['depotsInDeficit', 'depotsInSurplus'] as const) {
      const table = answerTable({ kind }, listFacts('list', 'size', 'modelled'));
      expect(table?.provenance).toEqual([null, 'modelled']);
    }
  });

  it("takes the column's provenance from its facts, the most qualified when they differ", () => {
    const facts = listFacts('rank', 'value', 'derived');
    const mixed = facts.map((f) =>
      f.id === 'rank.2.value' ? { ...f, provenance: 'modelled' as const } : f,
    );
    const query: CopilotQuery = { kind: 'rankDepots', metric: 'index', order: 'top', limit: 5 };
    expect(answerTable(query, facts)?.provenance).toEqual([null, 'derived']);
    expect(answerTable(query, mixed)?.provenance).toEqual([null, 'modelled']);
  });
});

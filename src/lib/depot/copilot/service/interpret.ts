import type { CopilotQuery, DepotMeasure, RankMetric } from '@/lib/depot/copilot/queries';
import { cleanName } from '@/lib/depot/copilot/facts/format';
import type { CopilotFact } from '@/lib/depot/copilot/types';
import type { CopilotAnswerTable } from '@/lib/depot/copilot/wire';
import type { Provenance } from '@/lib/depot/types';

/**
 * The "interpreted as" line and the result table for an answered question.
 * Both are built from the typed query and the server's own facts, never from
 * the question's text, so nothing the user typed is echoed back.
 */

const METRIC_LABEL: Readonly<Record<RankMetric, string>> = {
  index: 'Efficiency index',
  onRoad: 'On-road share',
  offRoad: 'Off-road rate',
  dark: 'Dark rate',
  scheduled: 'Schedule coverage',
};

/** What a one-measure question was understood to ask, before the depot's name. */
const MEASURE_LABEL: Readonly<Record<DepotMeasure, (name: string) => string>> = {
  dark: (name) => `Buses that are dark at ${name}`,
  offRoad: (name) => `Buses that are off the road at ${name}`,
  powerCut: (name) => `Buses with main power off at ${name}`,
  inYard: (name) => `Buses in the yard at ${name}`,
  onRoad: (name) => `Buses on the road at ${name}`,
  standing: (name) => `Buses standing at ${name}`,
  fleet: (name) => `The fleet size of ${name}`,
  index: (name) => `The efficiency index of ${name}`,
  rank: (name) => `The rank of ${name} among its peers`,
  visitors: (name) => `Visiting buses in the yard at ${name}`,
};

export function interpretQuery(query: CopilotQuery, nameOf: (depotId: string) => string): string {
  const name = (id: string): string => cleanName(nameOf(id));
  switch (query.kind) {
    case 'networkSummary':
      return 'A summary of the whole network';
    case 'depotSummary':
      return `A summary of ${name(query.depotId)}`;
    case 'depotMeasure':
      return MEASURE_LABEL[query.measure](name(query.depotId));
    case 'rankDepots':
      return `Depots by ${METRIC_LABEL[query.metric].toLowerCase()}, ${
        query.order === 'top' ? 'highest' : 'lowest'
      } first, up to ${query.limit}`;
    case 'depotsInDeficit':
      return 'Depots in deficit on the modelled requirement';
    case 'depotsInSurplus':
      return 'Depots in surplus on the modelled requirement';
    case 'transfersFor':
      return `Proposed transfers involving ${name(query.depotId)}`;
    case 'exceptionsFor':
      return `Exceptions at ${name(query.depotId)}`;
    case 'compareDepots':
      return `A comparison of ${name(query.depotA)} and ${name(query.depotB)}`;
    case 'outshedStatus':
      return `Departures from the yard at ${name(query.depotId)}`;
    case 'unsupported':
      return 'A question outside what can be answered here';
  }
}

/** Most qualified first: a column mixing kinds of figure is labelled by the least measured. */
const PROVENANCE_ORDER: readonly Provenance[] = ['modelled', 'derived', 'reference', 'live'];

interface ListColumns {
  readonly rows: readonly (readonly string[])[];
  /** The figure column's provenance, from the facts that fill it; null when no row exists. */
  readonly valueProvenance: Provenance | null;
}

/** Rows `<prefix>.<n>.name` and `<prefix>.<n>.<valueKey>`, in order, while both exist. */
function rowsFrom(facts: readonly CopilotFact[], prefix: string, valueKey: string): ListColumns {
  const byId = new Map(facts.map((f) => [f.id, f] as const));
  const rows: (readonly string[])[] = [];
  const seen = new Set<Provenance>();
  for (let n = 1; ; n += 1) {
    const name = byId.get(`${prefix}.${n}.name`);
    const value = byId.get(`${prefix}.${n}.${valueKey}`);
    if (name === undefined || value === undefined) {
      return { rows, valueProvenance: PROVENANCE_ORDER.find((p) => seen.has(p)) ?? null };
    }
    rows.push([name.text, value.text]);
    seen.add(value.provenance);
  }
}

/** A depot-name column (not a figure, so no provenance) beside one figure column. */
function nameAndFigure(heading: string, list: ListColumns): CopilotAnswerTable {
  return {
    columns: ['Depot', heading],
    rows: list.rows,
    provenance: [null, list.valueProvenance],
  };
}

/** A table for the list queries; none for a single answer or an empty list. */
export function answerTable(
  query: CopilotQuery,
  facts: readonly CopilotFact[],
): CopilotAnswerTable | undefined {
  let table: CopilotAnswerTable | undefined;
  if (query.kind === 'rankDepots') {
    table = nameAndFigure(METRIC_LABEL[query.metric], rowsFrom(facts, 'rank', 'value'));
  } else if (query.kind === 'depotsInDeficit') {
    table = nameAndFigure('Short by', rowsFrom(facts, 'list', 'size'));
  } else if (query.kind === 'depotsInSurplus') {
    table = nameAndFigure('Spare', rowsFrom(facts, 'list', 'size'));
  }
  return table && table.rows.length > 0 ? table : undefined;
}

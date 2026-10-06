import { compareText } from '../fuel/compare';
import { MIN_PEER_GROUP } from '../score/config';
import { isRankable, peerGroupClassifier } from '../score/peerGroups';
import type { Coverage } from '../types';
import {
  COMPONENTS,
  indexFrom,
  medianOf,
  missingOf,
  safeCoverage,
  scoreComponents,
  valuesOf,
  type Values,
} from './economicsComponents';
import type {
  DepotEconomicsScore,
  EconomicsComponent,
  EconomicsInput,
  EconomicsRankReason,
} from './types';

/*
 * The Depot Economics Index (MODELLED): who is ranked, within which peer group,
 * and in what order. It is scored with the efficiency index's peer groups and
 * robust statistics, but it is a separate module with a separate result type: a
 * modelled economic figure never enters the Depot Efficiency Index, and nothing
 * under score/ imports this file.
 */

type Standing = 'eligible' | 'missing_component';

/** Ruling S39: route coverage is no gate; only a missing component sets a depot aside. */
function standingOf(values: Values): Standing {
  return missingOf(values).length > 0 ? 'missing_component' : 'eligible';
}

function unrankedReason(input: Readonly<EconomicsInput>, standing: Standing): EconomicsRankReason {
  if (input.depot.kind !== 'depot') return 'not_a_depot';
  if (!isRankable(input.depot)) return 'fleet_too_small';
  return standing === 'eligible' ? 'peer_group_too_small' : standing;
}

/**
 * Scores depots (kind depot only) against peers of similar fleet size. A
 * depot missing a component is set aside and says why; how many of its route
 * lengths are real is carried as a coverage figure and never withholds a
 * rank. The peer groups are drawn over the complete depots only, with
 * the efficiency index's rule: a fleet-size tercile thinner than
 * MIN_PEER_GROUP merges everyone into one group, so missing components never
 * leave a thin tercile unranked. A group still under MIN_PEER_GROUP (too few
 * complete depots in all) is unranked as peer_group_too_small: a rank among
 * two or three depots is not a rank. A set-aside depot is shown the group its
 * fleet size falls in. Output follows the input order; a result never depends
 * on it.
 */
export function scoreEconomics(inputs: readonly EconomicsInput[]): DepotEconomicsScore[] {
  const values = new Map(inputs.map((i) => [i.depot.id, valuesOf(i)] as const));
  const standings = new Map(
    inputs.map((i) => [i.depot.id, standingOf(values.get(i.depot.id) as Values)] as const),
  );
  const classify = peerGroupClassifier(
    inputs.filter((i) => standings.get(i.depot.id) === 'eligible').map((i) => i.depot),
  );
  const groups = new Map(
    inputs.flatMap((i) =>
      classify !== null && isRankable(i.depot) ? [[i.depot.id, classify(i.depot.fleet)] as const] : [],
    ),
  );
  const eligible = new Map<string, string[]>();
  for (const [id, group] of groups) {
    if (standings.get(id) === 'eligible') eligible.set(group, [...(eligible.get(group) ?? []), id]);
  }
  const sampleOf = (group: string | null): Values[] =>
    group === null ? [] : (eligible.get(group) ?? []).map((id) => values.get(id) as Values);
  const coverageOf = new Map(inputs.map((i) => [i.depot.id, safeCoverage(i.lengthCoverage)] as const));

  const scored = new Map<string, { components: EconomicsComponent[]; index: number }>();
  const rankOf = new Map<string, number>();
  for (const [group, ids] of eligible) {
    if (ids.length < MIN_PEER_GROUP) continue;
    for (const id of ids) {
      const components = scoreComponents(
        values.get(id) as Values,
        sampleOf(group),
        coverageOf.get(id) as Coverage,
      );
      scored.set(id, { components, index: indexFrom(components) });
    }
    [...ids]
      .sort((a, b) => (scored.get(b)?.index ?? 0) - (scored.get(a)?.index ?? 0) || compareText(a, b))
      .forEach((id, i) => rankOf.set(id, i + 1));
  }

  return inputs.map((input): DepotEconomicsScore => {
    const id = input.depot.id;
    const own = values.get(id) as Values;
    const group = groups.get(id) ?? null;
    const result = scored.get(id);
    if (result === undefined) {
      const sample = sampleOf(group);
      return {
        depotId: id,
        peerGroup: group,
        ranked: false,
        reason: unrankedReason(input, standings.get(id) as Standing),
        missing: missingOf(own),
        economicsIndex: null,
        rank: null,
        peerCount: null,
        components: COMPONENTS.map((c) => ({
          key: c.key,
          value: own[c.key],
          // A sample under the minimum is no peer group: no median is offered.
          peerMedian: sample.length < MIN_PEER_GROUP ? null : medianOf(c.key, sample),
          coverage: c.key === 'earningsPerKm' ? safeCoverage(input.lengthCoverage) : null,
          z: null,
          contribution: 0,
          provenance: 'modelled',
        })),
        provenance: 'modelled',
      };
    }
    return {
      depotId: id,
      peerGroup: group,
      ranked: true,
      reason: 'ok',
      missing: [],
      economicsIndex: result.index,
      rank: rankOf.get(id) ?? null,
      peerCount: sampleOf(group).length,
      components: result.components,
      provenance: 'modelled',
    };
  });
}

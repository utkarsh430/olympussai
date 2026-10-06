import {
  busCount,
  cleanName,
  index1,
  makeFact,
  onRoadCount,
  ph,
  share,
} from '@/lib/depot/copilot/facts/format';
import type { CopilotFact, CopilotRequest } from '@/lib/depot/copilot/types';
import { answer, unavailable } from '@/lib/depot/copilot/facts/answers/shared';
import type { AnswerData } from '@/lib/depot/copilot/facts/answers';

function sideFacts(data: AnswerData, side: 'a' | 'b', id: string): CopilotFact[] | null {
  const depot = data.network.depots.find((d) => d.id === id);
  if (!depot) return null;
  const score = data.network.scores.find((s) => s.depotId === id);
  const onRoad = onRoadCount(depot.states);
  const facts = [
    makeFact(`${side}.name`, 'Depot', cleanName(depot.name), 'live'),
    makeFact(`${side}.fleet`, 'Fleet', busCount(depot.fleet), 'live'),
    makeFact(`${side}.on_road_share`, 'On-road share', share(onRoad, depot.fleet), 'derived'),
    makeFact(`${side}.dark_share`, 'Dark share', share(depot.states.dark, depot.fleet), 'derived'),
    makeFact(
      `${side}.off_road_share`,
      'Off-road share',
      share(depot.states.offRoad, depot.fleet),
      'derived',
    ),
  ];
  if (score?.ranked && score.index !== null) {
    facts.push(makeFact(`${side}.index`, 'Efficiency index', index1(score.index), 'derived'));
  }
  return facts;
}

export function compareAnswer(data: AnswerData, idA: string, idB: string): CopilotRequest {
  const a = sideFacts(data, 'a', idA);
  const b = sideFacts(data, 'b', idB);
  if (!a || !b) return unavailable('a comparison');
  const scoreOf = (id: string) => data.network.scores.find((s) => s.depotId === id);
  const sa = scoreOf(idA);
  const sb = scoreOf(idB);
  const indexA = sa?.ranked ? sa.index : null;
  const indexB = sb?.ranked ? sb.index : null;
  const line = (s: 'a' | 'b'): string =>
    `${ph(`${s}.name`)} has a fleet of ${ph(`${s}.fleet`)}, with ${ph(`${s}.on_road_share`)} on the road, ${ph(`${s}.dark_share`)} dark and ${ph(`${s}.off_road_share`)} off the road.`;
  let verdict: string;
  if (indexA === null || indexB === null) {
    verdict =
      'At least one of these units is not ranked, so their efficiency indices are not compared.';
  } else if (indexA === indexB) {
    verdict = `Their efficiency indices are level at ${ph('a.index')}.`;
  } else {
    const [lead, trail] = indexA > indexB ? (['a', 'b'] as const) : (['b', 'a'] as const);
    verdict = `${ph(`${lead}.name`)} has the higher efficiency index, ${ph(`${lead}.index`)} against ${ph(`${trail}.index`)}.`;
    if (sa?.peerGroup !== sb?.peerGroup) {
      verdict += ' They sit in different peer groups, so the comparison is indicative.';
    }
  }
  return answer('a comparison of depots', [...a, ...b], {
    headline: `${ph('a.name')} compared with ${ph('b.name')}`,
    paragraphs: [line('a'), line('b'), verdict],
  });
}

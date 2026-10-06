import type { RankMetric } from '@/lib/depot/copilot/queries';
import { metricHigherIsBetter } from '@/lib/depot/copilot/queries';
import { cleanName, index1, makeFact, nameFact, ph } from '@/lib/depot/copilot/facts/format';
import type { CopilotRequest } from '@/lib/depot/copilot/types';
import { MAX_LIST_ROWS, answer } from '@/lib/depot/copilot/facts/answers/shared';
import type { AnswerData } from '@/lib/depot/copilot/facts/answers';

const METRIC_LABEL: Readonly<Record<RankMetric, string>> = {
  index: 'efficiency index',
  onRoad: 'on-road share',
  offRoad: 'off-road rate',
  dark: 'dark rate',
  scheduled: 'schedule coverage',
};

export function rankAnswer(
  data: AnswerData,
  metric: RankMetric,
  order: 'top' | 'bottom',
  limit: number,
): CopilotRequest {
  const names = new Map(data.network.depots.map((d) => [d.id, d.name] as const));
  const rows = data.network.scores
    .flatMap((s) => {
      const value =
        metric === 'index' ? s.index : (s.components.find((c) => c.key === metric)?.value ?? null);
      return s.ranked && value !== null ? [{ name: names.get(s.depotId) ?? s.depotId, value }] : [];
    })
    .sort((a, b) => (order === 'top' ? b.value - a.value : a.value - b.value))
    .slice(0, Math.min(limit, MAX_LIST_ROWS * 2));
  const label = METRIC_LABEL[metric];
  const direction = order === 'top' ? 'Highest' : 'Lowest';
  if (rows.length === 0) {
    return answer('a depot ranking', [], {
      headline: `${direction} ${label} among ranked depots`,
      paragraphs: ['No depot can be ranked on this snapshot, so there is no list to give.'],
    });
  }
  const facts = rows.flatMap((row, i) => [
    nameFact(`rank.${i + 1}.name`, `Depot ${i + 1}`, cleanName(row.name), 'derived'),
    makeFact(
      `rank.${i + 1}.value`,
      `Value ${i + 1}`,
      metric === 'index' ? index1(row.value) : `${Math.round(row.value * 100)}%`,
      'derived',
    ),
  ]);
  const entries = rows.map((_, i) => `${ph(`rank.${i + 1}.name`)} at ${ph(`rank.${i + 1}.value`)}`);
  const sense = metricHigherIsBetter(metric)
    ? 'A higher figure is better on this measure.'
    : 'A higher figure is worse on this measure.';
  return answer('a depot ranking', facts, {
    headline: `${direction} ${label} among ranked depots`,
    paragraphs: [
      `Leading entries by ${label}, from the ${direction === 'Highest' ? 'highest down' : 'lowest up'}: ${entries.join('; ')}.`,
      `${sense} Only the leading entries are listed, and units that are not operating depots, such as hired or electric fleets, are left out.`,
    ],
  });
}

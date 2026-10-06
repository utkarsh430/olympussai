import { busCount, cleanName, depotCount, makeFact, ph } from '@/lib/depot/copilot/facts/format';
import type { CopilotFact, CopilotRequest } from '@/lib/depot/copilot/types';
import type { DepotBalance } from '@/lib/depot/optimise/types';
import {
  MODELLED_NOTE,
  MAX_LIST_ROWS,
  answer,
  unavailable,
} from '@/lib/depot/copilot/facts/answers/shared';
import type { AnswerData } from '@/lib/depot/copilot/facts/answers';

export function balanceList(data: AnswerData, kind: 'deficit' | 'surplus'): CopilotRequest {
  const dist = data.distribution;
  if (!dist) return unavailable('the modelled balance');
  const rows: readonly DepotBalance[] = dist.balances
    .filter((b) => (kind === 'deficit' ? b.balance < 0 : b.balance > 0))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  const headline =
    kind === 'deficit'
      ? 'Depots in deficit on the modelled requirement'
      : 'Depots in surplus on the modelled requirement';
  if (rows.length === 0) {
    return answer('the modelled balance', [], {
      headline,
      paragraphs: [
        kind === 'deficit'
          ? 'On the modelled requirement no depot is in deficit.'
          : 'On the modelled requirement no depot is in surplus.',
        MODELLED_NOTE,
      ],
    });
  }
  const shown = rows.slice(0, MAX_LIST_ROWS);
  const total = rows.reduce((sum, b) => sum + Math.abs(b.balance), 0);
  const facts: CopilotFact[] = [
    makeFact('list.count', 'Depots', depotCount(rows.length), 'modelled'),
    makeFact('list.total', 'Buses in total', busCount(total), 'modelled'),
    ...shown.flatMap((b, i) => [
      makeFact(`list.${i + 1}.name`, `Depot ${i + 1}`, cleanName(b.depotName), 'live'),
      makeFact(`list.${i + 1}.size`, `Size ${i + 1}`, busCount(Math.abs(b.balance)), 'modelled'),
    ]),
  ];
  const lead =
    kind === 'deficit'
      ? `The modelled requirement shows a shortage of buses at ${ph('list.count')}, ${ph('list.total')} in all.`
      : `The modelled requirement shows spare buses at ${ph('list.count')}, ${ph('list.total')} in all.`;
  const entries = shown.map((_, i) => `${ph(`list.${i + 1}.name`)} by ${ph(`list.${i + 1}.size`)}`);
  return answer('the modelled balance', facts, {
    headline,
    paragraphs: [lead, `Leading entries: ${entries.join('; ')}.`, MODELLED_NOTE],
  });
}

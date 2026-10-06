import { busCount, cleanName, km1, makeFact, nameFact, ph } from '@/lib/depot/copilot/facts/format';
import type { CopilotFact, CopilotRequest } from '@/lib/depot/copilot/types';
import type { UncoveredReason } from '@/lib/depot/optimise/types';
import {
  MODELLED_NOTE,
  MAX_TRANSFER_ROWS,
  answer,
  nameOf,
  plural,
  unavailable,
} from '@/lib/depot/copilot/facts/answers/shared';
import type { AnswerData } from '@/lib/depot/copilot/facts/answers';

/** A sentence of its own: "because" is not in the vocabulary. */
const UNCOVERED_SENTENCE: Readonly<Record<UncoveredReason, string>> = {
  no_surplus_in_range: 'No surplus lies within range.',
  insufficient_surplus: 'The surplus within range is not enough.',
  no_position: 'The depot has no known position.',
  excluded: 'The depot is excluded from the plan.',
};

export function transfersAnswer(data: AnswerData, depotId: string): CopilotRequest {
  const dist = data.distribution;
  const name = nameOf(data, depotId);
  if (!dist || name === null) return unavailable('transfers');
  const balance = dist.balances.find((b) => b.depotId === depotId);
  const names = new Map(dist.balances.map((b) => [b.depotId, b.depotName] as const));
  const mine = dist.plan.transfers.filter(
    (t) => t.fromDepotId === depotId || t.toDepotId === depotId,
  );
  const shown = mine.slice(0, MAX_TRANSFER_ROWS);
  const facts: CopilotFact[] = [nameFact('depot.name', 'Depot', cleanName(name), 'live')];
  if (balance && balance.balance !== 0) {
    facts.push(
      makeFact(
        'depot.balance',
        'Modelled balance',
        busCount(Math.abs(balance.balance)),
        'modelled',
      ),
    );
  }
  shown.forEach((t, i) => {
    const other = t.fromDepotId === depotId ? t.toDepotId : t.fromDepotId;
    facts.push(
      makeFact(`t.${i + 1}.buses`, `Buses ${i + 1}`, busCount(t.buses), 'modelled'),
      nameFact(
        `t.${i + 1}.other`,
        `Other depot ${i + 1}`,
        cleanName(names.get(other) ?? nameOf(data, other) ?? other),
        'live',
      ),
      makeFact(`t.${i + 1}.distance`, `Distance ${i + 1}`, km1(t.distanceKm), 'derived'),
    );
  });
  if (mine.length > shown.length) {
    facts.push(
      makeFact(
        't.total',
        'Transfers in the plan',
        plural(mine.length, 'transfer', 'transfers'),
        'modelled',
      ),
    );
  }
  const uncovered = dist.plan.uncovered.find((u) => u.depotId === depotId);
  if (uncovered) {
    facts.push(
      makeFact('t.uncovered', 'Deficit not covered', busCount(uncovered.buses), 'modelled'),
    );
  }
  const standing = !balance
    ? `No modelled balance is on record for ${ph('depot.name')}.`
    : balance.balance > 0
      ? `The modelled requirement puts ${ph('depot.name')} in surplus by ${ph('depot.balance')}.`
      : balance.balance < 0
        ? `The modelled requirement puts ${ph('depot.name')} in deficit by ${ph('depot.balance')}.`
        : `The modelled requirement puts ${ph('depot.name')} in balance.`;
  const lines = shown.map((t, i) => {
    const give = t.fromDepotId === depotId;
    return `${give ? 'Sending' : 'Receiving'} ${ph(`t.${i + 1}.buses`)} ${give ? 'to' : 'from'} ${ph(`t.${i + 1}.other`)}; the estimated road distance is ${ph(`t.${i + 1}.distance`)}.`;
  });
  const paragraphs = [
    standing,
    lines.length > 0
      ? `In the current plan: ${lines.join(' ')}${
          mine.length > shown.length
            ? ` These are the leading entries; the plan holds ${ph('t.total')} involving this depot.`
            : ''
        }`
      : 'No transfer involving this depot is proposed in the current plan.',
  ];
  if (uncovered) {
    paragraphs.push(
      `Left uncovered in the current plan: ${ph('t.uncovered')}. ${UNCOVERED_SENTENCE[uncovered.reason]}`,
    );
  }
  paragraphs.push(MODELLED_NOTE);
  return answer(cleanName(name), facts, {
    headline: `Transfers for ${ph('depot.name')}`,
    paragraphs,
  });
}

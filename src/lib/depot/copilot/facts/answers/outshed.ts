import {
  busCount,
  cleanName,
  makeFact,
  nameFact,
  ph,
} from '@/lib/depot/copilot/facts/format';
import type { CopilotFact, CopilotRequest } from '@/lib/depot/copilot/types';
import { answer, unavailable } from '@/lib/depot/copilot/facts/answers/shared';
import type { AnswerData } from '@/lib/depot/copilot/facts/answers';
import { pluralWord } from '@/lib/depot/format';

export function outshedAnswer(data: AnswerData, depotId: string): CopilotRequest {
  const detail = data.details?.[depotId];
  if (!detail) return unavailable('departures');
  const { coverage, counts, rows } = detail.outshed;
  const late = rows.filter((r) => r.minutesLate !== null && r.minutesLate > 0).length;
  const facts: CopilotFact[] = [
    nameFact('depot.name', 'Depot', cleanName(detail.depot.name), 'live'),
    makeFact(
      'outshed.coverage',
      'Schedule coverage',
      `${coverage.n} of ${coverage.of} buses`,
      'derived',
    ),
    makeFact('outshed.departed', 'Departed', busCount(counts.departed), 'derived'),
    makeFact('outshed.overdue', 'Overdue to leave', busCount(counts.overdue), 'derived'),
    makeFact('outshed.due', 'Due to leave', busCount(counts.due), 'derived'),
    makeFact('outshed.upcoming', 'Not yet due', busCount(counts.upcoming), 'derived'),
    makeFact('outshed.ended', 'Schedule over', busCount(counts.ended), 'derived'),
    makeFact('outshed.unknown', 'Unknown', busCount(counts.unknown), 'derived'),
    makeFact('outshed.late', 'Departed late', busCount(late), 'derived'),
  ];
  const headline = `Departures from ${ph('depot.name')}`;
  if (coverage.n === 0) {
    return answer(cleanName(detail.depot.name), facts, {
      headline,
      paragraphs: [
        `Departure schedules are not in the feed for ${ph('depot.name')}; coverage stands at ${ph('outshed.coverage')}, so outshedding cannot be assessed.`,
      ],
    });
  }
  const parts = [
    `${ph('outshed.departed')} already away`,
    counts.due > 0 ? `${ph('outshed.due')} due to leave now` : null,
    counts.upcoming > 0 ? `${ph('outshed.upcoming')} yet to reach their departure` : null,
    counts.overdue > 0
      ? `${ph('outshed.overdue')} overdue to leave the yard`
      : 'nothing overdue to leave the yard',
    counts.unknown > 0
      ? `${ph('outshed.unknown')} that ${pluralWord(counts.unknown, 'is', 'are')} too uncertain to place`
      : null,
  ].filter((p): p is string => p !== null);
  // Three or more parts end "…; and the last": the semicolon closes the clause, so the last
  // figure is never judged against the words that end the part before it ("their departure
  // and N buses" is refused by the draft rules). Two parts read "A already away and B".
  const last = parts[parts.length - 1];
  const body =
    parts.length <= 2 ? parts.join(' and ') : `${parts.slice(0, -1).join('; ')}; and ${last}`;
  const paragraphs = [
    `Schedules are known for ${ph('outshed.coverage')} at ${ph('depot.name')}.`,
    `Of those, ${body}.`,
  ];
  // A sentence of its own, as in the depot briefing: joined into the list above, "already
  // over and N buses overdue" put "over" right before a figure, which the draft rules refuse.
  if (counts.ended > 0) {
    paragraphs.push(`For ${ph('outshed.ended')} the scheduled window is already over.`);
  }
  if (late > 0) paragraphs.push(`Departed later than scheduled: ${ph('outshed.late')}.`);
  return answer(cleanName(detail.depot.name), facts, { headline, paragraphs });
}

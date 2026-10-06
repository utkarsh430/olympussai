import { DEPOT_EXCEPTION_PHRASE, cleanName, makeFact, nameFact, ph } from '@/lib/depot/copilot/facts/format';
import type { CopilotFact, CopilotRequest } from '@/lib/depot/copilot/types';
import { answer, plural, unavailable } from '@/lib/depot/copilot/facts/answers/shared';
import type { AnswerData } from '@/lib/depot/copilot/facts/answers';

export function exceptionsAnswer(data: AnswerData, depotId: string): CopilotRequest {
  const detail = data.details?.[depotId];
  if (!detail) return unavailable('exceptions');
  const { depot, bus } = detail.exceptions;
  const critical = depot.filter((e) => e.severity === 'critical').length;
  const facts: CopilotFact[] = [
    nameFact('depot.name', 'Depot', cleanName(detail.depot.name), 'live'),
    makeFact(
      'ex.depot',
      'Depot-level exceptions',
      plural(depot.length, 'exception', 'exceptions'),
      'derived',
    ),
    makeFact(
      'ex.bus',
      'Vehicle exceptions',
      plural(bus.length, 'exception', 'exceptions'),
      'derived',
    ),
    makeFact(
      'ex.critical',
      'Rated critical',
      plural(critical, 'exception', 'exceptions'),
      'derived',
    ),
  ];
  const headline = `Exceptions for ${ph('depot.name')}`;
  if (depot.length === 0 && bus.length === 0) {
    return answer(cleanName(detail.depot.name), facts, {
      headline,
      paragraphs: [`No exceptions are flagged for ${ph('depot.name')} on this snapshot.`],
    });
  }
  const kinds = [...new Set(depot.map((e) => DEPOT_EXCEPTION_PHRASE[e.kind]))];
  const paragraphs: string[] = [];
  paragraphs.push(
    depot.length > 0
      ? `Flagged at depot level, for ${kinds.join(' and ')}: ${ph('ex.depot')}.${critical > 0 ? ` Rated critical: ${ph('ex.critical')}.` : ''}`
      : `Nothing is flagged at depot level for ${ph('depot.name')}.`,
  );
  if (bus.length > 0) paragraphs.push(`Flagged on vehicles: ${ph('ex.bus')}.`);
  paragraphs.push('A closer look at these items could be worthwhile.');
  return answer(cleanName(detail.depot.name), facts, { headline, paragraphs });
}

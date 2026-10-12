import { answer, unavailable } from '@/lib/depot/copilot/facts/answers/shared';
import { buildRequest, busCount, cleanName, count, makeFact, nameFact, ph } from '@/lib/depot/copilot/facts/format';
import { ORIGIN_WORDS, RECOMMENDATION_ONLY } from '@/lib/depot/copilot/facts/schedule';
import type { CopilotFact, CopilotRequest } from '@/lib/depot/copilot/types';
import type { IncidentView, IncidentsResponse } from '@/lib/depot/incident/api';
import { CONFIDENCE_WORD, SIGNAL_TEXT, kindText } from '@/lib/depot/incident/incidentWording';

/*
 * Incident Response facts and scripted answers: which buses may have broken
 * down and the replacement recommended for each. Figures live in facts;
 * crew are slots; nothing says where a figure comes from.
 */

const RATIONALE_GUIDANCE =
  'Explain in plain language why this replacement for the broken-down bus is the quickest way to move its passengers: ' +
  'how soon they are moving, the empty running it costs, what it does to other passengers, and what the plan could not use. ' +
  'Use only the supplied facts, describe and recommend, never instruct, never discuss a person, and never say where a figure comes from.';

const MAX_ROWS = 5;
const minutesText = (n: number | null): string => (n === null ? 'not known' : `${count(n)} min`);

function incidentFacts(view: IncidentView, i: number): CopilotFact[] {
  const { incident, plan } = view;
  const recommended = plan.recommended;
  const who = recommended === null ? 'the next scheduled bus' : kindText(recommended.kind, recommended.depotName).toLowerCase();
  return [
    nameFact(`inc.${i}.name`, 'Bus', cleanName(incident.registrationNumber), 'live'),
    nameFact(`inc.${i}.route`, 'Route', cleanName(incident.routeName ?? 'no route name'), 'live'),
    makeFact(`inc.${i}.signals`, 'Signals', incident.signals.length === 0 ? 'declared by a person' : incident.signals.map((s) => SIGNAL_TEXT[s]).join('; '), 'derived'),
    makeFact(`inc.${i}.confidence`, 'Confidence', CONFIDENCE_WORD[incident.confidence], 'derived'),
    makeFact(`inc.${i}.aboard`, 'Passengers aboard', `about ${count(plan.passengersAboard.value)} passengers`, 'modelled'),
    makeFact(`inc.${i}.arrival`, 'Recommended replacement', `${who}, arriving in ${minutesText(recommended?.arrivalMinutes ?? plan.baseline.arrivalMinutes)}`, 'derived'),
  ];
}

export function breakdownSummaryAnswer(body: IncidentsResponse | null | undefined): CopilotRequest {
  if (!body) return unavailable('the breakdowns at that depot');
  const rows = body.incidents.slice(0, MAX_ROWS);
  const facts: CopilotFact[] = [
    nameFact('inc.depot', 'Depot', cleanName(body.depotName), 'live', body.depotId),
    makeFact('inc.count', 'Buses that may have broken down', busCount(body.incidents.length), 'derived'),
    makeFact('inc.checked', 'Buses checked', busCount(body.detection.considered), 'derived'),
    ...rows.flatMap((v, i) => incidentFacts(v, i + 1)),
  ];
  const paragraphs =
    rows.length === 0
      ? [`Buses checked at ${ph('inc.depot')}: ${ph('inc.checked')}. No bus looks to have a breakdown on this snapshot.`, RECOMMENDATION_ONLY]
      : [
          `Buses that may have a breakdown at ${ph('inc.depot')}: ${ph('inc.count')}; checked: ${ph('inc.checked')}.`,
          ...rows.map((_, i) => `Bus ${ph(`inc.${i + 1}.name`)} on ${ph(`inc.${i + 1}.route`)}; signals: ${ph(`inc.${i + 1}.signals`)}; passengers: ${ph(`inc.${i + 1}.aboard`)}; replacement: ${ph(`inc.${i + 1}.arrival`)}.`),
          RECOMMENDATION_ONLY,
        ];
  return { ...answer(cleanName(body.depotName), facts, { headline: `Breakdowns at ${ph('inc.depot')}`, paragraphs }), refuseWords: ORIGIN_WORDS };
}

function replacementFacts(view: IncidentView, depotName: string, depotId: string): CopilotFact[] {
  const { plan, incident } = view;
  const r = plan.recommended;
  return [
    nameFact('rep.depot', 'Depot', cleanName(depotName), 'live', depotId),
    ...incidentFacts(view, 1),
    makeFact('rep.options', 'Replacement options', `${count(plan.candidates.filter((c) => c.excludedReason === null).length)} options`, 'derived'),
    makeFact('rep.moving', 'Passengers moving in', minutesText(r?.passengersMovingMinutes ?? plan.baseline.passengersMovingMinutes), 'derived'),
    makeFact('rep.dead', 'Empty running', `${(r?.deadKm ?? 0).toFixed(1)} km`, 'derived'),
    makeFact('rep.knock', 'Delay to other passengers', minutesText(r?.knockOnMinutes ?? plan.baseline.knockOnMinutes), 'derived'),
    makeFact('rep.next', 'Next scheduled bus', `in ${minutesText(plan.baseline.arrivalMinutes)}`, 'derived'),
    makeFact('rep.excluded', 'Options set aside', `${count(plan.candidates.filter((c) => c.excludedReason !== null).length)} options`, 'derived'),
    ...(incident.stoppedMinutes === null ? [] : [makeFact('rep.stopped', 'Stopped for', `${count(incident.stoppedMinutes)} min`, 'derived')]),
  ];
}

export function replacementForAnswer(view: IncidentView | null | undefined, depotName: string, depotId: string): CopilotRequest {
  if (!view) return unavailable('a replacement for that bus');
  const facts = replacementFacts(view, depotName, depotId);
  const paragraphs = [
    `Bus ${ph('inc.1.name')} on ${ph('inc.1.route')}; signals: ${ph('inc.1.signals')}; confidence: ${ph('inc.1.confidence')}.`,
    `Passengers on the bus: ${ph('inc.1.aboard')}. The recommended replacement: ${ph('inc.1.arrival')}; passengers moving in ${ph('rep.moving')}.`,
    `Empty running: ${ph('rep.dead')}; delay to other passengers: ${ph('rep.knock')}. The next scheduled bus: ${ph('rep.next')}.`,
    RECOMMENDATION_ONLY,
  ];
  return { ...answer(cleanName(depotName), facts, { headline: `Replacement for ${ph('inc.1.name')}`, paragraphs }), refuseWords: ORIGIN_WORDS };
}

/** Why this replacement: how soon passengers move, what it costs, what was set aside. */
export function buildReplacementRationale(view: IncidentView, depotName: string, depotId: string): CopilotRequest {
  const facts = replacementFacts(view, depotName, depotId);
  const paragraphs = [
    `The replacements are ranked by how soon the passengers are moving, then by empty running, then by the delay to other passengers. Passengers on the bus: ${ph('inc.1.aboard')}.`,
    `The recommended replacement: ${ph('inc.1.arrival')}; passengers moving in ${ph('rep.moving')}; empty running: ${ph('rep.dead')}; delay to other passengers: ${ph('rep.knock')}.`,
    `Options set aside: ${ph('rep.excluded')}. The next scheduled bus: ${ph('rep.next')}.`,
    RECOMMENDATION_ONLY,
  ];
  return {
    ...buildRequest({ task: 'rationale', scopeLabel: cleanName(depotName), facts, guidance: RATIONALE_GUIDANCE, scriptedDraft: { headline: `Why this replacement for ${ph('inc.1.name')}`, paragraphs } }),
    refuseWords: ORIGIN_WORDS,
  };
}

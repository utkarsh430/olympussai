import { describe, expect, it } from 'vitest';
import { renderDraft } from '@/lib/depot/copilot/render';
import type { CopilotFact } from '@/lib/depot/copilot/types';

const fact = (id: string, text: string): CopilotFact => ({ id, label: id, text, provenance: 'live' });

const FACTS: readonly CopilotFact[] = [
  fact('fleet', '1,204 buses'),
  fact('onroad', '71%'),
  fact('dark', '38 buses'),
  fact('darkshare', '3%'),
  fact('name', 'AGRA'),
  fact('other', 'KANPUR'),
  fact('third', 'MEERUT'),
  fact('index', '62.4'),
  fact('rank', '4 of 12'),
  fact('peer', 'larger depots'),
  fact('move', '6 buses'),
  fact('km', '18.2 km'),
  fact('deficit', '9 buses'),
  fact('surplus', '11 buses'),
  fact('depots', '7 depots'),
  fact('time', '14:05'),
];

/** Honest sentences of the kind a briefing, a transfer rationale and an answer contain. */
const CORPUS: readonly string[] = [
  // Network and depot briefings
  'The network has {{fact:fleet}} in the feed, with {{fact:onroad}} on the road.',
  'On the latest feed, {{fact:dark}} have gone dark, which is {{fact:darkshare}} of the fleet.',
  '{{fact:name}} is the strongest ranked depot and {{fact:other}} is the weakest.',
  'The gap between the strongest and the weakest depot is wide enough to deserve attention.',
  '{{fact:name}}, {{fact:other}} and {{fact:third}} carry most of the depot-level exceptions.',
  'Most of the fleet is running, and the share of buses under maintenance is modest.',
  'The data is marked stale, so the picture may lag what is happening on the road.',
  '{{fact:name}} stands at {{fact:rank}} among the {{fact:peer}}.',
  'Its efficiency index is {{fact:index}}, which places it in the upper part of its peer group.',
  'The depot has a fleet of {{fact:fleet}}, of which {{fact:onroad}} is on the road.',
  'No yard is established for this depot, so yard occupancy cannot be described.',
  'Departure schedules are known for only part of the fleet, so the overdue count is a floor.',
  'A high share of buses off the road is the main concern at {{fact:name}}.',
  'Schedule coverage is the weakest component for this depot.',
  'The on-road share is healthy, but the dark share has risen and is worth watching.',
  'Several depots show a cluster of buses with the main power cut.',
  'Nothing is flagged at depot level, though {{fact:dark}} are flagged on vehicles.',
  'The picture is broadly stable compared with the earlier snapshot.',
  'Maintenance pressure is concentrated in a few of the smaller depots.',
  'The feed was last updated at {{fact:time}}.',
  'A closer look at the depots with a high dark share could be worthwhile.',
  'The ranked depots sit close together on the index, so small changes can move the order.',
  'Visitors from other depots account for {{fact:move}} in the yard.',
  'There is no sign of a network-wide problem; the issues are local.',
  'The weakest depot trails its peers mainly on schedule coverage.',
  'Buses that have lost signal are spread across the network rather than tied to a depot.',
  '{{fact:depots}} are in deficit on the modelled requirement.',
  'The requirement is modelled until a network timetable is supplied.',
  'These are planning figures rather than measured needs.',
  'What to watch: whether the dark share at {{fact:name}} keeps rising.',
  // Transfer rationale
  'The plan proposes moving {{fact:move}} from {{fact:name}} to {{fact:other}}.',
  '{{fact:name}} holds a surplus of {{fact:surplus}} against its modelled requirement.',
  '{{fact:other}} is short by {{fact:deficit}}, the largest deficit within range.',
  'The road distance between the depots is about {{fact:km}}, which keeps the move practical.',
  'After the transfer, {{fact:name}} would still hold a surplus.',
  'The receiving depot would see its deficit reduced but not removed.',
  'The giving depot can spare these buses without falling below its own requirement.',
  'No closer depot has a surplus large enough to cover the gap.',
  'The transfer makes sense because the surplus and the deficit lie close together.',
  'It is a recommendation for the planner to consider, not an instruction.',
  'A shorter move would be preferable, but no surplus lies nearer.',
  'The remaining deficit at {{fact:other}} would need a further transfer from another depot.',
  'This is the leading entry in the plan for this depot.',
  'The estimate rests on the modelled requirement, so it is indicative.',
  'Moving fewer buses would leave the receiving depot exposed at the peak.',
  // Answers
  '{{fact:name}} has the higher efficiency index, {{fact:index}}, of the depots compared.',
  'The depots sit in different peer groups, so the comparison is indicative.',
  'No depot is in surplus on the modelled requirement.',
  'The depots in deficit are {{fact:name}}, {{fact:other}} and {{fact:third}}.',
  'Of the buses with a known schedule, {{fact:move}} have already left the yard.',
  '{{fact:dark}} are overdue to leave the yard.',
  'That question is outside what can be answered here.',
  'The data needed to answer this is not available right now.',
  'No transfer involving this depot is proposed in the current plan.',
  'The plan holds {{fact:depots}} in deficit and proposes transfers for some of them.',
  'A higher figure is better on this measure.',
  'Too few depots have enough buses to be ranked against each other.',
  'The exceptions flagged for this depot are all at vehicle level.',
  '{{fact:name}} leads the ranking, followed by {{fact:other}} and then {{fact:third}}.',
  'There are no exceptions flagged on this snapshot.',
  'The answer depends on the yard boundary, which is not yet established for {{fact:name}}.',
  'Its dark rate ({{fact:darkshare}}) is lower than that of its peers.',
  'The depot\'s on-road share is {{fact:onroad}}; its peers are slightly higher.',
  'In short: the fleet is largely on the road, and the exceptions are few.',
  'This depot is described as "stretched" because its deficit is large relative to its fleet.',
  'The comparison covers {{fact:name}} and {{fact:other}} only.',
];

describe('honest corpus (over-rejection measure)', () => {
  it('holds at least sixty sentences', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(60);
  });

  it('accepts every honest sentence', () => {
    const rejected = CORPUS.flatMap((sentence) => {
      const result = renderDraft({ headline: 'Network briefing', paragraphs: [sentence] }, FACTS);
      return result.ok ? [] : [`${result.reason} :: ${sentence}`];
    });
    expect(rejected).toEqual([]);
  });
});

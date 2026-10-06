import { describe, expect, it } from 'vitest';
import { renderDraft } from '@/lib/depot/copilot/render';
import type { CopilotFact } from '@/lib/depot/copilot/types';

/*
 * Round 9, item 3 (closing review M-A): a figure is as of the feed time, for
 * the scope its fact names, so no quantifier or period word may stand anywhere
 * in its clause, not only within two words of it.
 */

const FACTS: readonly CopilotFact[] = [
  { id: 'name', label: 'Depot', text: 'AGRA', provenance: 'live', kind: 'name' },
  { id: 'dark', label: 'Dark', text: '3 buses', provenance: 'live' },
];

const ok = (paragraph: string): boolean =>
  renderDraft({ headline: 'Depot briefing', paragraphs: [paragraph] }, FACTS).ok;

/** The review's scope and period drafts (section 4), then more of the same kind. */
const SCOPE_AND_PERIOD_DRAFTS: readonly string[] = [
  'All depots in the network have {{fact:dark}} dark.',
  'Several depots have {{fact:dark}} dark.',
  'The whole network has {{fact:dark}} dark.',
  '{{fact:dark}} were dark in the last week.',
  '{{fact:dark}} were dark for the whole of the last year.',
  'In the last month the depot had {{fact:dark}} dark.',
  'Many depots in the network have {{fact:dark}} dark.',
  'Across the network, all of the depots have {{fact:dark}} dark.',
  '{{fact:dark}} were dark at {{fact:name}} on the last day.',
  '{{fact:dark}} were dark at {{fact:name}} through the night shift.',
  'Over the year, {{fact:dark}} were dark at {{fact:name}}.',
  'In a typical week the yard at {{fact:name}} has {{fact:dark}} dark.',
  'For the month, the depot at {{fact:name}} has {{fact:dark}} dark.',
  'The depots at {{fact:name}} and elsewhere have {{fact:dark}} dark on many shifts.',
  '{{fact:dark}} have been dark at {{fact:name}} in the last year.',
  'On the day shift at {{fact:name}} the depot had {{fact:dark}} dark.',
];

describe('M-A: quantifier and period words in a figure clause', () => {
  it.each(SCOPE_AND_PERIOD_DRAFTS)('refuses: %s', (draft) => {
    expect(ok(draft)).toBe(false);
  });

  it.each([
    'The network as a whole is steady; {{fact:dark}} are dark at {{fact:name}}.',
    'All depots report on time. At {{fact:name}}, {{fact:dark}} are dark.',
    'The feed was updated at the latest snapshot: {{fact:dark}} are dark.',
  ])('still renders the same word in a clause without a figure: %s', (draft) => {
    expect(ok(draft)).toBe(true);
  });
});

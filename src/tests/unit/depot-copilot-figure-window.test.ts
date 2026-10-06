import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '@/lib/depot/copilot/cli/prompt';
import { MAX_SYSTEM_PROMPT_BYTES } from '@/lib/depot/copilot/limits';
import { renderDraft } from '@/lib/depot/copilot/render';
import type { CopilotFact } from '@/lib/depot/copilot/types';
import { isVocabularyWord, VOCABULARY_WORDS } from '@/lib/depot/copilot/vocabulary';
import {
  AFTER_FIGURE_WORDS,
  BEFORE_FIGURE_WORDS,
  CLAUSE_SCOPE_WORDS,
  FIGURE_WINDOW_WORDS,
  STATE_NOUNS,
} from '@/lib/depot/copilot/vocabulary/nearFigure';

const fact = (id: string, text: string, kind?: 'name'): CopilotFact => ({
  id,
  label: id,
  text,
  provenance: 'live',
  ...(kind ? { kind } : {}),
});

/** The facts the final security review probed with (copilot-sec-final/p.mts). */
const FACTS: readonly CopilotFact[] = [
  fact('dark', '3 buses'),
  fact('fleet', '200 buses'),
  fact('onroad', '141 buses'),
  fact('pct', '71%'),
  fact('idx', 'index 68.1'),
  fact('rank', 'rank 2 of 12 depots'),
  fact('km', '120 km'),
  fact('time', '14:05'),
  fact('name', 'Agra', 'name'),
  fact('other', 'Kaushambi', 'name'),
  fact('short', '4 buses'),
];
const ok = (text: string): boolean =>
  renderDraft({ headline: 'Depot briefing', paragraphs: [text] }, FACTS).ok;

/** Ruling S49 M1: every draft the review showed passing, and the forms the ruling names. */
const M1_DRAFTS: readonly string[] = [
  // a / an + noun after a figure: a rate
  'The network has {{fact:dark}} a depot.',
  'The network runs {{fact:fleet}} a shift.',
  'The depot covers {{fact:km}} a route.',
  'The network runs {{fact:fleet}}, a shift.',
  // a preposition then each / every: a rate
  'The depot has {{fact:fleet}} for every depot.',
  'The network has {{fact:dark}} in each depot.',
  'The fleet runs {{fact:km}} on every route.',
  'The fleet runs {{fact:km}} on the road at every depot.',
  'The depot moved {{fact:dark}} in the morning shift, so {{fact:km}} a duty.',
  // the figure moved to another day or period
  'Today {{fact:dark}} are dark, yesterday {{fact:fleet}}.',
  '{{fact:time}} tomorrow.',
  'Earlier, the depot had {{fact:dark}} dark.',
  'The depot had {{fact:dark}} dark the previous week.',
  'Next, the depot will have {{fact:dark}} dark.',
  'The depot had {{fact:dark}} dark last.',
  'Later the depot will hold {{fact:dark}}.',
  'The daily rate is {{fact:dark}}.',
  // negation or a quantifier in the figure's clause
  'Not all {{fact:fleet}} are on the road.',
  'Fewer than the {{fact:dark}} are dark.',
  'No more than the {{fact:onroad}} run.',
  'Not, {{fact:onroad}} are on the road.',
  '{{fact:onroad}} are not on the road.',
  '{{fact:onroad}} never left the yard.',
  "{{fact:onroad}} aren't on the road.",
  'Barely {{fact:onroad}} run.',
  'Just {{fact:onroad}} run.',
  'Only {{fact:onroad}} run.',
  'Nearly {{fact:onroad}} run.',
  'At least, of the fleet, {{fact:onroad}} run.',
  'At most, of the fleet, {{fact:onroad}} run.',
  'The bulk of the {{fact:fleet}} is dark.',
  'A majority of the {{fact:fleet}} is dark, nearly all.',
  'The average depot has {{fact:fleet}}.',
  'The total is {{fact:dark}} and {{fact:fleet}} combined.',
  'Of the fleet, all of the {{fact:onroad}} run.',
  // a second noun on a figure that carries its own
  '{{fact:pct}} buses are dark.',
  '{{fact:idx}} buses are dark.',
  '{{fact:pct}} of {{fact:name}} depots are dark.',
  '{{fact:rank}} buses.',
  '{{fact:pct}} deficit.',
];

describe('ruling S49 M1: the review drafts', () => {
  it.each(M1_DRAFTS)('refuses %j', (text) => {
    expect(ok(text)).toBe(false);
  });
});

/**
 * Valid sentences, each with one figure; `at` is the figure's token index. A
 * vocabulary word is inserted at each place within two words of the figure.
 */
const BASES: readonly { readonly text: string; readonly at: number }[] = [
  { text: 'The network has {{fact:fleet}} in the feed.', at: 3 },
  { text: 'The fleet stands at {{fact:onroad}} on the road.', at: 4 },
  { text: 'Of the fleet, {{fact:pct}} is on the road.', at: 3 },
  { text: '{{fact:dark}} are dark.', at: 0 },
];

/** Where an inserted word lands relative to the figure, and which reviewed list admits it. */
const SLOTS = [-2, -1, 1, 2] as const;

function insert(text: string, at: number, slot: number, word: string): string {
  const tokens = text.split(' ');
  const position = slot < 0 ? at + slot + 1 : at + slot;
  return [...tokens.slice(0, position), word, ...tokens.slice(position)].join(' ');
}

function admitted(slot: number, word: string, previous: string | undefined): boolean {
  if (slot < 0) return BEFORE_FIGURE_WORDS.includes(word);
  if (AFTER_FIGURE_WORDS.includes(word)) return true;
  return slot === 2 && previous === 'in' && STATE_NOUNS.includes(word);
}

const FORMS = (word: string): readonly string[] =>
  [word, `${word}s`, `${word}es`, `${word}ed`, `${word}ing`, `${word}ly`].filter(isVocabularyWord);

describe('ruling S49 M1: any word within two words of a figure', () => {
  it('is accepted only when the reviewed lists admit it', () => {
    const holes: string[] = [];
    for (const base of BASES) {
      expect(ok(base.text)).toBe(true);
      const tokens = base.text.split(' ');
      for (const slot of SLOTS) {
        if (base.at + slot < -1) continue; // nothing stands before a sentence's first token
        const previous = slot === 2 ? tokens[base.at + 1]?.toLowerCase() : undefined;
        const words = base === BASES[0] ? VOCABULARY_WORDS.flatMap(FORMS) : VOCABULARY_WORDS;
        for (const word of words) {
          const draft = insert(base.text, base.at, slot, word);
          if (ok(draft) && !admitted(slot, word, previous)) holes.push(draft);
        }
      }
    }
    expect(holes).toEqual([]);
  });

  it('keeps every clause-scope word out of the window lists', () => {
    const near = new Set([...BEFORE_FIGURE_WORDS, ...AFTER_FIGURE_WORDS, ...STATE_NOUNS]);
    expect(CLAUSE_SCOPE_WORDS.filter((word) => near.has(word))).toEqual([]);
  });

  it.each(CLAUSE_SCOPE_WORDS.filter(isVocabularyWord))(
    'refuses %j anywhere in a figure clause',
    (word) => {
      expect(ok(`The ${word} fleet stands at {{fact:onroad}} on the road.`)).toBe(false);
      expect(ok(`The fleet stands at {{fact:onroad}} on the road ${word}.`)).toBe(false);
      expect(ok(`The ${word} fleet is steady; it stands at {{fact:onroad}}.`)).toBe(true);
    },
  );
});

/** The reviewed lists, written out: a change to the source lists must change this test too. */
describe('ruling S49 M1: the reviewed window lists', () => {
  it('match the reviewed copy', () => {
    expect([...BEFORE_FIGURE_WORDS].sort().join(' ')).toBe(
      'account against already although and are as at away buses by count coverage currently ' +
        'dark deficit depot depots distance efficiency feed figure flagged flags fleet for gone ' +
        'had has have here holds homed in index is it its known latest leave level lost ' +
        'maintenance maximum moving network now of off on plan position proposes rate receiving ' +
        'reporting reports road running schedule sending share short signal snapshot stand ' +
        'stands surplus that the this those though time to updated was were which while with yard',
    );
    expect([...AFTER_FIGURE_WORDS].sort().join(' ')).toBe(
      'against already among and are at away between beyond cover dark due fall falls flagged ' +
        'from gone had has have here higher homed in inside is its keeps largest lost lower of ' +
        'off on overdue places reporting running scheduled small that the them to too was were ' +
        'which whose within would yet',
    );
    expect([...STATE_NOUNS].sort().join(' ')).toBe('balance deficit service surplus');
  });

  it('are stated in the system prompt, which stays under its byte cap', () => {
    const prompt = buildSystemPrompt('briefing');
    for (const list of [BEFORE_FIGURE_WORDS, AFTER_FIGURE_WORDS, STATE_NOUNS, CLAUSE_SCOPE_WORDS]) {
      expect(prompt).toContain(` ${list.join(' ')}`);
    }
    expect(prompt).toContain(`${FIGURE_WINDOW_WORDS} words`);
    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(MAX_SYSTEM_PROMPT_BYTES);
  });

  it('removed the day-shift words nothing needs', () => {
    for (const word of ['yesterday', 'tomorrow', 'tonight', 'morning', 'afternoon', 'evening']) {
      expect(isVocabularyWord(word)).toBe(false);
    }
    for (const word of ['daytime', 'overnight', 'wrong', 'false', 'fake']) {
      expect(isVocabularyWord(word)).toBe(false);
    }
  });
});

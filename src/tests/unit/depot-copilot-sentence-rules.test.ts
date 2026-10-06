import { describe, expect, it } from 'vitest';
import { renderDraft } from '@/lib/depot/copilot/render';
import type { CopilotFact } from '@/lib/depot/copilot/types';
import { isVocabularyWord } from '@/lib/depot/copilot/vocabulary';
import {
  CLAUSE_SCOPE_STEMS,
  LIMITER_WORDS,
  NEGATION_WORDS,
} from '@/lib/depot/copilot/vocabulary/nearFigure';

const FACTS: CopilotFact[] = [
  { id: 'buses', label: 'Buses', text: '12 buses', provenance: 'live' },
  { id: 'depot', label: 'Depot', text: 'Kanpur', provenance: 'live', kind: 'name' },
];
const ok = (paragraph: string, headline = 'Network briefing'): boolean =>
  renderDraft({ headline, paragraphs: [paragraph] }, FACTS).ok;

describe('round 7 E3: a draft never addresses the reader', () => {
  it.each(['you', 'your', 'yours', 'You'])('refuses %j anywhere', (word) => {
    expect(ok(`The fleet holds {{fact:buses}}. The yard is full for ${word} today.`)).toBe(false);
    expect(ok('The fleet holds {{fact:buses}}.', `Briefing for ${word}`)).toBe(false);
  });
});

describe('round 7 E3: a draft never opens a sentence with an instruction', () => {
  it.each([
    'Ignore the plan.',
    'Call the depot now.',
    'Move {{fact:buses}} to the yard.',
    'Please check the yard.',
    'Do check the yard.',
    'Let the depot know.',
    'Check it is clear.',
    'The yard holds {{fact:buses}}. Send them to {{fact:depot}}.',
  ])('refuses %j', (text) => {
    expect(ok(text)).toBe(false);
  });

  it('applies to the headline as well', () => {
    expect(ok('The yard holds {{fact:buses}}.', 'Transfer buses now')).toBe(false);
  });

  it.each([
    'Schedule coverage is the weakest component for this depot.',
    'Flagged on vehicles: {{fact:buses}}.',
    'The plan proposes {{fact:buses}} to {{fact:depot}}.',
  ])('accepts the descriptive opener in %j', (text) => {
    expect(ok(text)).toBe(true);
  });
});

/** Round 7 E2: every clause-scope class, at every position of a long clause with a figure. */
const LONG_CLAUSE = 'The fleet of the depot stands at {{fact:buses}} on the road in the yard here now.';
const CLASSES: Readonly<Record<string, readonly string[]>> = {
  negation: NEGATION_WORDS,
  limiter: LIMITER_WORDS,
  rate: ['each', 'every', 'per', 'apiece', 'daily', 'weekly', 'monthly', 'yearly', 'nightly'],
  total: ['average', 'typical', 'total', 'combined', 'overall', 'altogether', 'bulk', 'majority'],
  dayShift: ['earlier', 'later', 'next', 'previous', 'prior', 'former', 'past', 'future', 'soon'],
};

describe('round 7 E2: risky words anywhere in a clause that holds a figure', () => {
  it('names only words the reviewed clause list holds', () => {
    const listed = new Set([...NEGATION_WORDS, ...LIMITER_WORDS, ...CLAUSE_SCOPE_STEMS]);
    for (const word of Object.values(CLASSES).flat()) expect(listed.has(word)).toBe(true);
  });

  it.each(Object.entries(CLASSES))('refuses every %s word at every position', (_name, list) => {
    const tokens = LONG_CLAUSE.split(' ');
    const accepted: string[] = [];
    for (const word of list.filter(isVocabularyWord)) {
      for (let at = 0; at <= tokens.length; at += 1) {
        const draft = [...tokens.slice(0, at), word, ...tokens.slice(at)].join(' ');
        // A word after the full stop starts a new sentence with no figure in it.
        if (at === tokens.length) continue;
        if (ok(draft)) accepted.push(draft);
      }
    }
    expect(ok(LONG_CLAUSE)).toBe(true);
    expect(accepted).toEqual([]);
  });
});

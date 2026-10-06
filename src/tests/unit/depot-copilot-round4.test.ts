import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '@/lib/depot/copilot/cli/prompt';
import {
  FIGURE_LINK_WORDS,
  FIGURE_QUALIFIER_WORDS,
  FIGURE_UNIT_WORDS,
  MAX_PARAGRAPHS,
  MAX_PROVIDER_PARAGRAPHS,
  MAX_SYSTEM_PROMPT_BYTES,
} from '@/lib/depot/copilot/limits';
import { renderDraft } from '@/lib/depot/copilot/render';
import type { CopilotFact } from '@/lib/depot/copilot/types';
import {
  REGULAR_ENDINGS,
  VOCABULARY_WORDS,
  isVocabularyWord,
  reductionsOf,
} from '@/lib/depot/copilot/vocabulary';
import { EXCLUDED_QUANTITY_WORDS } from '@/lib/depot/copilot/vocabulary/excluded';

const fact = (id: string, text: string, kind?: 'name'): CopilotFact => ({
  id,
  label: id,
  text,
  provenance: 'live',
  ...(kind ? { kind } : {}),
});

const FACTS: readonly CopilotFact[] = [
  fact('a', '3'),
  fact('b', '5'),
  fact('rev', '1,204'),
  fact('pct', '71%'),
  fact('time', '14:05'),
  fact('buses', '6 buses'),
  fact('name', 'Agra', 'name'),
];

const accepts = (paragraph: string): boolean =>
  renderDraft({ headline: 'Network briefing', paragraphs: [paragraph] }, FACTS).ok;

/** Every form the endings rule can build from the listed words. */
function builtForms(): readonly string[] {
  return VOCABULARY_WORDS.filter((w) => /^[a-z]+$/.test(w)).flatMap((stem) => [
    stem,
    ...REGULAR_ENDINGS.map((e) => `${stem}${e}`),
    ...(stem.endsWith('e') ? [`${stem.slice(0, -1)}ing`] : []),
    ...(stem.endsWith('y') ? [`${stem.slice(0, -1)}ies`, `${stem.slice(0, -1)}ied`] : []),
  ]);
}

/** Item 15: quantity words a reader in India would recognise, English and transliterated Hindi. */
const PROBE: readonly string[] = `
zero one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty
hundred thousand million billion lakh lac crore dozen score couple pair both half quarter third
first second fourth fifth once twice thrice single double triple treble quadruple twofold
triply doubly singly dayly days weeks months years hours minutes seconds decade fortnight century
km kilometre kilometer mile metre meter litre liter kg tonne ton degree percent percentage
rupee rupees paise paisa dollar pound euro cent rs inr usd
ek do teen tin char chaar paanch panch che chhe chah saat sat aath ath nau das dus gyarah barah
bees bis tees pachas pachaas sau sao hazaar hazar hajar lakhs lacs crores karod karor arab
aadha adha aadhi dedh dhai paune pauna sawa sava dugna duguna doguna tiguna chauguna dono teeno
pehla pahla doosra dusra teesra tisra shunya sifar darjan
`
  .trim()
  .split(/\s+/);
/** "do" stays as the English verb (ruling S38 item 15); nothing else on the probe list may pass. */
const PROBE_ALLOWED: readonly string[] = ['do'];

describe('vocabulary endings (S38 items 6 and 15)', () => {
  const accepted = builtForms().filter(isVocabularyWord);
  const excluded = new Set(EXCLUDED_QUANTITY_WORDS);

  it('accepts no built form that is, or reduces to, an excluded quantity word', () => {
    const leaks = accepted.filter(
      (form) =>
        excluded.has(form) ||
        (!VOCABULARY_WORDS.includes(form) && reductionsOf(form).some((r) => excluded.has(r))),
    );
    expect(leaks).toEqual([]);
  });

  it.each(['dayes', 'weekes', 'monthes', 'yeares', 'dayly', 'triply'])('refuses %s', (form) => {
    expect(isVocabularyWord(form)).toBe(false);
  });

  it('accepts no number, ordinal, fraction, multiplier, unit or currency word', () => {
    const probe = new Set(PROBE.filter((w) => !PROBE_ALLOWED.includes(w)));
    expect(accepted.filter((form) => probe.has(form))).toEqual([]);
    expect([...probe].filter(isVocabularyWord)).toEqual([]);
    expect(PROBE_ALLOWED.every(isVocabularyWord)).toBe(true);
  });

  it('still accepts ordinary inflections', () => {
    for (const form of ['comes', 'coming', 'tends', 'buses', 'depots', 'nights', 'yards']) {
      expect([form, isVocabularyWord(form)]).toEqual([form, true]);
    }
  });
});

describe('what the model may write around a figure (S38)', () => {
  const REFUSED: readonly string[] = [
    // The review's passing inputs.
    'Demand triply exceeds {{fact:a}}.',
    'The backlog is {{fact:a}} monthes old.',
    'The plan covers {{fact:a}} yeares.',
    'Buses idle {{fact:a}} dayes.',
    'A {{fact:a}} day backlog.',
    'A {{fact:a}} week plan.',
    'Demand is {{fact:buses}} per month.',
    'Demand is {{fact:buses}} a day.',
    'Demand is {{fact:buses}} daily.',
    'The plan is {{fact:a}} yearly',
    'The yard is {{fact:a}} yards long.',
    'Fuel is {{fact:a}} units.',
    'The depots hold {{fact:buses}} each.',
    '{{fact:a}} to {{fact:b}}',
    '{{fact:a}} of {{fact:b}}',
    '{{fact:a}} in {{fact:b}}',
    '{{fact:a}} by {{fact:b}}',
    '{{fact:a}} over {{fact:b}}',
    '{{fact:a}} per {{fact:b}}',
    '{{fact:a}} or {{fact:b}}',
    '{{fact:a}} (of {{fact:b}}) buses.',
    '{{fact:a}} out of {{fact:b}}',
    '{{fact:a}} of the {{fact:b}}',
    'At least one of these {{fact:a}}',
    'NONE ON VEHICLES',
    'None overdue to leave the yard {{fact:a}}.',
    'On one of the topics above.',
    'The depot-level ones are few.',
    'Not {{fact:a}} buses.',
    'No {{fact:a}} buses.',
    'Without {{fact:a}} buses.',
    'Fewer than {{fact:a}} buses.',
    'More than {{fact:a}} buses.',
    'Down {{fact:a}} buses.',
    'Up {{fact:a}} buses.',
    'Exactly {{fact:a}} buses.',
    'Almost {{fact:pct}} more.',
    'Nearly {{fact:pct}} are dark.',
    'About {{fact:a}} buses.',
    'Over {{fact:a}} buses.',
    'Under {{fact:a}} buses.',
    "The fleet isn't {{fact:buses}} strong.",
    // Unit words on either side of a figure.
    'Each night {{fact:buses}} leave.',
    'The count is per {{fact:a}} buses.',
    'Dark buses: {{fact:a}}, daily.',
    'Dark buses: {{fact:a}} nightly.',
    'Demand is {{fact:buses}} apiece.',
  ];

  it.each(REFUSED)('refuses %s', (paragraph) => {
    expect(accepts(paragraph)).toBe(false);
  });

  const ACCEPTED: readonly string[] = [
    '{{fact:a}} and {{fact:b}} are the figures.',
    '{{fact:buses}}, and {{fact:pct}} of the fleet.',
    '{{fact:a}}; {{fact:rev}}',
    '{{fact:time}}, {{fact:buses}} are dark.',
    'The yard is full.',
    'The fleet is {{fact:buses}}. Each depot reports daily.',
    'Sending {{fact:buses}} to {{fact:name}} helps.',
    'From {{fact:name}} to {{fact:name}} is a short run.',
    'Only {{fact:buses}} are dark.',
    'The dark share is not high: {{fact:pct}} of the fleet.',
  ];

  it.each(ACCEPTED)('accepts %s', (paragraph) => {
    expect(accepts(paragraph)).toBe(true);
  });

  it('names the three word lists it checks', () => {
    expect(FIGURE_UNIT_WORDS).toEqual(
      expect.arrayContaining(
        'day days week weeks month months year years daily weekly monthly yearly night time times unit units yard yards each per apiece'.split(
          ' ',
        ),
      ),
    );
    expect(FIGURE_QUALIFIER_WORDS).toEqual(
      expect.arrayContaining(
        'not no without than exactly almost nearly about over under down up'.split(' '),
      ),
    );
    expect(FIGURE_LINK_WORDS).toEqual(
      expect.arrayContaining(['to', 'of', 'in', 'by', 'over', 'per', 'or', 'and']),
    );
  });
});

describe('paragraph cap for providers (S38 item 13)', () => {
  const draft = (n: number): { headline: string; paragraphs: string[] } => ({
    headline: 'Network briefing',
    paragraphs: Array.from({ length: n }, () => 'The fleet is steady.'),
  });

  it('keeps one paragraph free for the stale notice', () => {
    expect(MAX_PROVIDER_PARAGRAPHS).toBe(MAX_PARAGRAPHS - 1);
    expect(renderDraft(draft(MAX_PROVIDER_PARAGRAPHS), FACTS).ok).toBe(true);
    expect(renderDraft(draft(MAX_PARAGRAPHS), FACTS).ok).toBe(false);
  });
});

describe('system prompt states the rules (S38 item 12)', () => {
  const prompt = buildSystemPrompt('briefing');

  it('lists every restricted word and the provider paragraph cap', () => {
    for (const word of [...FIGURE_UNIT_WORDS, ...FIGURE_QUALIFIER_WORDS, ...FIGURE_LINK_WORDS]) {
      expect(prompt).toContain(` ${word}`);
    }
    expect(prompt).toContain(`at most ${MAX_PROVIDER_PARAGRAPHS} paragraphs`);
    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(MAX_SYSTEM_PROMPT_BYTES);
  });

  it('makes none of the three claims the validator does not enforce', () => {
    expect(prompt).not.toContain('Number, unit and currency words are never allowed');
    expect(prompt).not.toContain('may end with a full stop or with a word');
    expect(prompt).not.toContain('when the first is a name or ends in its unit');
    expect(prompt).not.toContain('Only these fixed phrases');
  });
});

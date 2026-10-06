import { describe, expect, it } from 'vitest';
import { QUANTITY_SUFFIXES, QUANTITY_WORDS } from '@/lib/depot/copilot/limits';
import { renderDraft } from '@/lib/depot/copilot/render';
import type { CopilotFact } from '@/lib/depot/copilot/types';
import { EXCLUDED_WORDS, isRomanNumeral } from '@/lib/depot/copilot/vocabulary/excluded';
import {
  isVocabularyWord,
  REGULAR_ENDINGS,
  VOCABULARY_WORDS,
} from '@/lib/depot/copilot/vocabulary';

const fact = (id: string, text: string): CopilotFact => ({
  id,
  label: id,
  text,
  provenance: 'live',
});
const FACTS: readonly CopilotFact[] = [
  fact('a', '3'),
  fact('b', '5'),
  fact('rev', '1,204'),
  fact('name', 'AGRA'),
  fact('n2', 'KANPUR'),
  fact('n3', 'MEERUT'),
  fact('pct', '71%'),
  fact('dash', '\u2014'),
  fact('buses', '31 buses'),
  fact('depots', '7 depots'),
  fact('clock', '14:05'),
];
const render = (text: string, headline = 'Network briefing'): boolean =>
  renderDraft({ headline, paragraphs: [text] }, FACTS).ok;

/** Every input the round-two security review showed passing; each must be rejected. */
const HOSTILE: readonly string[] = [
  // Finding 1: placeholders joined by spaces, marks or single letters
  '{{fact:a}} {{fact:b}}',
  '{{fact:a}} - {{fact:b}}',
  '{{fact:a}} . {{fact:b}}',
  '{{fact:a}}- {{fact:b}}',
  '{{fact:a}}: {{fact:b}}',
  '{{fact:a}} e {{fact:b}}',
  '{{fact:a}} x {{fact:b}}',
  // Finding 2: signs and decimal points
  '"-{{fact:a}}"',
  "'.{{fact:a}}'",
  'Change:-{{fact:a}}',
  '-.{{fact:a}}',
  '--{{fact:a}}',
  ';.{{fact:a}}',
  // Finding 2: units and magnitudes
  '{{fact:rev}} Cr',
  '{{fact:rev}} lac',
  '{{fact:rev}} K',
  'Rs {{fact:rev}}',
  '{{fact:a}} pct',
  '{{fact:a}} bps',
  '{{fact:a}} km',
  '{{fact:a}}-fold',
  '{{fact:name}}.com',
  // Finding 4: number words
  'Twentyone buses idle.',
  'TWENTYONE',
  'TwentyOne',
  'Fourscore buses.',
  'twentyfourth',
  'thirtysixth',
  'twohundredth',
  'twentyfivefold',
  'twentyfives',
  't  w  o',
  't. w. o',
  't w o',
  'T W O',
  'The lac figure.',
  'A trio of depots.',
  'A dual role.',
  'It quintupled.',
  'Over a decade.',
  'Within a fortnight.',
  'Umpteen buses.',
  // Words the review noted and the ruling keeps out
  'The punctuality score is high.',
  'Both depots are steady.',
  'The second depot is weak.',
  'A single bus is dark.',
  'MD',
  'CM',
  'DM',
  'DC',
];

describe('hostile inputs from the security review', () => {
  it.each(HOSTILE)('rejects %j', (text) => {
    expect(render(text)).toBe(false);
    expect(render('The fleet is steady.', text)).toBe(false); // as a headline too
  });

  it('never returns draft text in the reason', () => {
    const result = renderDraft(
      { headline: 'Xyzzy plugh', paragraphs: ['Qwerty {{fact:zz}}.'] },
      FACTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toMatch(/xyzzy|plugh|qwerty|zz/i);
  });
});

describe('token grammar boundaries', () => {
  const accepted: readonly string[] = [
    'The fleet is steady.',
    'THE FLEET IS STEADY.', // matching is case-insensitive on the whole token
    'the fleet is steady', // a full stop is optional
    'The fleet, the yard; the road: all steady.',
    'The fleet (and the yard) is steady.',
    'The depot is "stretched".',
    'The fleet is at {{fact:a}}.',
    'The fleet ({{fact:a}}) is here.',
    'The fleet stands at {{fact:a}}, and {{fact:b}}; it has {{fact:rev}}: steady.',
    "The depot's fleet is steady.",
    "It isn't steady.",
    'The depot-level picture is steady.',
    '{{fact:name}}, {{fact:n2}} and {{fact:n3}} are steady.',
    '{{fact:a}} and {{fact:b}} are dark.',
    '{{fact:name}} has {{fact:a}}.',
    '{{fact:name}} at {{fact:a}}; {{fact:n2}} at {{fact:b}}.',
    'The fleet is {{fact:depots}}, {{fact:buses}} between them.',
    'As of {{fact:clock}}, {{fact:buses}} are reporting ({{fact:pct}}); {{fact:a}} are dark.',
  ];
  it.each(accepted)('accepts %j', (text) => expect(render(text)).toBe(true));

  const refused: readonly (readonly [string, string])[] = [
    ['double space', 'The fleet  is steady.'],
    ['trailing space', 'The fleet is steady. '],
    ['leading space', ' The fleet is steady.'],
    ['two marks', 'The fleet is steady..'],
    ['mark then quote', 'The depot is "stretched."'],
    ['mark before a word', 'The ,fleet is steady.'],
    ['double opener', 'The (("fleet is steady.'],
    ['hyphen outside a vocabulary form', 'The fleet-yard is steady.'],
    ['hyphen at a word edge', 'The fleet- is steady.'],
    ['apostrophe outside a vocabulary form', "The fleet'd steady."],
    ['possessive of an unknown word', "The xyzzy's fleet."],
    ['out-of-vocabulary word', 'The fleet is xyzzy.'],
    ['single letter', 'The fleet is b steady.'],
    ['sign before a placeholder', 'The fleet is -{{fact:a}}.'],
    ['decimal point before a placeholder', 'The fleet is .{{fact:a}}.'],
    ['percent after a placeholder', 'The fleet is {{fact:a}}%.'],
    ['letter after a placeholder', 'The fleet is {{fact:a}}s.'],
    ['quote around a placeholder', 'The fleet is "{{fact:a}}".'],
    ['hyphen after a placeholder', 'The fleet is {{fact:a}}-strong.'],
    ['two figures, space only', 'The fleet is {{fact:a}} {{fact:b}}.'],
    ['two figures, comma only', 'The fleet is {{fact:a}}, {{fact:b}}.'],
    ['two figures, single letter', 'The fleet is {{fact:a}} a {{fact:b}}.'],
    ['two names, space only', '{{fact:name}} {{fact:n2}} are steady.'],
    ['two names, colon only', '{{fact:name}}: {{fact:n2}} are steady.'],
    ['bare figure, comma, percentage', 'The fleet is {{fact:a}}, {{fact:pct}}.'],
    ['dash, comma, figure', 'The fleet is {{fact:dash}}, {{fact:a}}.'],
    ['unit figures, space only', 'The fleet is {{fact:buses}} {{fact:depots}}.'],
    ['name then figure, space only', '{{fact:name}} {{fact:a}} are dark.'],
    ['Roman numeral capitals of a listed word', 'The fleet DID move.'],
    ['unknown fact', 'The fleet is {{fact:zz}}.'],
    ['tab', 'The fleet\tis steady.'],
    ['newline', 'The fleet\nis steady.'],
  ];
  it.each(refused)('refuses %s', (_label, text) => expect(render(text)).toBe(false));
});

describe('vocabulary invariants', () => {
  const NET = new RegExp(
    `^(?:${QUANTITY_WORDS.filter((w) => !w.includes(' ')).join('|')})(?:${QUANTITY_SUFFIXES.join('|')})?$`,
  );
  /** Every form the matcher can accept: listed words and listed words with an ending. */
  const forms = VOCABULARY_WORDS.flatMap((w) => [
    w,
    ...REGULAR_ENDINGS.map((e) => `${w}${e}`),
  ]).filter(isVocabularyWord);

  it('is a closed list of roughly two to three thousand forms', () => {
    expect(new Set(VOCABULARY_WORDS).size).toBe(VOCABULARY_WORDS.length);
    expect(VOCABULARY_WORDS.every((w) => /^[a-z]+(?:['-][a-z]+)*$/.test(w))).toBe(true);
    expect(forms.length).toBeGreaterThan(2000);
  });

  it('never contains an excluded word, in any form the endings can build', () => {
    expect(EXCLUDED_WORDS.filter((w) => isVocabularyWord(w))).toEqual([]);
    expect(VOCABULARY_WORDS.filter((w) => EXCLUDED_WORDS.includes(w))).toEqual([]);
    expect(forms.filter((w) => EXCLUDED_WORDS.includes(w) || NET.test(w))).toEqual([]);
  });

  it('refuses every cardinal, ordinal, magnitude, unit, currency and link word by name', () => {
    const named =
      'zero one two three ten twelve twenty ninety first second third fifth twentieth once twice ' +
      'thrice single double triple dual trio pair couple dozen score both half quarter twofold ' +
      'hundred thousand million billion lakh lac lacs crore cr percent pct pc bps pp km kilometre ' +
      'kilometres mile metre hour hours hrs minute minutes fortnight decade rupee rupees rs inr ' +
      'nil none www http https mailto javascript com org net times days ones';
    expect(named.split(' ').filter((w) => isVocabularyWord(w))).toEqual([]);
  });

  it('holds no Roman numeral and no single letter other than "a"', () => {
    expect(forms.filter(isRomanNumeral)).toEqual([]);
    expect(forms.filter((w) => w.length === 1)).toEqual(['a']);
    expect(
      ['i', 'v', 'x', 'k', 'm', 'e', 'vi', 'xl', 'mix', 'mi'].filter(isVocabularyWord),
    ).toEqual([]);
  });

  it('allows the vague quantifiers that state no figure', () => {
    expect(['most', 'many', 'few', 'several', 'some', 'all'].every(isVocabularyWord)).toBe(true);
  });

  it('lets no ending rebuild an excluded word', () => {
    expect(isVocabularyWord('time')).toBe(true);
    expect(isVocabularyWord('times')).toBe(false);
    expect(isVocabularyWord('day')).toBe(true);
    expect(isVocabularyWord('days')).toBe(false);
    expect(isVocabularyWord('ones')).toBe(false);
  });
});

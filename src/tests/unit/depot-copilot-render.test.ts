import { describe, expect, it } from 'vitest';
import type { CopilotDraft, CopilotFact } from '@/lib/depot/copilot/types';
import {
  MAX_FACT_TEXT_CHARS,
  MAX_RENDERED_HEADLINE_CHARS,
  MAX_RENDERED_PARAGRAPH_CHARS,
  MAX_HEADLINE_CHARS,
  MAX_PARAGRAPHS,
  MAX_PARAGRAPH_CHARS,
  QUANTITY_WORDS,
} from '@/lib/depot/copilot/limits';
import { renderDraft, sanitizeFactText } from '@/lib/depot/copilot/render';
import {
  INVISIBLE_CHARACTERS as ROUTER_INVISIBLE,
  sanitizeQuestion,
} from '@/lib/depot/copilot/router/sanitize';
import { INVISIBLE_CHARACTERS } from '@/lib/depot/copilot/unsafeText';

const fact = (id: string, text: string): CopilotFact => ({
  id,
  label: id,
  text,
  provenance: 'derived',
});

const FACTS: readonly CopilotFact[] = [
  fact('buses', '1,204'),
  fact('share', '31%'),
  fact('depot', 'BAREILLY(R)'),
];

const draft = (headline: string, ...paragraphs: string[]): CopilotDraft => ({
  headline,
  paragraphs,
});

const rejected = (d: CopilotDraft): string => {
  const result = renderDraft(d, FACTS);
  if (result.ok) throw new Error('expected rejection');
  return result.reason;
};

describe('renderDraft', () => {
  it('renders a valid draft and lists used ids in first-use order', () => {
    const result = renderDraft(
      draft('{{fact:depot}} at a glance', 'Fleet is {{fact:buses}}, share {{fact:share}}.'),
      FACTS,
    );
    expect(result).toEqual({
      ok: true,
      headline: 'BAREILLY(R) at a glance',
      paragraphs: ['Fleet is 1,204, share 31%.'],
      usedFactIds: ['depot', 'buses', 'share'],
    });
  });

  it('substitutes a repeated placeholder everywhere but lists the id once', () => {
    const result = renderDraft(draft('Fleet', '{{fact:buses}} then {{fact:buses}}.'), FACTS);
    expect(result).toMatchObject({ ok: true, paragraphs: ['1,204 then 1,204.'] });
    expect(result.ok && result.usedFactIds).toEqual(['buses']);
  });

  it('accepts fact text that itself contains digits', () => {
    expect(renderDraft(draft('Fleet', 'Count {{fact:buses}}.'), FACTS).ok).toBe(true);
  });

  it('does not expand a placeholder that appears inside fact text', () => {
    const facts = [fact('a', 'see {{fact:b}}'), fact('b', 'BOOM')];
    const result = renderDraft(draft('Head', 'Value {{fact:a}}.'), facts);
    expect(result).toMatchObject({ ok: true, paragraphs: ['Value see fact:b.'] });
  });

  it('rejects an unknown fact id', () => {
    expect(rejected(draft('Head', 'Value {{fact:missing}}.'))).toMatch(/unknown fact/i);
  });

  it('rejects a stray digit outside a placeholder', () => {
    expect(rejected(draft('Head', 'About 5 buses.'))).toMatch(/digit/i);
    expect(rejected(draft('Head 2', 'Fine.'))).toMatch(/digit/i);
  });

  it.each(QUANTITY_WORDS)('rejects the quantity word %s', (word) => {
    expect(rejected(draft('Head', `There are ${word} of them.`))).toMatch(/quantity/i);
    expect(rejected(draft('Head', `THERE ARE ${word.toUpperCase()}.`))).toMatch(/quantity/i);
  });

  it('allows the word one and does not match inside longer words', () => {
    expect(
      renderDraft(draft('Head', 'One depot stands out, in a thirdly odd way.'), FACTS).ok,
    ).toBe(true);
  });

  it.each(['a <b> tag', 'use `code`', 'see http://x.example', 'HTTPS://x', 'a > b'])(
    'rejects markup in %s',
    (text) => {
      expect(rejected(draft('Head', text))).toMatch(/markup/i);
    },
  );

  it.each(['{{fact:}}', '{{ fact:buses }}', '{{fact:buses', 'oops }} here', '{{fact:BUSES}}'])(
    'rejects the malformed placeholder %s',
    (text) => {
      expect(renderDraft(draft('Head', text), FACTS).ok).toBe(false);
    },
  );

  it('rejects oversize headline, paragraph and paragraph count', () => {
    expect(rejected(draft('x'.repeat(MAX_HEADLINE_CHARS + 1), 'ok'))).toMatch(/shape|headline/i);
    expect(rejected(draft('Head', 'x'.repeat(MAX_PARAGRAPH_CHARS + 1)))).toMatch(
      /shape|paragraph/i,
    );
    const many = Array.from({ length: MAX_PARAGRAPHS + 1 }, () => 'ok');
    expect(rejected(draft('Head', ...many))).toMatch(/shape|paragraph/i);
  });

  it('accepts drafts exactly at the limits', () => {
    const full = Array.from({ length: MAX_PARAGRAPHS }, () => 'x'.repeat(MAX_PARAGRAPH_CHARS));
    expect(renderDraft(draft('h'.repeat(MAX_HEADLINE_CHARS), ...full), FACTS).ok).toBe(true);
  });

  it('rejects control characters', () => {
    expect(rejected(draft('Head', 'line\u0000break'))).toMatch(/control/i);
    expect(rejected(draft('Head', 'line\nbreak'))).toMatch(/control/i);
    expect(rejected(draft('He\tad', 'ok'))).toMatch(/control/i);
  });

  it('rejects an empty paragraph list, empty headline and empty paragraph', () => {
    expect(renderDraft(draft('Head'), FACTS).ok).toBe(false);
    expect(renderDraft(draft('', 'ok'), FACTS).ok).toBe(false);
    expect(renderDraft(draft('Head', ''), FACTS).ok).toBe(false);
  });

  it('rejects input of the wrong shape', () => {
    const bad = { headline: 1, paragraphs: 'x' } as unknown as CopilotDraft;
    expect(rejected(bad)).toMatch(/shape/i);
  });

  describe('allowlist (bypasses of the digit and word checks)', () => {
    it.each([
      ['Devanagari digits', 'About १२ buses.'],
      ['Arabic-Indic digits', 'About ٣٤ buses.'],
      ['full-width digits', 'About １２ buses.'],
      ['mathematical digits', 'About \u{1D7D0}\u{1D7D1} buses.'],
      ['superscript digits', 'About ² buses.'],
      ['circled numbers', 'About ① buses.'],
      ['vulgar fractions', 'About ½ of buses.'],
      ['roman numeral characters', 'About Ⅻ buses.'],
      ['soft hyphen splitting a word', 'There are th­ree of them.'],
      ['zero-width space splitting a word', 'There are t​wo of them.'],
      ['bidi override', 'Fleet ‮is late.'],
      ['line separator', 'Fleet is late.'],
      ['unicode tag character', 'Fleet \u{E0041} is late.'],
      ['Cyrillic homoglyph', 'There are twо of them.'],
      ['full-width letters', 'There are ｔｗｏ of them.'],
      ['percent sign', 'Late share is high %.'],
      ['at sign', 'Mail me @ home.'],
      ['curly quote', 'Fleet’s late.'],
    ])('rejects %s', (_name, text) => {
      expect(renderDraft(draft('Head', text), FACTS).ok).toBe(false);
      expect(renderDraft(draft(text, 'ok'), FACTS).ok).toBe(false);
    });

    it('rejects a percent sign after a placeholder', () => {
      expect(rejected(draft('Head', 'Share {{fact:share}}% late.'))).toBeTruthy();
    });

    it.each([
      'Adjacent {{fact:buses}}{{fact:share}} here.',
      'Touching{{fact:buses}} a letter.',
      'Touching {{fact:buses}}s a letter.',
    ])('rejects placeholder adjacency in %s', (text) => {
      expect(rejected(draft('Head', text))).toMatch(/adjacen|placeholder/i);
    });

    it.each([
      'Hundreds of buses.',
      'Thousands late.',
      'Lakhs of trips.',
      'Fares doubled.',
      'Twenty buses.',
      'Thirteen buses.',
      'Ninety buses.',
      'Zero buses.',
      'A billion trips.',
      'A couple of buses.',
      'Several buses.',
      'Both depots.',
      'The majority is late.',
      'Once again.',
      'Thrice a day.',
      'A single bus.',
      'Fivefold growth.',
      'Halves the gap.',
      'A fifth of buses.',
      'Per cent of buses.',
      'The percentage is high.',
      'Most buses are late.',
    ])('rejects the widened quantity word in %s', (text) => {
      expect(rejected(draft('Head', text))).toMatch(/quantity/i);
    });

    it.each(['It is XII buses.', 'Section MCM here.'])('rejects roman numerals in %s', (text) => {
      expect(rejected(draft('Head', text))).toMatch(/roman/i);
    });

    it.each([
      'Visit evil.com today.',
      'See www. now.',
      'Use mailto for it.',
      'Use javascript for it.',
      'It ends.Next starts.',
    ])('rejects a link or bare domain in %s', (text) => {
      expect(renderDraft(draft('Head', text), FACTS).ok).toBe(false);
    });

    it.each([
      'Bareilly leads its peer group, and one of its yards is full.',
      'Depot ({{fact:depot}}) is full.',
      'Depot is {{fact:depot}}.',
      '"{{fact:depot}}" leads; the rest follow: slowly.',
      'A well-known yard is full.',
      "It's the larger yard.",
    ])('still accepts ordinary prose: %s', (text) => {
      expect(renderDraft(draft('Head', text), FACTS).ok).toBe(true);
    });

    it('rejects duplicate fact ids', () => {
      const dup = [fact('a', 'x'), fact('a', 'y')];
      expect(renderDraft(draft('Head', 'Value {{fact:a}}.'), dup).ok).toBe(false);
    });
  });

  describe('fact text and rendered size', () => {
    it('sanitises and caps fact text on insertion', () => {
      const messy = fact('a', `‮evil\nline ${'x'.repeat(500)}`);
      const result = renderDraft(draft('Head', 'Value {{fact:a}}.'), [messy]);
      expect(result.ok).toBe(true);
      const text = result.ok ? (result.paragraphs[0] ?? '') : '';
      expect(text).not.toMatch(/[‮\n]/);
      expect(text.startsWith('Value evil line')).toBe(true);
      expect(text.length).toBeLessThanOrEqual('Value .'.length + MAX_FACT_TEXT_CHARS);
    });

    it('rejects a rendered paragraph longer than the rendered cap', () => {
      const long = fact('a', 'y'.repeat(MAX_FACT_TEXT_CHARS));
      const body = Array.from({ length: 30 }, () => '{{fact:a}}').join(' ');
      expect(body.length).toBeLessThanOrEqual(600);
      const result = renderDraft(draft('Head', body), [long]);
      expect(result).toMatchObject({ ok: false });
      expect(!result.ok && result.reason.toLowerCase()).toContain('rendered');
      expect(long.text.length).toBe(MAX_FACT_TEXT_CHARS);
    });

    it('rejects a rendered headline longer than the rendered cap', () => {
      const long = fact('a', 'y'.repeat(MAX_FACT_TEXT_CHARS));
      const result = renderDraft(draft('{{fact:a}} {{fact:a}} {{fact:a}}', 'ok'), [long]);
      expect(result).toMatchObject({ ok: false });
      expect(MAX_RENDERED_HEADLINE_CHARS).toBe(240);
      expect(MAX_RENDERED_PARAGRAPH_CHARS).toBe(2000);
    });
  });

  describe('sanitizeFactText', () => {
    it('normalises, strips invisible characters, collapses whitespace and caps', () => {
      expect(sanitizeFactText('ＡＢ  a​b\t\nc\u0000')).toBe('AB ab c');
      expect(sanitizeFactText('x'.repeat(300))).toHaveLength(MAX_FACT_TEXT_CHARS);
      expect(sanitizeFactText('abcdef', 3)).toBe('ab…');
      expect(sanitizeFactText('\u{E0041}‮ok')).toBe('ok');
    });

    it('keeps ordinary fact values intact', () => {
      expect(sanitizeFactText('1,204')).toBe('1,204');
      expect(sanitizeFactText('BAREILLY(R)')).toBe('BAREILLY(R)');
      expect(sanitizeFactText('31%')).toBe('31%');
    });
  });

  describe('fused or re-signed figures and number-word tricks', () => {
    const two = [fact('a', '5'), fact('b', '2'), fact('depot', 'BAREILLY(R)')];
    const bad = (text: string): boolean => !renderDraft(draft('Head', text), two).ok;

    it.each([
      '{{fact:a}}.{{fact:b}}',
      '{{fact:a}},{{fact:b}}',
      '{{fact:a}}:{{fact:b}}',
      '{{fact:a}}-{{fact:b}}',
      '{{fact:a}}({{fact:b}})',
    ])('rejects fused placeholders in %s', (t) => expect(bad(`Value ${t} here.`)).toBe(true));

    it('accepts placeholders separated by words or spaces', () => {
      expect(bad('Between {{fact:a}} and {{fact:b}}.')).toBe(false);
      expect(bad('Values {{fact:a}} ({{fact:b}}) here.')).toBe(false);
    });

    it.each([
      'Down -{{fact:a}} now.',
      'See .{{fact:a}} now.',
      'See ,{{fact:a}} now.',
      '(-{{fact:a}})',
    ])('rejects a sign or decimal flip in %s', (t) => expect(bad(t)).toBe(true));

    it('rejects a domain suffix after a placeholder', () => {
      expect(bad('Visit {{fact:depot}}.com today.')).toBe(true);
    });

    it.each(['twentyfive', 'onehundred', 'fortytwo', 'sixteenhundred'])('rejects %s', (w) =>
      expect(bad(`It is ${w} buses.`)).toBe(true),
    );

    it.each([
      'often',
      'weight',
      'listen',
      'someone',
      'anyone',
      'network',
      'stone',
      'attend',
      'canine',
      'none',
      'tone',
      'height',
      'freight',
    ])('does not reject the ordinary word %s', (w) => expect(bad(`The ${w} is fine.`)).toBe(false));

    it.each([
      'first',
      'second',
      'twelfth',
      'twentieth',
      'ninetieth',
      'nil',
      'nought',
      'naught',
      'handful',
      'fours',
      'eights',
    ])('rejects the word %s', (w) => expect(bad(`The ${w} one.`)).toBe(true));

    it('accepts "tend" and does not use a d suffix', () => {
      expect(bad('Depots tend to be late.')).toBe(false);
    });

    it.each(['t w o', 't-w-o', 'a b c'])('rejects spaced single letters in %s', (t) =>
      expect(bad(`It is ${t} buses.`)).toBe(true),
    );

    it.each(['It is a bus.', 'Send an e-mail.'])('accepts %s', (t) => expect(bad(t)).toBe(false));
  });

  describe('fact sanitiser gaps', () => {
    it('removes markup characters and full-width forms of them', () => {
      expect(sanitizeFactText('a<b>`c`{d}[e]＜f＞')).toBe('abcdef');
    });

    it('uses the one unsafe-character pattern the router uses', () => {
      expect(ROUTER_INVISIBLE).toBe(INVISIBLE_CHARACTERS);
      // U+180E was on the router's list only; one list means both strip it.
      expect(sanitizeFactText('a᠎b')).toBe('ab');
      expect(sanitizeQuestion('a᠎b')).toBe('ab');
    });

    it('removes invisible fillers and variation selectors', () => {
      expect(sanitizeFactText('aㅤbᅠc⠀d͏e឴f឵g️h')).toBe('abcdefgh');
    });

    it('truncates at a word boundary with an ellipsis, within the cap', () => {
      const long = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
      const out = sanitizeFactText(long, 20);
      expect(out.endsWith('…')).toBe(true);
      expect(Array.from(out).length).toBeLessThanOrEqual(20);
      expect(out.slice(0, -1).trimEnd()).toBe(out.slice(0, -1));
      expect(long.startsWith(out.slice(0, -1))).toBe(true);
      expect(long[out.length - 1]).toBe(' ');
    });

    it('keeps text of exactly the cap and hard-cuts a spaceless value', () => {
      expect(sanitizeFactText('x'.repeat(MAX_FACT_TEXT_CHARS))).toBe(
        'x'.repeat(MAX_FACT_TEXT_CHARS),
      );
      const out = sanitizeFactText('y'.repeat(500));
      expect(Array.from(out)).toHaveLength(MAX_FACT_TEXT_CHARS);
      expect(out.endsWith('…')).toBe(true);
    });

    it('never splits a surrogate pair or a combining mark', () => {
      const emoji = sanitizeFactText('\u{1F600}'.repeat(50), 10);
      expect(Array.from(emoji)).toHaveLength(10);
      expect(emoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      // 'x' + U+0301 has no precomposed form, so NFKC keeps two code points.
      // A naive cut at 9 code points would keep the tenth 'x' and drop its mark.
      const marks = sanitizeFactText('x́'.repeat(20), 10);
      expect(marks).toBe(`${'x́'.repeat(4)}…`);
      expect(marks.slice(0, -1)).toMatch(/^(?:x́)+$/u);
      expect(Array.from(marks).length).toBeLessThanOrEqual(10);
    });
  });

  it('does not mutate its input', () => {
    const input = draft('{{fact:depot}}', 'Fleet {{fact:buses}}.');
    const snapshot = JSON.stringify(input);
    const factsSnapshot = JSON.stringify(FACTS);
    renderDraft(input, FACTS);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(JSON.stringify(FACTS)).toBe(factsSnapshot);
  });
});

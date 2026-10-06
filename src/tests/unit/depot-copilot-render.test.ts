import { describe, expect, it } from 'vitest';
import type { CopilotDraft, CopilotFact } from '@/lib/depot/copilot/types';
import {
  MAX_HEADLINE_CHARS,
  MAX_PARAGRAPHS,
  MAX_PARAGRAPH_CHARS,
  QUANTITY_WORDS,
} from '@/lib/depot/copilot/limits';
import { renderDraft } from '@/lib/depot/copilot/render';

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
    expect(result).toMatchObject({ ok: true, paragraphs: ['Value see {{fact:b}}.'] });
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
    expect(rejected(draft('Head', 'x'.repeat(MAX_PARAGRAPH_CHARS + 1)))).toMatch(/shape|paragraph/i);
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

  it('does not mutate its input', () => {
    const input = draft('{{fact:depot}}', 'Fleet {{fact:buses}}.');
    const snapshot = JSON.stringify(input);
    const factsSnapshot = JSON.stringify(FACTS);
    renderDraft(input, FACTS);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(JSON.stringify(FACTS)).toBe(factsSnapshot);
  });
});

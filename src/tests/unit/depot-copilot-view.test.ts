import { describe, expect, it } from 'vitest';
import {
  exampleQuestions,
  failureSentence,
  generatedAtText,
  groupFactsByProvenance,
  noticeSentence,
  providerTagText,
  validateQuestion,
} from '@/lib/depot/copilot/ui/copilotView';
import { MAX_QUESTION_CHARS } from '@/lib/depot/copilot/limits';
import type { CopilotFactView } from '@/lib/depot/copilot/wire';

describe('providerTagText', () => {
  it('names who wrote the text', () => {
    expect(providerTagText('claude')).toBe('Written by Claude');
    expect(providerTagText('scripted')).toBe('Scripted response');
  });
});

describe('noticeSentence', () => {
  it('gives a sentence per notice and nothing for none', () => {
    expect(noticeSentence('claude_unavailable')).toBe(
      'Claude was not available, so this is a scripted response.',
    );
    expect(noticeSentence('summary_unavailable')).toBe(
      'A written summary could not be prepared. The figures on this page are current.',
    );
    expect(noticeSentence('none')).toBeNull();
  });
});

describe('failureSentence', () => {
  it('uses the singular for one second and the plural otherwise', () => {
    expect(failureSentence('rate_limited', 1)).toBe('Too many requests. Try again in 1 second.');
    expect(failureSentence('rate_limited', 2)).toBe('Too many requests. Try again in 2 seconds.');
    expect(failureSentence('rate_limited', 0)).toBe('Too many requests. Try again in 0 seconds.');
  });

  it('has a distinct sentence for every other kind', () => {
    const kinds = [
      'session_expired',
      'not_found',
      'invalid',
      'forbidden',
      'unavailable',
      'network',
      'aborted',
    ] as const;
    const sentences = kinds.map((kind) => failureSentence(kind));
    expect(new Set(sentences).size).toBe(kinds.length);
    for (const sentence of sentences) expect(sentence.endsWith('.')).toBe(true);
  });
});

describe('generatedAtText', () => {
  it('shows the time in Indian Standard Time', () => {
    expect(generatedAtText('2026-10-06T09:30:00.000Z', false)).toBe('Written at 15:00 IST');
  });

  it('says so when the text was served from cache', () => {
    expect(generatedAtText('2026-10-06T09:30:00.000Z', true)).toBe(
      'Written at 15:00 IST, reused from earlier on this snapshot',
    );
  });

  it('gives no time for an unreadable stamp', () => {
    expect(generatedAtText('not a date', false)).toBe('Written just now');
  });
});

describe('validateQuestion', () => {
  it('trims and collapses whitespace', () => {
    expect(validateQuestion('  which   depots\n are  short? ')).toEqual({
      ok: true,
      question: 'which depots are short?',
      remaining: MAX_QUESTION_CHARS - 'which depots are short?'.length,
    });
  });

  it('rejects empty and whitespace-only input', () => {
    for (const raw of ['', '   ', '\n\t ']) {
      expect(validateQuestion(raw)).toMatchObject({ ok: false, reason: 'empty' });
    }
  });

  it('accepts exactly the cap and rejects one over, with the count', () => {
    expect(validateQuestion('a'.repeat(MAX_QUESTION_CHARS))).toMatchObject({
      ok: true,
      remaining: 0,
    });
    const over = validateQuestion('a'.repeat(MAX_QUESTION_CHARS + 5));
    expect(over).toMatchObject({ ok: false, reason: 'too_long', remaining: -5 });
    expect(over.ok === false && over.message).toContain('5 characters');
  });

  it('uses the singular for one character over', () => {
    const over = validateQuestion('a'.repeat(MAX_QUESTION_CHARS + 1));
    expect(over.ok === false && over.message).toContain('1 character ');
  });
});

describe('exampleQuestions', () => {
  it('offers network questions only, none about "this depot", for the whole network', () => {
    const examples = exampleQuestions(null);
    expect(examples).toHaveLength(4);
    for (const example of examples) expect(example.toLowerCase()).not.toContain('this depot');
    expect(examples.join(' ')).toContain('short of buses');
  });

  it('names the chosen depot in depot questions', () => {
    const examples = exampleQuestions('Kurla');
    expect(examples).toContain('Give me a summary of Kurla.');
    expect(examples).toContain('What exceptions does Kurla have?');
    for (const example of examples) expect(example.toLowerCase()).not.toContain('this depot');
  });

  it('stays within the question limit even for a very long depot name', () => {
    for (const example of exampleQuestions('D'.repeat(500))) {
      expect(example.length).toBeLessThanOrEqual(MAX_QUESTION_CHARS);
    }
  });
});

describe('groupFactsByProvenance', () => {
  const fact = (id: string, provenance: CopilotFactView['provenance']): CopilotFactView => ({
    id,
    label: id,
    text: id,
    provenance,
  });

  it('groups in a fixed order, keeps input order, and omits empty groups', () => {
    const groups = groupFactsByProvenance([
      fact('a', 'modelled'),
      fact('b', 'live'),
      fact('c', 'modelled'),
      fact('d', 'reference'),
    ]);
    expect(groups.map((g) => g.provenance)).toEqual(['live', 'modelled', 'reference']);
    expect(groups[1]?.facts.map((f) => f.id)).toEqual(['a', 'c']);
  });

  it('returns nothing for no facts', () => {
    expect(groupFactsByProvenance([])).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt,
  buildUserPrompt,
  PROMPT_EXAMPLES,
  PROMPT_REJECTED_EXAMPLES,
} from '@/lib/depot/copilot/cli/prompt';
import { AUTHORED_PHRASES } from '@/lib/depot/copilot/grammar';
import {
  MAX_HEADLINE_CHARS,
  MAX_PARAGRAPH_CHARS,
  MAX_RENDERED_HEADLINE_CHARS,
  MAX_RENDERED_PARAGRAPH_CHARS,
  MAX_SYSTEM_PROMPT_BYTES,
  TRAILING_MARKS,
} from '@/lib/depot/copilot/limits';
import { renderDraft } from '@/lib/depot/copilot/render';
import type { CopilotFact, CopilotRequest } from '@/lib/depot/copilot/types';
import { REGULAR_ENDINGS, VOCABULARY_WORDS } from '@/lib/depot/copilot/vocabulary';

const fact = (id: string, text: string): CopilotFact => ({
  id,
  label: id,
  text,
  provenance: 'live',
});
const FACTS: readonly CopilotFact[] = [
  fact('fleet', '1,204 buses'),
  fact('share', '71%'),
  fact('first_name', 'AGRA'),
  fact('other_name', 'KANPUR'),
  fact('third_name', 'MEERUT'),
];
const prompt = buildSystemPrompt('briefing');
const renders = (text: string): boolean =>
  renderDraft({ headline: 'Network briefing', paragraphs: [text] }, FACTS).ok;

describe('system prompt and validator agreement', () => {
  it('stays under the named byte cap with the whole vocabulary inside', () => {
    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(MAX_SYSTEM_PROMPT_BYTES);
    expect(prompt).toContain(`Allowed words: ${VOCABULARY_WORDS.join(' ')}`);
  });

  it.each(PROMPT_EXAMPLES)('quotes the accepted example %j, and it renders', (example) => {
    expect(prompt).toContain(example);
    expect(renders(example)).toBe(true);
  });

  it.each(PROMPT_REJECTED_EXAMPLES)(
    'quotes the rejected example %j, and it is refused',
    (example) => {
      expect(prompt).toContain(example);
      expect(renders(example)).toBe(false);
    },
  );

  it('states the caps before and after substitution, the grammar and the endings', () => {
    for (const cap of [
      MAX_HEADLINE_CHARS,
      MAX_PARAGRAPH_CHARS,
      MAX_RENDERED_HEADLINE_CHARS,
      MAX_RENDERED_PARAGRAPH_CHARS,
    ]) {
      expect(prompt).toContain(String(cap));
    }
    expect(prompt).toContain(`at most one of ${TRAILING_MARKS.join(' ')}`);
    expect(prompt).toContain(`endings ${REGULAR_ENDINGS.join(' ')}`);
    expect(prompt).toMatch(/exactly one space/);
    expect(prompt).toMatch(
      /Every figure, with its unit, and every name is a \{\{fact:id\}\} placeholder/,
    );
    expect(prompt).toMatch(/any other word, however ordinary, rejects the whole draft/);
    for (const phrase of AUTHORED_PHRASES) expect(prompt).toContain(phrase.join(' '));
  });

  it('no longer says a full stop must be followed by a space', () => {
    expect(prompt).not.toMatch(/full stop must be followed by a space/i);
    expect(prompt).toMatch(/may end with a full stop/);
  });

  it('refuses a fact id outside the documented pattern before it reaches a prompt', () => {
    const request: CopilotRequest = {
      task: 'answer',
      scopeLabel: 'Network',
      facts: [fact('Bad Id"\n', 'x')],
      guidance: 'Be brief.',
      scriptedDraft: { headline: 'Network briefing', paragraphs: ['Fine.'] },
    };
    expect(() => buildUserPrompt(request)).toThrow(/Invalid fact id/);
    expect(renderDraft(request.scriptedDraft, request.facts).ok).toBe(false);
  });
});

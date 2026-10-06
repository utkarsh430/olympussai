import { z } from 'zod';
import {
  MAX_HEADLINE_CHARS,
  MAX_PARAGRAPHS,
  MAX_PARAGRAPH_CHARS,
  QUANTITY_WORDS,
} from '@/lib/depot/copilot/limits';
import type { CopilotDraft, CopilotFact } from '@/lib/depot/copilot/types';

export type RenderResult =
  | {
      readonly ok: true;
      readonly headline: string;
      readonly paragraphs: readonly string[];
      readonly usedFactIds: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

export const draftSchema: z.ZodType<CopilotDraft> = z
  .object({
    headline: z.string().min(1).max(MAX_HEADLINE_CHARS),
    paragraphs: z.array(z.string().min(1).max(MAX_PARAGRAPH_CHARS)).min(1).max(MAX_PARAGRAPHS),
  })
  .strict();

const PLACEHOLDER = /\{\{fact:([a-z0-9][a-z0-9_.-]{0,63})\}\}/g;
// Includes tab and newline: a paragraph is a single line of plain prose.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const MARKUP = /[<>`]|http/i;
const DIGIT = /\d/;
const QUANTITY = new RegExp(
  `\\b(?:${QUANTITY_WORDS.map((w) => w.replace(/\s+/g, '\\s+')).join('|')})\\b`,
  'i',
);

const fail = (reason: string): RenderResult => ({ ok: false, reason });

/**
 * Validates a model draft and fills in the server's fact values. Fact text is
 * trusted and inserted in one pass, so a placeholder inside it is never expanded.
 */
export function renderDraft(draft: CopilotDraft, facts: readonly CopilotFact[]): RenderResult {
  const parsed = draftSchema.safeParse(draft);
  if (!parsed.success) return fail('Draft shape or size is invalid');
  const { headline, paragraphs } = parsed.data;
  const texts = [headline, ...paragraphs];

  if (texts.some((t) => CONTROL_CHARS.test(t))) return fail('Draft contains control characters');
  if (texts.some((t) => MARKUP.test(t))) return fail('Draft contains markup or a link');

  const byId = new Map(facts.map((f) => [f.id, f] as const));
  const used: string[] = [];
  for (const text of texts) {
    for (const match of text.matchAll(PLACEHOLDER)) {
      const id = match[1] ?? '';
      if (!byId.has(id)) return fail(`Draft names an unknown fact: ${id}`);
      if (!used.includes(id)) used.push(id);
    }
  }

  for (const text of texts) {
    const bare = text.replace(PLACEHOLDER, ' ');
    if (DIGIT.test(bare)) return fail('Draft contains a digit outside a placeholder');
    if (QUANTITY.test(bare)) return fail('Draft contains a quantity word');
    if (bare.includes('{{') || bare.includes('}}')) {
      return fail('Draft has a malformed placeholder');
    }
  }

  const fill = (text: string): string =>
    text.replace(PLACEHOLDER, (_m, id: string) => byId.get(id)?.text ?? '');
  return { ok: true, headline: fill(headline), paragraphs: paragraphs.map(fill), usedFactIds: used };
}

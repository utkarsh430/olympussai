import { z } from 'zod';
import {
  MAX_FACT_TEXT_CHARS,
  MAX_RENDERED_HEADLINE_CHARS,
  MAX_RENDERED_PARAGRAPH_CHARS,
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

/**
 * The one rule that keeps figures out of model prose: once placeholders are
 * removed, only ASCII letters, space and `. , ; : ' " ( ) -` may remain. This
 * single pattern removes digits in every script, homoglyphs and full-width
 * letters, invisible and control characters (soft hyphen, zero-width, bidi,
 * tag block, tabs, newlines) and symbols such as `%`, `@`, `/`, `<`, `>`, `` ` ``.
 */
const ALLOWED_PROSE = /^[A-Za-z .,;:'"()-]*$/;

/** What may touch a placeholder: the string edge, a space or this punctuation. */
const PLACEHOLDER_NEIGHBOUR = new Set([' ', '.', ',', ';', ':', '(', ')', "'", '"', '-']);

const QUANTITY = new RegExp(
  `\\b(?:${QUANTITY_WORDS.map((w) => w.replace(/\s+/g, '\\s+')).join('|')})(?:s|es|ed|d|th|ths|fold)?\\b`,
  'i',
);
const ROMAN_NUMERAL = /\b[IVXLCDM]{2,}\b/;
const LINK = /www\.|:\/\/|mailto|javascript|[A-Za-z]\.[A-Za-z]/i;

const fail = (reason: string): RenderResult => ({ ok: false, reason });

const UNSAFE_CHARS = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}]/gu;

/**
 * Makes feed-derived text safe to show or prompt with: NFKC, whitespace
 * collapsed first (so a newline becomes a space), then control, format
 * (bidi, zero-width, tag block), private-use, unassigned and surrogate
 * characters removed, then capped by code point.
 */
export function sanitizeFactText(text: string, maxChars: number = MAX_FACT_TEXT_CHARS): string {
  const cleaned = text.normalize('NFKC').replace(/\s+/g, ' ').replace(UNSAFE_CHARS, '').trim();
  return Array.from(cleaned).slice(0, maxChars).join('').trim();
}

function adjacentToSomething(text: string): boolean {
  for (const match of text.matchAll(PLACEHOLDER)) {
    const start = match.index ?? 0;
    const before = start === 0 ? undefined : text[start - 1];
    const after = text[start + match[0].length];
    if (before !== undefined && !PLACEHOLDER_NEIGHBOUR.has(before)) return true;
    if (after !== undefined && !PLACEHOLDER_NEIGHBOUR.has(after)) return true;
  }
  return false;
}

function checkProse(text: string): string | null {
  const bare = text.replace(PLACEHOLDER, ' ');
  if (!ALLOWED_PROSE.test(bare)) {
    return 'Draft contains a character outside the allowed set (digit, symbol, markup, control or invisible character)';
  }
  if (adjacentToSomething(text))
    return 'Draft has a placeholder adjacent to a letter or another placeholder';
  return null;
}

function checkWords(text: string): string | null {
  const bare = text.replace(PLACEHOLDER, ' ');
  if (bare.includes('{{') || bare.includes('}}')) return 'Draft has a malformed placeholder';
  if (QUANTITY.test(bare)) return 'Draft contains a quantity word';
  if (ROMAN_NUMERAL.test(bare)) return 'Draft contains a roman numeral';
  if (LINK.test(bare)) return 'Draft contains a link or bare domain';
  return null;
}

/**
 * Validates a model draft and fills in the server's fact values. Fact text is
 * trusted and inserted in one pass, so a placeholder inside it is never expanded.
 *
 * Residual risk, stated plainly: a word list can never be complete (a number
 * word transliterated from another language would pass), so the guarantee is
 * "no digits in any script, no symbols, and no known quantity words". The model
 * can also attach a true value to a wrong statement; that is mitigated by the
 * facts and guidance it is given, not here.
 */
export function renderDraft(draft: CopilotDraft, facts: readonly CopilotFact[]): RenderResult {
  const parsed = draftSchema.safeParse(draft);
  if (!parsed.success) return fail('Draft shape or size is invalid');
  const { headline, paragraphs } = parsed.data;
  const texts = [headline, ...paragraphs];

  const ids = facts.map((f) => f.id);
  if (new Set(ids).size !== ids.length) return fail('Facts contain a duplicate id');

  for (const text of texts) {
    const problem = checkProse(text);
    if (problem) return fail(problem);
  }

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
    const problem = checkWords(text);
    if (problem) return fail(problem);
  }

  const clean = new Map(facts.map((f) => [f.id, sanitizeFactText(f.text)] as const));
  const fill = (text: string): string =>
    text.replace(PLACEHOLDER, (_m, id: string) => clean.get(id) ?? '');
  const filledHeadline = fill(headline);
  const filledParagraphs = paragraphs.map(fill);
  if (filledHeadline.length > MAX_RENDERED_HEADLINE_CHARS) {
    return fail('Rendered headline is too long');
  }
  if (filledParagraphs.some((p) => p.length > MAX_RENDERED_PARAGRAPH_CHARS)) {
    return fail('Rendered paragraph is too long');
  }
  return { ok: true, headline: filledHeadline, paragraphs: filledParagraphs, usedFactIds: used };
}

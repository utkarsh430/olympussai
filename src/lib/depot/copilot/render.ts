import { z } from 'zod';
import { factEdges, sanitizeFactText } from '@/lib/depot/copilot/factText';
import { checkGrammar, type GrammarProblem } from '@/lib/depot/copilot/grammar';
import { lastNetProblem } from '@/lib/depot/copilot/lastNet';
import {
  FACT_ID_PATTERN,
  FACT_ID_SOURCE,
  MAX_HEADLINE_CHARS,
  MAX_PARAGRAPH_CHARS,
  MAX_PROVIDER_PARAGRAPHS,
  MAX_RENDERED_HEADLINE_CHARS,
  MAX_RENDERED_PARAGRAPH_CHARS,
  PROSE_PUNCTUATION,
} from '@/lib/depot/copilot/limits';
import type { CopilotDraft, CopilotFact } from '@/lib/depot/copilot/types';

// Lives in factText.ts; re-exported because callers import it from here.
export { sanitizeFactText };

/** `reason` is always one of the fixed sentences below: it never holds draft or fact text. */
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
    paragraphs: z.array(z.string().min(1).max(MAX_PARAGRAPH_CHARS)).min(1)
      .max(MAX_PROVIDER_PARAGRAPHS),
  })
  .strict();

const PLACEHOLDER = new RegExp(`\\{\\{fact:(${FACT_ID_SOURCE})\\}\\}`, 'g');

/** Escapes characters for use inside a regular-expression character class. */
const inClass = (chars: readonly string[]): string =>
  chars.map((c) => c.replace(/[\\\]^-]/g, '\\$&')).join('');

/**
 * Layer one: once placeholders are removed, only ASCII letters, space and
 * `. , ; : ' " ( ) -` may remain. This removes digits in every script,
 * homoglyphs, invisible and control characters (tabs and newlines included)
 * and symbols such as `%`, `@`, `/`, `<`, `>`, `{`.
 */
const ALLOWED_PROSE = new RegExp(`^[A-Za-z ${inClass(PROSE_PUNCTUATION)}]*$`);

const GRAMMAR_REASONS: Readonly<Record<GrammarProblem, string>> = {
  spacing: 'Draft has a leading, trailing or double space',
  token:
    'Draft has a token outside the grammar (misplaced punctuation or a placeholder adjacent to something)',
  vocabulary: 'Draft uses a word outside the vocabulary',
  joined_placeholders: 'Draft has placeholders joined without a word between',
  figure_link: 'Draft joins two figures with linking words only',
  figure_unit: 'Draft puts a unit, period or rate word beside a figure',
  figure_qualifier: 'Draft puts a negation or comparison before a figure',
  figure_window: 'Draft puts a word near a figure that is not allowed there',
  figure_clause:
    'Draft puts a negation, rate, total, limiter or other-day word in the clause of a figure',
  figure_depot: "Draft puts a figure beside another depot's name",
  sentence_address: 'Draft addresses the reader',
  sentence_imperative: 'Draft opens a sentence with an instruction',
};

const fail = (reason: string): RenderResult => ({ ok: false, reason });

/**
 * Validates a model draft and fills in the server's fact values. Fact text is
 * sanitised and inserted in one pass, so a placeholder inside it is never expanded.
 *
 * Ruling S26: prose is checked by (1) the ASCII character allowlist, (2) the
 * token grammar and (3) the closed vocabulary (grammar.ts, vocabulary/), with
 * the old forbidden-word list kept only as a last net (lastNet.ts). The
 * vocabulary holds no number, magnitude, unit or currency word, so a model can
 * neither write a figure nor scale one of the server's.
 *
 * Residuals, accepted by ruling: vague quantifiers (most, few, all), ranking
 * by order, and a true value attached to a false statement. "Describe, never
 * instruct" is enforced by the system prompt and the interface, not here.
 */
export function renderDraft(draft: CopilotDraft, facts: readonly CopilotFact[]): RenderResult {
  const parsed = draftSchema.safeParse(draft);
  if (!parsed.success) return fail('Draft shape or size is invalid');
  const { headline, paragraphs } = parsed.data;
  const texts = [headline, ...paragraphs];

  const ids = facts.map((f) => f.id);
  if (new Set(ids).size !== ids.length) return fail('Facts contain a duplicate id');
  if (!ids.every((id) => FACT_ID_PATTERN.test(id))) return fail('Facts contain an invalid id');

  if (!texts.every((text) => ALLOWED_PROSE.test(text.replace(PLACEHOLDER, ' ')))) {
    return fail(
      'Draft contains a character outside the allowed set (digit, symbol, markup, control or invisible character)',
    );
  }

  const clean = new Map(facts.map((f) => [f.id, sanitizeFactText(f.text)] as const));
  const used = [
    ...new Set(texts.flatMap((text) => [...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? ''))),
  ];
  if (!used.every((id) => clean.has(id))) return fail('Draft names an unknown fact');

  const edges = new Map(
    facts.map((f) => {
      const depot = f.depotId === undefined ? {} : { depot: f.depotId };
      return [f.id, { ...factEdges(f.text, f.kind), ...depot }] as const;
    }),
  );
  const UNKNOWN = { endsBare: true, startsWithLetter: false, figure: true };
  for (const text of texts) {
    const problem = checkGrammar(text, (id) => edges.get(id) ?? UNKNOWN);
    if (problem !== null) return fail(GRAMMAR_REASONS[problem]);
    const net = lastNetProblem(text.replace(PLACEHOLDER, ' '), text.replace(PLACEHOLDER, 'x'));
    if (net !== null) return fail(net);
  }

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

import type { CopilotRequest, CopilotText } from '@/lib/depot/copilot/types';
import type {
  CopilotAnswerTable,
  CopilotApiResponse,
  CopilotPublicNotice,
} from '@/lib/depot/copilot/wire';

export interface PublicExtras {
  readonly cached: boolean;
  /** Claude should have written this but did not (deadline, or chosen but not set up). */
  readonly claudeMissed: boolean;
  readonly interpretedAs?: string;
  readonly table?: CopilotAnswerTable;
}

function noticeFor(text: CopilotText, claudeMissed: boolean): CopilotPublicNotice {
  if (text.provider === 'claude-cli') return 'none';
  if (text.fallbackReason === 'scripted_unavailable') return 'summary_unavailable';
  return text.fellBack || claudeMissed ? 'claude_unavailable' : 'none';
}

/**
 * The engine's text narrowed to the wire contract. Every field is listed by
 * name, so an internal one (the fallback reason, `fellBack`, the provider id)
 * can never ride along; the facts shown are the ones the text used.
 */
export function toPublicResponse(
  text: CopilotText,
  request: CopilotRequest,
  extras: PublicExtras,
): CopilotApiResponse {
  const used = new Set(text.usedFactIds);
  return {
    headline: text.headline,
    paragraphs: [...text.paragraphs],
    provider: text.provider === 'claude-cli' ? 'claude' : 'scripted',
    notice: noticeFor(text, extras.claudeMissed),
    generatedAt: text.generatedAt,
    cached: extras.cached,
    facts: request.facts
      .filter((f) => used.has(f.id))
      .map((f) => ({ id: f.id, label: f.label, text: f.text, provenance: f.provenance })),
    ...(extras.interpretedAs !== undefined ? { interpretedAs: extras.interpretedAs } : {}),
    ...(extras.table !== undefined ? { table: extras.table } : {}),
  };
}

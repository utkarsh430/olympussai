import type { Provenance } from '@/lib/depot/types';

export type CopilotProviderId = 'claude-cli' | 'scripted';
export type CopilotTask = 'briefing' | 'rationale' | 'answer';

/** A figure the server computed. The model may refer to it, never restate it. */
export interface CopilotFact {
  /** Matches `^[a-z0-9][a-z0-9_.-]{0,63}$`. */
  readonly id: string;
  readonly label: string;
  /** Pre-formatted by the server, for example "1,204", "31%" or "BAREILLY(R)". */
  readonly text: string;
  readonly provenance: Provenance;
}

/** Prose with `{{fact:id}}` placeholders; it never carries a figure itself. */
export interface CopilotDraft {
  readonly headline: string;
  readonly paragraphs: readonly string[];
}

export interface CopilotRequest {
  readonly task: CopilotTask;
  readonly scopeLabel: string;
  readonly facts: readonly CopilotFact[];
  readonly guidance: string;
  /** Authored beside the facts; always valid, used on any failure. */
  readonly scriptedDraft: CopilotDraft;
}

export type FallbackReason =
  | 'not_selected'
  | 'not_installed'
  | 'not_authenticated'
  | 'usage_limit'
  | 'timeout'
  | 'busy'
  | 'cooling_down'
  | 'invalid_output'
  | 'rejected_draft'
  | 'budget_exhausted'
  | 'request_rejected'
  | 'scripted_unavailable'
  | 'error';

export interface CopilotText {
  readonly headline: string;
  readonly paragraphs: readonly string[];
  /** Who actually wrote the text. */
  readonly provider: CopilotProviderId;
  readonly usedFactIds: readonly string[];
  readonly generatedAt: string;
  readonly fellBack: boolean;
  readonly fallbackReason: FallbackReason | null;
}

export interface CopilotProvider {
  readonly id: CopilotProviderId;
  /** `signal` ends the work early: a caller's deadline or a client disconnect. */
  draft(request: CopilotRequest, signal?: AbortSignal): Promise<CopilotDraft>;
}

/** A provider could not produce a draft; `reason` says why, for the fallback. */
export class CopilotFailure extends Error {
  constructor(
    readonly reason: FallbackReason,
    detail?: string,
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'CopilotFailure';
  }
}

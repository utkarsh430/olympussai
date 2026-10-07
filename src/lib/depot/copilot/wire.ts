import type { Provenance } from '../types';

/**
 * Wire contract of `POST /api/upsrtc/depot/copilot`: what the browser sends
 * and what it gets back.
 *
 * It is deliberately narrower than the engine's own types. The engine knows
 * why Claude was not used (not installed, not signed in, usage limit, cooling
 * down…); the browser is told only that it was not, because those reasons
 * describe the operator's machine, not anything the user can act on.
 */

export type CopilotScope =
  | { readonly kind: 'network' }
  | { readonly kind: 'depot'; readonly depotId: string };

export type CopilotApiRequest =
  | { readonly task: 'briefing'; readonly scope: CopilotScope }
  | { readonly task: 'rationale'; readonly transferId: string }
  /** A route's proposal, by its id and the route it belongs to (the id alone names no route). */
  | { readonly task: 'rationale'; readonly proposalId: string; readonly routeName: string }
  | { readonly task: 'ask'; readonly question: string; readonly scope: CopilotScope };

/** Who wrote the text. Shown beside it: "Written by Claude" or "Scripted response". */
export type CopilotPublicProvider = 'claude' | 'scripted';

/**
 *  - `none`                 the text is what was asked for
 *  - `claude_unavailable`   Claude was selected but a scripted response was used
 *  - `summary_unavailable`  no summary could be prepared; the text says so
 */
export type CopilotPublicNotice = 'none' | 'claude_unavailable' | 'summary_unavailable';

/** A fact the text relied on, so the page can show where each figure came from. */
export interface CopilotFactView {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  readonly provenance: Provenance;
}

/** A small result table for an answered question. Every cell is display text. */
export interface CopilotAnswerTable {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /**
   * One entry per column, in column order: the provenance of the figures that fill it, taken
   * from the facts the column was built from. `null` for a column that holds no figure (a
   * depot's name). Set by the server on every table it builds; optional on the wire.
   */
  readonly provenance?: readonly (Provenance | null)[];
}

/** A depot an answer was about, by id and its display name. */
export interface CopilotScopeDepot {
  readonly depotId: string;
  readonly depotName: string;
}

/**
 * The scope the ANSWER used, which may differ from the form's select
 * (a question that names a depot is answered about that depot).
 */
export type CopilotAnswerScope =
  | { readonly kind: 'network' }
  | ({ readonly kind: 'depot' } & CopilotScopeDepot)
  | { readonly kind: 'depots'; readonly depots: readonly CopilotScopeDepot[] };

/**
 * Where the figures come from when it is not the live feed: the last good data during an
 * outage, or the saved sample. Absent on the live feed.
 */
export type CopilotDataSource = 'last_good' | 'sample';

export interface CopilotApiResponse {
  readonly headline: string;
  readonly paragraphs: readonly string[];
  readonly provider: CopilotPublicProvider;
  readonly notice: CopilotPublicNotice;
  /** Server time the text was produced (ISO). */
  readonly generatedAt: string;
  /** True when the text came from the server's cache for this snapshot. */
  readonly cached: boolean;
  readonly facts: readonly CopilotFactView[];
  /** `ask` only: how the question was understood, in plain words. */
  readonly interpretedAs?: string;
  /** `ask` only: the rows behind the answer, when the query returns a list. */
  readonly table?: CopilotAnswerTable;
  /** `ask` only: what the answer is about. Absent when the question was declined. */
  readonly answerScope?: CopilotAnswerScope;
  /** Set when the figures are not from the live feed; the footer says which. */
  readonly dataSource?: CopilotDataSource;
}

/** Error body. 400 invalid request, 401, 403 cross-origin, 404 unknown depot or transfer, 429, 503. */
export interface CopilotApiError {
  readonly error: string;
  /** Present on 429. */
  readonly retryAfterSeconds?: number;
}

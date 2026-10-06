import type { CopilotFact } from '@/lib/depot/copilot/types';

/**
 * The words a copilot log line uses for a caught error: its class and its message, cut
 * to a fixed length, with every withheld string blanked first. Enough to diagnose a
 * scripted-writer, fact-building or snapshot bug from the server log; never the user's
 * question, a fact value or an environment value. The caller names the stage (its reason
 * code) and the writer; `logDepotError` then keeps the line to one line.
 */

/** How much of an error's message a copilot log line keeps. */
export const MAX_LOGGED_ERROR_CHARS = 160;
/** Withheld text shorter than this is not searched for: it would blank ordinary words. */
const MIN_WITHHELD_CHARS = 3;
/** Shorter environment values are flags and small numbers ("true", "1"), not secrets. */
const MIN_ENV_VALUE_CHARS = 8;
const MAX_CLASS_CHARS = 40;
export const WITHHELD = '[withheld]';
const ELLIPSIS = '…';

export interface WithheldSources {
  /** The server's environment: every value long enough to be a secret is withheld. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The user's question, when the request is a typed one. */
  readonly question?: string;
  /** The facts the text is written from: their values are withheld. */
  readonly facts?: readonly Pick<CopilotFact, 'text'>[];
}

/** Every string that must not reach the log, longest first so a longer one is blanked whole. */
export function withheldStrings(sources: Readonly<WithheldSources>): readonly string[] {
  const env = Object.values(sources.env ?? {}).filter(
    (value): value is string => value !== undefined && value.length >= MIN_ENV_VALUE_CHARS,
  );
  // Read defensively: this runs while handling a failure, possibly one caused by a
  // malformed fact, and must not throw a second time.
  const said = [sources.question, ...(sources.facts ?? []).map((f) => f?.text)].filter(
    (value): value is string =>
      typeof value === 'string' && value.trim().length >= MIN_WITHHELD_CHARS,
  );
  return [...new Set([...env, ...said])].sort((a, b) => b.length - a.length);
}

function className(error: Error): string {
  const name = error.constructor?.name || error.name || 'Error';
  return name.replace(/[^A-Za-z0-9_]/g, '').slice(0, MAX_CLASS_CHARS) || 'Error';
}

/** `TypeError: Cannot read properties of undefined (reading 'name')`, bounded and blanked. */
export function describeCopilotError(error: unknown, withheld: readonly string[]): string {
  if (!(error instanceof Error)) {
    return `non-error value thrown (${error === null ? 'null' : typeof error})`;
  }
  const blanked = withheld
    .reduce((text, value) => text.split(value).join(WITHHELD), String(error.message ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
  const message =
    blanked.length <= MAX_LOGGED_ERROR_CHARS
      ? blanked
      : `${blanked.slice(0, MAX_LOGGED_ERROR_CHARS - ELLIPSIS.length)}${ELLIPSIS}`;
  return message === '' ? className(error) : `${className(error)}: ${message}`;
}

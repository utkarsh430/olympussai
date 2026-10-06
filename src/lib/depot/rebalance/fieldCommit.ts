import type { ParseResult } from './scenarioParsers';

/*
 * When a sandbox field's value reaches the optimiser. Re-planning on every
 * keystroke planned for "1", "15" and "150" in turn, so a value is committed
 * after a pause in typing, or at once on blur or Enter.
 */

/** Long enough to cover a typing burst, short enough to feel immediate. */
export const COMMIT_PAUSE_MS = 300;

/** Shown beside a field whose text cannot be used, so the plan is not mistaken for it. */
export const PREVIOUS_VALUE_NOTE = 'Showing the plan for the previous value';

export interface CommitScheduler<T> {
  /** Holds the value and commits it once typing pauses. */
  readonly schedule: (value: T) => void;
  /** Commits a held value now (blur or Enter); does nothing when none is held. */
  readonly flush: () => void;
  /** Drops a held value without committing it. */
  readonly cancel: () => void;
}

export function createCommitScheduler<T>(
  commit: (value: T) => void,
  delayMs: number = COMMIT_PAUSE_MS,
): CommitScheduler<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { readonly value: T } | null = null;

  function stop(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function flush(): void {
    stop();
    const held = pending;
    pending = null;
    if (held) commit(held.value);
  }

  return {
    schedule: (value: T): void => {
      stop();
      pending = { value };
      timer = setTimeout(flush, delayMs);
    },
    flush,
    cancel: (): void => {
      stop();
      pending = null;
    },
  };
}

export type FieldEvaluation =
  | { readonly kind: 'empty' }
  | { readonly kind: 'valid'; readonly value: number }
  | { readonly kind: 'invalid'; readonly error: string };

/** What a field's text means: nothing typed, a usable number, or an error sentence. */
export function evaluateField(raw: string, parse: (raw: string) => ParseResult): FieldEvaluation {
  if (raw.trim() === '') return { kind: 'empty' };
  const result = parse(raw);
  return result.ok
    ? { kind: 'valid', value: result.value }
    : { kind: 'invalid', error: result.error };
}

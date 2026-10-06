import 'server-only';

/**
 * Server-side error log for depot code.
 *
 * This is the single place to attach a real logger later: every depot route and
 * service reports caught errors here rather than swallowing them. It writes one
 * line, `[depot:<scope>] <message>`, and nothing else: no stack, no request
 * data, no environment values. The message is neutralised so one error is
 * always one line (a newline in a message must not forge a second entry), and
 * a value that is not an Error or a string is logged by type only, never by
 * content. Never import it from a client component.
 */

export const MAX_LOG_MESSAGE_CHARS = 300;

const ELLIPSIS = '…';

export function logDepotError(scope: string, error: unknown): void {
  console.error(`[depot:${scope}] ${describeError(error)}`);
}

/**
 * A state change worth one line in the server log that is not an error, such as a feed
 * recovering. Written as a warning, in the same one-line form as `logDepotError`.
 */
export function logDepotNotice(scope: string, message: string): void {
  console.warn(`[depot:${scope}] ${neutralise(message)}`);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return neutralise(error.message);
  if (typeof error === 'string') return neutralise(error);
  return `non-error value thrown (${error === null ? 'null' : typeof error})`;
}

function neutralise(message: string): string {
  const oneLine = message
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim();
  if (oneLine.length <= MAX_LOG_MESSAGE_CHARS) return oneLine;
  return `${oneLine.slice(0, MAX_LOG_MESSAGE_CHARS - ELLIPSIS.length)}${ELLIPSIS}`;
}

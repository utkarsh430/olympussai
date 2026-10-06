/**
 * Server-side error log for depot code.
 *
 * This is the single place to attach a real logger later: every depot route and
 * service reports caught errors here rather than swallowing them. It writes one
 * line, `[depot:<scope>] <message>`, and nothing else: no stack, no request
 * data, no environment values, so a log line cannot leak what a response must
 * not. Never import it from a client component.
 */
export function logDepotError(scope: string, error: unknown): void {
  console.error(`[depot:${scope}] ${describeError(error)}`);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

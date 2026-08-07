// Sentry wiring for this service. Separate Sentry project ("control-service")
// from the web app's, DSN via env, release tagged from RENDER_GIT_COMMIT
// (Render's build-time env var) so a deploy's errors/perf data can be
// pinned to the exact commit that shipped it
// (docs/CONTROL_SERVICE_DEPLOYMENT.md "Dashboards & metrics").
import * as Sentry from '@sentry/node';
import { loadEnv } from '../config/env.js';

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const env = loadEnv();
  if (!env.SENTRY_DSN) {
    // Local/dev/CI without a DSN configured: no-op rather than throwing,
    // so `pnpm test`/`pnpm dev` never require a live Sentry project.
    return;
  }
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    release: env.RENDER_GIT_COMMIT ?? 'local-dev',
    tracesSampleRate: env.NODE_ENV === 'production' || env.SENTRY_ENVIRONMENT === 'pilot' ? 0.2 : 1.0,
  });
  initialized = true;
}

/**
 * Named Sentry span this service emits. `mpc.solve` and `command.dispatch`
 * are the two the deployment dashboards are built against
 * (docs/CONTROL_SERVICE_DEPLOYMENT.md) and must never be renamed; the
 * rest cover the rest of the command lifecycle (persist is `command.dispatch`
 * itself - deliver/ack/supersede/the periodic TTL sweep each get their own
 * name so they're distinguishable in trace search).
 */
export type SpanName =
  | 'mpc.solve'
  | 'command.dispatch'
  | 'command.deliver'
  | 'command.acknowledge'
  | 'command.supersede'
  | 'command.ttl_sweep';

/**
 * Wraps `fn` in a named Sentry performance span. Falls back to a plain
 * call (still measured via the returned duration in the caller's own log
 * line) when Sentry isn't initialized, so span instrumentation never
 * becomes a hard dependency on Sentry being configured.
 */
export async function withSpan<T>(
  name: SpanName,
  op: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!initialized) {
    return fn();
  }
  return Sentry.startSpan({ name, op }, async () => fn());
}

export { Sentry };

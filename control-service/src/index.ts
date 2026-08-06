// Process entrypoint. Loads env, wires Sentry, starts the HTTP server
// immediately (so /healthz is live right away), kicks off state
// rehydration in the background, and only reports /readyz healthy once
// that completes - see docs/CONTROL_SERVICE_DEPLOYMENT.md "Health/readiness
// contract" and "CI/CD pipeline" step 5.
//
// Also re-exports the state-estimation library and the shared db/logger
// singletons, so this package's public surface (`main` in package.json)
// covers both "run me as a process" (this file, executed directly) and
// "import pieces of me as a library" (e.g. a future MPC/dispatch module
// pulling in `StateEstimationService`) - see control-service/README.md
// "Application code".
import 'dotenv/config';
import { loadEnv } from './config/env.js';
import { initSentry, Sentry } from './telemetry/sentry.js';
import { createApp } from './app.js';
import { rehydrateState } from './db/rehydrate.js';
import { closePool } from './db/pool.js';
import { sweepExpiredCommands } from './db/commands.js';
import { logger } from './lib/logger.js';

export * from './state-estimation/index.js';
export { getPool, closePool } from './db/pool.js';
export { logger } from './lib/logger.js';

const env = loadEnv();
initSentry();

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'control-service listening');
});

// Rehydration runs in the background so the process can report /healthz
// (liveness) immediately; /readyz stays 503 until this resolves, which is
// what gates Render's traffic cutover on a rolling deploy.
rehydrateState().catch((err) => {
  logger.error({ err }, 'initial state rehydration failed; /readyz will report not_ready');
  Sentry.captureException(err);
});

// Backstop TTL sweep (command lifecycle ticket AC: "expired commands
// never delivered/executed"). deliverCommand/acknowledgeCommand already
// expire lazily on access; this catches commands nobody happens to touch
// so they don't sit in an active status indefinitely.
const commandTtlSweep = setInterval(() => {
  sweepExpiredCommands()
    .then((expired) => {
      if (expired.length > 0) {
        logger.info(
          { count: expired.length, commandIds: expired.map((c) => c.id) },
          'ttl sweep expired stale commands',
        );
      }
    })
    .catch((err) => {
      logger.error({ err }, 'command ttl sweep failed');
      Sentry.captureException(err);
    });
}, env.COMMAND_TTL_SWEEP_INTERVAL_MS);
commandTtlSweep.unref();

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  clearInterval(commandTtlSweep);
  server.close(() => {
    closePool()
      .catch((err) => logger.error({ err }, 'error closing db pool during shutdown'))
      .finally(() => process.exit(0));
  });
  // Force-exit if graceful shutdown hangs (e.g. a stuck connection).
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled rejection');
  Sentry.captureException(reason);
});

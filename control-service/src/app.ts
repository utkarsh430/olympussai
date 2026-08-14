// Express app assembly. Kept separate from index.ts (the process
// entrypoint) so tests can import `createApp()` and exercise routes with
// supertest without binding a real port or touching process lifecycle.
import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { healthRouter } from './routes/health.js';
import { commandsRouter } from './routes/commands.js';
import { vehicleStatesRouter } from './routes/vehicleStates.js';
import { mpcRouter } from './routes/mpc.js';
import { headwayRouter } from './routes/headway.js';
import { arrivalsRouter } from './routes/arrivals.js';
import { pilotRouter } from './routes/pilot.js';
import { positionsRouter } from './routes/positions.js';
import { rehearsalRouter } from './routes/rehearsal.js';
import { requireServiceToken } from './auth/serviceToken.js';
import { errorHandler } from './lib/errors.js';
import { logger } from './lib/logger.js';

export function createApp(): Express {
  const app = express();

  // Trust Render's proxy so req.ip / x-forwarded-* are honored correctly.
  app.set('trust proxy', true);

  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '1mb' }));

  // Liveness/readiness are unauthenticated by design - Render's health
  // checker calls them without a service token.
  app.use(healthRouter);

  // Everything else is inbound web -> control-service traffic and requires
  // the service token (docs/CONTROL_SERVICE_INTEGRATION.md section 1).
  app.use(requireServiceToken);
  app.use(commandsRouter);
  app.use(vehicleStatesRouter);
  app.use(mpcRouter);
  app.use(headwayRouter);
  // Per-stop arrival prediction. Read-only and side-effect free: it never
  // writes a row and never issues a command, so a driver dashboard may poll it
  // freely - unlike the headway COMPUTE endpoint, which appends the very
  // history its own detection rule reads back over.
  app.use(arrivalsRouter);
  app.use(pilotRouter);
  // Telemetry intake (POST /v1/positions) + the geometry-cache
  // invalidation hook. Behind requireServiceToken like every other /v1
  // route: a fix is a write to fleet state, and an unauthenticated caller
  // must not be able to move a bus on the control room's map.
  app.use(positionsRouter);
  // Control-strategy rehearsal. Read-only: it runs the isolated mesoscopic
  // simulator over a corridor's real geometry and real policy and returns
  // the result, without issuing a command or writing a row. See
  // routes/rehearsal.ts for why an uncalibrated corridor is refused.
  app.use(rehearsalRouter);

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
  });

  app.use(errorHandler);

  return app;
}

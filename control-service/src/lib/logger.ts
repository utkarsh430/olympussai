// Structured logging (pino). Every request and error path logs through
// this, never console.log directly, so log shipping (Render's log stream
// today, anything structured later) sees consistent JSON.
import pino from 'pino';
import { loadEnv } from '../config/env.js';

const env = loadEnv();

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'control-service', env: env.NODE_ENV },
});

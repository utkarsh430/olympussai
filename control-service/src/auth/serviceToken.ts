// Inbound auth for web -> control-service REST calls: a rotating bearer
// service token, distinct from and independent of the human PIN-session
// cookie (docs/CONTROL_SERVICE_INTEGRATION.md section 1). The control
// service never sees or accepts an olympuss_session cookie.
import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { loadEnv } from '../config/env.js';
import { AppError, sendError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Length differs -> definitely not equal, but still do a same-length
  // dummy compare so this branch doesn't return in measurably different
  // time than the equal-length path (basic timing-attack hygiene, A07).
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function requireServiceToken(req: Request, res: Response, next: NextFunction): void {
  const env = loadEnv();
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  if (!token || !timingSafeStringEqual(token, env.SERVICE_TOKEN_SECRET)) {
    logger.warn({ path: req.path, hasHeader: Boolean(header) }, 'rejected request: invalid service token');
    sendError(res, new AppError('unauthorized', 'Missing or invalid service token', 401));
    return;
  }
  next();
}

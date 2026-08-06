// Structured error type + HTTP responder shared by every route. Mirrors
// the web app's convention: `{ error: { code, message } }`, never a raw
// stack trace in the response body.
import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function sendError(res: Response, err: AppError): void {
  res.status(err.status).json({
    error: {
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    },
  });
}

/** Express error-handling middleware. Always last in the middleware chain. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error({ err, path: req.path, code: err.code }, 'request failed');
    } else {
      logger.warn({ path: req.path, code: err.code, message: err.message }, 'request rejected');
    }
    sendError(res, err);
    return;
  }

  // Unknown/unhandled failure: log full detail server-side, never leak it
  // to the client (A02/A10 - no stack traces reaching the response body,
  // fail closed with a generic message).
  logger.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({
    error: { code: 'internal_error', message: 'Internal server error' },
  });
}

/** Wraps an async Express handler so a rejected promise reaches errorHandler instead of hanging the request. */
export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Req, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

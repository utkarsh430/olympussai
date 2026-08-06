// Outbound webhook dispatch: control service -> web
// (docs/CONTROL_SERVICE_INTEGRATION.md section 1 "Control service -> web
// (inbound, events/commands)"). Every delivery is HMAC-signed, carries a
// unique idempotency key, and is retried with backoff on a retryable
// (5xx/timeout) response - never silently dropped, never retried forever
// (A10: fail closed, don't hang).
import { randomUUID } from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { buildSignedHeaders } from './sign.js';

export interface WebhookEvent {
  type: string;
  idempotencyKey?: string;
  data: Record<string, unknown>;
}

export interface DispatchResult {
  delivered: boolean;
  attempts: number;
  idempotencyKey: string;
  status?: number;
}

const REQUEST_TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 250;

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function postOnce(
  url: string,
  rawBody: string,
  headers: Record<string, string>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Delivers a signed webhook event to WEB_APP_WEBHOOK_URL, retrying with
 * exponential backoff on a retryable failure. Returns rather than throws on
 * final failure so a single failed delivery never crashes the caller - the
 * caller (e.g. a command status transition) decides what to do with a
 * failed delivery (log + surface via the command's own status, not a
 * process-level error).
 */
export async function dispatchWebhook(event: WebhookEvent): Promise<DispatchResult> {
  const env = loadEnv();
  const idempotencyKey = event.idempotencyKey ?? randomUUID();

  if (!env.WEB_APP_WEBHOOK_URL) {
    logger.warn({ eventType: event.type, idempotencyKey }, 'WEB_APP_WEBHOOK_URL not configured, skipping delivery');
    return { delivered: false, attempts: 0, idempotencyKey };
  }

  const rawBody = JSON.stringify({ type: event.type, idempotencyKey, data: event.data });
  const headers = buildSignedHeaders(rawBody, env.WEBHOOK_HMAC_SECRET, idempotencyKey);

  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await postOnce(env.WEB_APP_WEBHOOK_URL, rawBody, headers);
      lastStatus = res.status;
      if (res.ok) {
        return { delivered: true, attempts: attempt, idempotencyKey, status: res.status };
      }
      if (!isRetryableStatus(res.status)) {
        logger.error(
          { eventType: event.type, idempotencyKey, status: res.status },
          'webhook delivery rejected (non-retryable)',
        );
        return { delivered: false, attempts: attempt, idempotencyKey, status: res.status };
      }
      logger.warn(
        { eventType: event.type, idempotencyKey, status: res.status, attempt },
        'webhook delivery failed, will retry',
      );
    } catch (err) {
      logger.warn({ eventType: event.type, idempotencyKey, attempt, err }, 'webhook delivery error, will retry');
    }

    if (attempt < MAX_ATTEMPTS) {
      const delay = BACKOFF_BASE_MS * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  logger.error({ eventType: event.type, idempotencyKey, attempts: MAX_ATTEMPTS }, 'webhook delivery exhausted retries');
  return { delivered: false, attempts: MAX_ATTEMPTS, idempotencyKey, status: lastStatus };
}

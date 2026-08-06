// Env var validation. Fails fast (throws) at boot if a required var is
// missing/malformed instead of surfacing a confusing runtime error later -
// same "validate inputs" default the web app applies to request bodies,
// applied here to process.env.
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // This service's own Postgres/PostGIS datastore. Never the web app's
  // Supabase connection string (docs/CONTROL_SERVICE_INTEGRATION.md section 3).
  CONTROL_SERVICE_DATABASE_URL: z.string().min(1, 'CONTROL_SERVICE_DATABASE_URL is required'),

  // Bearer token the Next.js app sends on web -> control-service REST calls.
  SERVICE_TOKEN_SECRET: z.string().min(16, 'SERVICE_TOKEN_SECRET must be set and non-trivial'),

  // HMAC-SHA256 key used to sign control-service -> web webhook deliveries.
  WEBHOOK_HMAC_SECRET: z.string().min(16, 'WEBHOOK_HMAC_SECRET must be set and non-trivial'),

  // Where signed webhooks are delivered - the web app's inbound handler
  // (docs/CONTROL_SERVICE_INTEGRATION.md section 1, e.g.
  // https://<web-app>/api/control-service/webhook).
  WEB_APP_WEBHOOK_URL: z.string().url().optional(),

  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().default('development'),
  // Render-provided build-time var; falls back for local dev.
  RENDER_GIT_COMMIT: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: clear the cached env so a test can reload with different values. */
export function _resetEnvCacheForTests(): void {
  cached = undefined;
}

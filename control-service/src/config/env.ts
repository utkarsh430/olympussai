// Env var validation. Fails fast (throws) at boot if a required var is
// missing/malformed instead of surfacing a confusing runtime error later -
// same "validate inputs" default the web app applies to request bodies,
// applied here to process.env.
import { z } from 'zod';

/**
 * Env vars arrive as strings, so `z.coerce.boolean()` is unusable here - it
 * treats the string "false" as truthy. This accepts only the four spellings
 * an operator would plausibly write and maps them to a real boolean.
 */
const booleanFromEnv = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'));

const baseEnvSchema = z.object({
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

  // How often the process-level timer sweeps TTL-expired commands to
  // `expired` (src/index.ts, control_service_expire_commands()). Deliver/
  // ack also expire lazily on access, so this is a backstop for commands
  // nobody happens to touch - it doesn't need to be aggressive.
  COMMAND_TTL_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),

  // --- Ingestion / scheduler -------------------------------------------
  // How long a NetworkGeometryCache snapshot (active route-direction
  // shapes + their stops + the spatial grid) is served before a background
  // refresh. Geometry only changes when an operator re-runs the seeder, so
  // a stale-by-minutes shape is harmless; re-scanning route_shapes on every
  // position event is not. Doubles as the geometryRefresh job's interval.
  SHAPE_CACHE_TTL_MS: z.coerce.number().int().positive().default(15 * 60_000),

  // In-process GPS poller. Default OFF so exactly one instance of a
  // multi-instance deploy is opted in to polling the upstream feed
  // (otherwise every replica ingests the same 665 fixes).
  GPS_POLL_ENABLED: booleanFromEnv.default(false),
  GPS_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  GPS_POLL_URL: z.string().url().default('https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php'),
  /** A fix older than this is dropped rather than ingested - a stale fix must not resurrect a vehicle that has since gone dark. */
  GPS_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(300),

  // Headway compute sweep. Detection latency for the reactive bunching
  // rule is required_samples x HEADWAY_COMPUTE_INTERVAL_MS x
  // ceil(eligible / HEADWAY_BATCH_SIZE) - see src/scheduler/headwayCompute.ts.
  HEADWAY_COMPUTE_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  HEADWAY_BATCH_SIZE: z.coerce.number().int().positive().default(60),
  /** Concurrent computeRouteDirectionHeadway calls. Pool max is 10; this leaves headroom for /v1 request traffic. */
  HEADWAY_COMPUTE_CONCURRENCY: z.coerce.number().int().positive().default(4),
  /** A vehicle_states row older than this doesn't count toward "this route-direction has a live pair". */
  HEADWAY_VEHICLE_FRESHNESS_SECONDS: z.coerce.number().int().positive().default(300),

  /**
   * When true, /readyz reports 503 until the network geometry is actually
   * seeded (at least one active route_direction with a route_shape).
   * Without a shape every fix short-circuits to `off_route`, so the
   * instance is structurally incapable of a correct answer even though
   * every query "succeeds". Defaults on everywhere except tests, whose
   * createApp() suites run without a database.
   */
  REQUIRE_SEEDED_NETWORK: booleanFromEnv.optional(),

  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().default('development'),
  // Render-provided build-time var; falls back for local dev.
  RENDER_GIT_COMMIT: z.string().optional(),
});

// REQUIRE_SEEDED_NETWORK's default depends on another field (NODE_ENV),
// which a per-field `.default()` cannot express - resolve it here so the
// exported Env type still carries a plain `boolean`.
const envSchema = baseEnvSchema.transform((env) => ({
  ...env,
  REQUIRE_SEEDED_NETWORK: env.REQUIRE_SEEDED_NETWORK ?? env.NODE_ENV !== 'test',
}));

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

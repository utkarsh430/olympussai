import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // TWO TEST DIRECTORIES, `test/` AND `tests/`. This is an accident, not a
    // design, and it is documented here rather than fixed because fixing it is
    // worse than living with it.
    //
    // Origin: `tests/` was created by the state-estimation ticket (estimator,
    // Kalman filter, map matching, ordering, confidence, geometry, cache,
    // repository, plus `tests/seed/` and `tests/headway/`); `test/` was created
    // later by the application-runtime ticket (routes, db, scheduler,
    // webhooks, migrate, service token, MPC, plus `test/simulation/`). Neither
    // ticket noticed the other's directory.
    //
    // The boundary has ALREADY leaked, which is why nobody should reason about
    // it: headway lives in both (`test/headwayService.test.ts` and
    // `test/headwayRoutes.test.ts` here, `tests/headway/metrics.test.ts` and
    // `tests/headway/bunching.test.ts` there). Treat the split as historical
    // noise, not as a rule.
    //
    // Why it is not unified: 58 files across the two trees, all of which vitest
    // already collects, all of which pass, and none of which would behave any
    // differently afterwards. A 58-file rename would collide with any
    // concurrent work in this package and would bury a real change in an
    // unreviewable diff, in exchange for zero behaviour change. If someone does
    // unify it later, `tests/*` -> `test/*` is the cheap direction: the trees
    // are at the same depth so every `../src/...` / `../../src/...` import and
    // every fixture path stays valid, and there is not a single basename
    // collision between them (verified). Delete this comment and drop one glob
    // when that happens.
    //
    // Until then: put a new test in `test/`, which is the larger tree, the one
    // the newer work went into, and the singular that matches this package's
    // `src/`.
    include: ['test/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 10_000,
    // Env vars required by src/config/env.ts. Set here (rather than a
    // setup file) so they exist before any test module import triggers
    // loadEnv() at module-init time. No real DB/Sentry project needed to
    // run the suite - db access is mocked per-test.
    env: {
      NODE_ENV: 'test',
      CONTROL_SERVICE_DATABASE_URL: 'postgres://test:test@localhost:5432/control_service_test',
      SERVICE_TOKEN_SECRET: 'test-service-token-secret-value',
      WEBHOOK_HMAC_SECRET: 'test-webhook-hmac-secret-value',
      WEB_APP_WEBHOOK_URL: 'https://web.example.test/api/control-service/webhook',
    },
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
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

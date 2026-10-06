import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/tests/**/*.test.ts', 'src/tests/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    // No test may send a real signal: process.kill only reaches pids a test created.
    setupFiles: ['src/tests/setup/signalGuard.ts'],
    // Exhaustive and national-scale tests take a fraction of a second on an idle
    // machine but many times longer when it is busy; the default of five seconds
    // then fails tests that are not wrong.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // `server-only` is not a direct dependency, so Vite cannot resolve it even
      // when a test mocks it. Point it at Next's own no-op build of the package.
      'server-only': path.resolve(__dirname, './node_modules/next/dist/compiled/server-only/empty.js'),
    },
  },
});

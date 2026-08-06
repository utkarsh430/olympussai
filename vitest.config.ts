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
    setupFiles: ['src/tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Next.js resolves 'server-only' via its own build-time alias with no
      // npm package needed; vitest runs on plain Vite, which has no such
      // alias, so point it at a no-op stub (src/tests/stubs/server-only.ts)
      // instead. This only affects the test runner, never `next build`/`next dev`.
      'server-only': path.resolve(__dirname, './src/tests/stubs/server-only.ts'),
    },
  },
});

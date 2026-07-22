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
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});

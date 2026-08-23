import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // `core/` and `doctor/` are pure and must run in bare Node; only the React glue needs a DOM
    environment: 'node',
    environmentMatchGlobs: [['react/**', 'jsdom']],
    include: ['**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/'],
    },
  },
});

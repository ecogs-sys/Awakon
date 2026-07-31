import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Per-file env via `// @vitest-environment jsdom` at the top of a test file.
    // Default to node so main-process tests don't pay the jsdom cost.
    environment: 'node',
    include: ['src/**/*.test.ts', '*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});

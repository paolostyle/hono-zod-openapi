import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: process.env.CI
        ? ['text', 'json-summary', 'json']
        : ['text', 'html'],
    },
    reporters: process.env.CI
      ? ['default', 'junit', 'github-actions']
      : ['default'],
    outputFile: {
      junit: 'test-results/junit.xml',
    },
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 120_000, // GPU encode of large levels is slow
    hookTimeout: 120_000
  }
});

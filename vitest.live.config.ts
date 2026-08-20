import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['src/**/*.live.test.ts'],
    // Network calls to a real Appwrite project; runs serially, no retries.
    fileParallelism: false,
  },
})

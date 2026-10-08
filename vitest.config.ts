import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    css: { include: [/styles\.css/] },
    expect: { requireAssertions: true },
    allowOnly: false,
    dangerouslyIgnoreUnhandledErrors: false,
    retry: 0,
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    fakeTimers: { now: 0 },
    sequence: { shuffle: { files: true, tests: true } },
    testTimeout: 5_000,
    hookTimeout: 10_000,
  },
})

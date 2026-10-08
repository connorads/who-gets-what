import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests against the built Worker in `vite preview`, the runtime that
 * serves production: run `pnpm run build` first. Specs tagged @perf measure
 * frame rates and run only with `pnpm run perf:explore`.
 */
const PORT = 4320

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  ...(process.env['PERF'] === '1' ? {} : { grepInvert: /@perf/ }),
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/about`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})

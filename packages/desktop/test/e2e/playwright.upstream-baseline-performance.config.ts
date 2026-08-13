import { defineConfig } from '@playwright/test'

export default defineConfig({
  forbidOnly: true,
  retries: 0,
  workers: 1,
  testMatch: '**/upstream-baseline-performance.spec.ts',
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 }
  },
  timeout: 60 * 60 * 1000
})

import { defineConfig } from '@playwright/test'

export default defineConfig({
  forbidOnly: true,
  retries: 0,
  workers: 1,
  testMatch: '**/installed-core-search.spec.ts',
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 }
  },
  timeout: 180_000
})

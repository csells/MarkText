import { defineConfig } from '@playwright/test'

export default defineConfig({
  forbidOnly: true,
  retries: 0,
  workers: 1,
  testMatch: '**/installed-core-export-consumers.spec.ts',
  projects: [{ name: 'installed-core-export-consumers' }],
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 }
  },
  timeout: process.env.CI === 'true' ? 180_000 : 30_000
})

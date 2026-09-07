import { defineConfig } from '@playwright/test'

const installedArtifactSpecs = [
  '**/installed-core-review.spec.ts',
  '**/installed-core-clipboard.spec.ts',
  '**/installed-core-search.spec.ts',
  '**/installed-core-export-consumers.spec.ts',
  '**/installed-core-performance.spec.ts'
]

export default defineConfig({
  forbidOnly: true,
  retries: 0,
  maxFailures: 1,
  globalSetup: './globalSetup.ts',
  workers: 1,
  testMatch: '**/*.spec.ts',
  projects: [
    {
      name: 'unpacked',
      testIgnore: installedArtifactSpecs
    },
    {
      name: 'installed',
      testMatch: installedArtifactSpecs
    }
  ],
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 }
  },
  timeout: process.env.CI === 'true' ? 120000 : 30000
})

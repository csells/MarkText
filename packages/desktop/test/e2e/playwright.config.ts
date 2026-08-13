import { defineConfig } from '@playwright/test'

const installedArtifactSpecs = [
  '**/installed-core-review.spec.ts'
]

export default defineConfig({
  forbidOnly: true,
  retries: 0,
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

import { defineConfig } from '@playwright/test'

const installedArtifactSpecs = ['**/installed-*.spec.ts']
const installedSpecs = [
  ...installedArtifactSpecs,
  '**/criticmarkup-image-size.spec.ts',
  '**/criticmarkup-window-close.spec.ts'
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
      testMatch: installedSpecs
    },
    {
      name: 'installed-functional',
      testMatch: installedSpecs,
      // Sustained measurements retain their dedicated workload and environment.
      testIgnore: '**/installed-core-performance.spec.ts'
    }
  ],
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 }
  },
  timeout: process.env.CI === 'true' ? 120000 : 30000
})

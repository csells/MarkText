import { defineConfig } from '@playwright/test'

const installedArtifactSpecs = ['**/installed-*.spec.ts']
const installedSpecs = [
  ...installedArtifactSpecs,
  '**/criticmarkup-image-size.spec.ts',
  '**/criticmarkup-window-close.spec.ts'
]

// Must stay at the package root: Playwright only auto-loads a config from the
// directory it is invoked in, and every entry point (`pnpm test:e2e`, a single
// `playwright test <spec>` run, CI) invokes it from packages/desktop. Kept in
// test/e2e/ the settings below were silently ignored and the suite ran on
// Playwright's defaults — notably ~half the cores as workers instead of 1.
export default defineConfig({
  testDir: './test/e2e',
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

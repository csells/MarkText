import { defineConfig } from '@playwright/test'

import { INSTALLED_CORE_PHASE4_PROJECT } from './helpers/installedCorePhase4Evidence'

export default defineConfig({
  forbidOnly: true,
  retries: 0,
  workers: 1,
  testMatch: [
    '**/installed-core-review.spec.ts',
    '**/installed-core-clipboard.spec.ts',
    '**/installed-core-search.spec.ts',
    '**/installed-core-export-consumers.spec.ts'
  ],
  projects: [{ name: INSTALLED_CORE_PHASE4_PROJECT }],
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 }
  },
  timeout: 180_000
})

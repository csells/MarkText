import { defineConfig } from '@playwright/test'

const installedArtifactSpecs = [
  '**/installed-document-core-comment.spec.ts',
  '**/installed-document-core-full-flow.spec.ts',
  '**/packaged-smoke.spec.ts'
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
  timeout: 30000
})

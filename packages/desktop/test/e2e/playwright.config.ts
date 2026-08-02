import { defineConfig } from '@playwright/test'

const installedArtifactSpecs = [
  '**/installed-document-core-comment.spec.ts',
  '**/installed-document-core-full-flow.spec.ts',
  '**/packaged-smoke.spec.ts'
]

const specialistEvidenceSpecs = [
  '**/document-core-hostile-sinks.spec.ts',
  '**/export-pdf.spec.ts',
  '**/xss.spec.ts',
  '**/context-isolation.spec.ts',
  '**/critic-markup-perf.spec.ts',
  '**/document-core-max-document-perf.spec.ts'
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
      name: 'evidence-unpacked',
      testIgnore: [...installedArtifactSpecs, ...specialistEvidenceSpecs]
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
  // Hang guard, not a budget: hosted runners execute the same work about
  // four times slower than the owner hardware every spec was paced on.
  timeout: process.env.CI === 'true' ? 120000 : 30000
})

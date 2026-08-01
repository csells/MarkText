import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    allowOnly: false,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // Hosted runners execute the same work about four times slower than
    // the owner hardware the 5 s default was sized on — and the Windows
    // leg's disk pushed a passing fsync-heavy journal test past 20 s.
    // This is a hang guard only; evidence budgets do not live here.
    testTimeout: process.env.CI === 'true' ? 40_000 : 5_000,
    poolOptions: {
      // The maximum-document suites hold multi-gigabyte revisions; hosted
      // CI runners start Node workers at the ~2 GB default heap and die in
      // Mark-Compact. Local runs are unaffected beyond the higher ceiling.
      forks: { execArgv: ['--max-old-space-size=6144'] },
      threads: { execArgv: ['--max-old-space-size=6144'] }
    }
  }
})

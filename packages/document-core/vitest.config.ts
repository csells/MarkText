import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    allowOnly: false,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    poolOptions: {
      // The maximum-document suites hold multi-gigabyte revisions; hosted
      // CI runners start Node workers at the ~2 GB default heap and die in
      // Mark-Compact. Local runs are unaffected beyond the higher ceiling.
      forks: { execArgv: ['--max-old-space-size=6144'] },
      threads: { execArgv: ['--max-old-space-size=6144'] }
    }
  }
})

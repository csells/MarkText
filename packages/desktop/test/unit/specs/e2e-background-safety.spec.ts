import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import playwrightConfig from '../../../playwright.config'

describe('e2e background safety', () => {
  const packagePath = path.resolve(__dirname, '../../../package.json')
  const helpersPath = path.resolve(__dirname, '../../e2e/helpers.ts')
  const criticMarkupE2ePath = path.resolve(__dirname, '../../e2e/critic-markup-review.spec.ts')

  it('loads the one-worker Playwright config in fail-closed background mode', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(packagePath, 'utf-8')
    ) as { scripts: Record<string, string> }
    const helpers = fs.readFileSync(helpersPath, 'utf8')

    expect(packageJson.scripts['test:e2e']).toBe(
      'cross-env MARKTEXT_TEST_BACKGROUND=1 playwright test --config test/e2e/playwright.config.ts'
    )
    expect(packageJson.scripts['test:e2e:interactive']).toBe(
      'cross-env MARKTEXT_TEST_INTERACTIVE=1 MARKTEXT_TEST_BACKGROUND=0 ' +
      'playwright test --config test/e2e/playwright.config.ts'
    )
    expect(playwrightConfig.workers).toBe(1)
    expect(helpers).toContain('MARKTEXT_TEST_INTERACTIVE')
    expect(helpers).not.toContain(": process.platform === 'darwin'")
  })

  it('asserts the canonical main/renderer error ledger across lossless reopen boundaries', () => {
    const helpers = fs.readFileSync(helpersPath, 'utf8')
    const criticMarkupE2e = fs.readFileSync(criticMarkupE2ePath, 'utf8')

    expect(helpers).toContain('export const getCapturedErrors')
    expect(helpers).toContain('export const clearCapturedErrors')
    expect(helpers).toContain('export const expectNoCapturedErrors')
    expect(criticMarkupE2e).toContain('await expectNoCapturedErrors(app)')
    expect(criticMarkupE2e).toContain('await clearCapturedErrors(app)')
  })

  it('drives the hidden file-backed workflow from the shared executable corpus', () => {
    const criticMarkupE2e = fs.readFileSync(criticMarkupE2ePath, 'utf8')

    expect(criticMarkupE2e).toContain('CRITIC_MARKUP_CORPUS')
    expect(criticMarkupE2e).toMatch(/from ['"].*criticMarkup\/__tests__\/sharedCorpus['"]/)
  })
})

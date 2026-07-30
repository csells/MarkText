// Regression guard for issue #4356: TypeError: Cannot read properties of
// null (reading 'length') in link navigation.
//
// Both custom-protocol and document-anchor links cross the same typed target
// interaction. Main resolves the parser node without trusting renderer href.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  closeElectron,
  launchWithMarkdown,
  clearRendererErrors,
  expectNoRendererErrors
} from './helpers'

const CUSTOM_PROTOCOL_DOC =
  '# Repro\n\n[sambesi://localhost/node/11164](sambesi://localhost/node/11164)\n'

const ANCHOR_LINK_DOC = '# Top\n\nsome text\n\n[go to top](#top)\n'

test.describe('Issue #4356: link popover with an unsupported protocol href', () => {
  let app: ElectronApplication
  let page: Page

  test.afterEach(async() => {
    if (app) await closeElectron(app)
  })

  test('custom-protocol navigation is rejected without a renderer crash', async() => {
    const launched = await launchWithMarkdown(CUSTOM_PROTOCOL_DOC)
    app = launched.app
    page = launched.page
    await clearRendererErrors(app)

    // The sanitized live-HTML profile refuses the unsupported scheme at
    // render: the link mounts with its text but an EMPTY href, so the
    // navigation #4356 crashed on can no longer even be requested — a
    // strictly earlier rejection than the original click-time guard.
    const link = page.locator('.editor-component a', {
      hasText: 'sambesi://localhost/node/11164'
    })
    await link.waitFor({ state: 'visible', timeout: 10000 })
    expect(await link.getAttribute('href')).toBe('')

    await link.click()
    await page.waitForTimeout(500)
    await expectNoRendererErrors(app)
  })

  test('anchor links still offer jump and clicking it does not crash', async() => {
    const launched = await launchWithMarkdown(ANCHOR_LINK_DOC)
    app = launched.app
    page = launched.page
    await clearRendererErrors(app)

    const link = page.locator('.editor-component a[href="#top"]')
    await link.waitFor({ state: 'visible', timeout: 10000 })

    const jumpButton = page.getByRole('button', { name: 'Open link: #top' })
    await jumpButton.waitFor({ state: 'visible', timeout: 5000 })
    await jumpButton.click()

    // Give a (potential) error time to propagate over IPC.
    await page.waitForTimeout(500)
    await expectNoRendererErrors(app)
  })
})

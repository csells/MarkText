import * as os from 'node:os'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  closeElectron,
  clickMenuById,
  expectNoCapturedErrors,
  launchWithMarkdown
} from './helpers'

// Plan 0009 performance acceptance for the production document-core engine. The
// 4,096-line no-opener fixture must open within 5 seconds, and five projection
// toggles, next/previous review actions, and sidebar refreshes must each
// complete with a p95 below 500ms. Budgets are asserted against the real
// hidden editor window; every run attaches the machine descriptor below so
// the measurements are tied to a recorded machine. Investigate outliers
// rather than average them away.

const OPEN_BUDGET_MS = 5000
const ACTION_P95_BUDGET_MS = 500

const MACHINE_RECORD = {
  hostname: os.hostname(),
  platform: `${process.platform}-${process.arch}`,
  release: os.release(),
  cpu: os.cpus()[0]?.model ?? 'unknown',
  cores: os.cpus().length,
  memoryGb: Math.round(os.totalmem() / 1024 ** 3),
  node: process.version
}

const attachMachineRecord = async(): Promise<void> => {
  await test.info().attach('machine-record', {
    body: JSON.stringify(MACHINE_RECORD, null, 2),
    contentType: 'application/json'
  })
}

const NO_OPENER_4096 = `${
  'ordinary { json: true } ++ -- == >> ~~ and [link](url) text\n'.repeat(4096)
}`

// A review-bearing tail so projection toggles and next/previous have items
// to operate on without changing the fixture's no-opener bulk.
const REVIEW_TAIL =
  '\nreview {++added++} tail {--removed--} with {~~old~>new~~} items\n'

function p95(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]
}

test.describe('document-core CriticMarkup performance budgets', () => {
  test.describe.configure({ timeout: 120000 })

  let app: ElectronApplication
  let page: Page

  test.afterEach(async() => {
    if (app) {
      await expectNoCapturedErrors(app)
      await closeElectron(app)
    }
  })

  test('opens the 4,096-line no-opener fixture within the 5s budget', async() => {
    await attachMachineRecord()
    const startedAt = Date.now()
    const launched = await launchWithMarkdown(NO_OPENER_4096)
    app = launched.app
    page = launched.page
    await expect(page.locator('.editor-component')).toContainText('ordinary')
    const openMs = Date.now() - startedAt

    // The launch envelope includes Electron boot; the document budget is the
    // dominant term and the assertion holds the whole envelope to it.
    expect(openMs, `open took ${openMs}ms`).toBeLessThanOrEqual(OPEN_BUDGET_MS)
  })

  test('five projection toggles, review navigation, and sidebar refreshes stay under the 500ms p95', async() => {
    await attachMachineRecord()
    const launched = await launchWithMarkdown(NO_OPENER_4096 + REVIEW_TAIL)
    app = launched.app
    page = launched.page
    await expect(page.locator('.editor-component')).toContainText('review')
    // Establish steady state through the current public projection commands.
    // No synthetic readiness attribute is a document-core completion
    // contract; an explicit round-trip proves both publications completed
    // before the measured samples begin.
    await clickMenuById(app, 'reviewShowOriginalMenuItem')
    await expect(page.locator(
      '.editor-component[data-critic-projection="original"]'
    )).toBeAttached()
    await clickMenuById(app, 'reviewShowMarkedMenuItem')
    await expect(page.locator(
      '.editor-component[data-critic-projection="marked"]'
    )).toBeAttached()
    await page.evaluate(async() => await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    ))

    const timed = async(action: () => Promise<void>): Promise<number> => {
      const startedAt = Date.now()
      await action()
      return Date.now() - startedAt
    }

    const toggleSamples: number[] = []
    for (let round = 0; round < 5; round++) {
      toggleSamples.push(await timed(async() => {
        await clickMenuById(app, 'reviewShowOriginalMenuItem')
        await expect(page.locator('.editor-component')).toHaveAttribute(
          'data-critic-projection',
          'original'
        )
      }))
      toggleSamples.push(await timed(async() => {
        await clickMenuById(app, 'reviewShowMarkedMenuItem')
        await expect(page.locator('.editor-component')).toHaveAttribute(
          'data-critic-projection',
          'marked'
        )
      }))
    }

    const navigationSamples: number[] = []
    for (let round = 0; round < 5; round++) {
      navigationSamples.push(await timed(async() => {
        await clickMenuById(app, 'reviewNextMenuItem')
      }))
      navigationSamples.push(await timed(async() => {
        await clickMenuById(app, 'reviewPreviousMenuItem')
      }))
    }

    // The sidebar toggle is the general side-bar menu item; each toggle
    // forces the Review panel to refresh its snapshot.
    const sidebarSamples: number[] = []
    for (let round = 0; round < 5; round++) {
      sidebarSamples.push(await timed(async() => {
        await clickMenuById(app, 'sideBarMenuItem')
      }))
    }

    const report = {
      machine: MACHINE_RECORD,
      togglesP95: p95(toggleSamples),
      navigationP95: p95(navigationSamples),
      sidebarP95: p95(sidebarSamples),
      toggleSamples,
      navigationSamples,
      sidebarSamples
    }
    test.info().annotations.push({
      type: 'perf',
      description: JSON.stringify(report)
    })

    expect(report.togglesP95, JSON.stringify(report))
      .toBeLessThan(ACTION_P95_BUDGET_MS)
    expect(report.navigationP95, JSON.stringify(report))
      .toBeLessThan(ACTION_P95_BUDGET_MS)
    expect(report.sidebarP95, JSON.stringify(report))
      .toBeLessThan(ACTION_P95_BUDGET_MS)
  })
})

import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'

import {
  expectNoRendererErrors,
  getMarkdownContent,
  launchWithMarkdown,
  placeCaretInEditor,
  sendIpcToRenderer,
  setSourceMarkdown,
  typeIntoEditor
} from './helpers'

interface ShadowReportView {
  documentId?: string
  accepted: boolean
  status: string
  revision: number
  recognition?: {
    sourceLength: number
    annotationCounts: Record<string, number>
  }
  metrics: {
    parseMs: number
    queueMs: number
    queueDepth: number
  }
}

const readSettledReports = (page: Page): Promise<ShadowReportView[]> =>
  page.evaluate(async() => {
    const shadow = window.__marktextDocumentCoreShadow
    if (!shadow) throw new Error('Document-core Shadow test bridge is unavailable')
    await shadow.settled()
    return [...shadow.reports()] as ShadowReportView[]
  })

test.describe('document-core Shadow integration', () => {
  let app: ElectronApplication
  let page: Page
  let filePath: string

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('alpha\n', {
      suppressErrorDialog: true,
      env: { MARKTEXT_DOCUMENT_CORE_SHADOW: '1' }
    })
    app = launched.app
    page = launched.page
    filePath = launched.filePath
    await page.waitForFunction(
      () => window.__marktextDocumentCoreShadow?.diagnosticOnly === true,
      null,
      { timeout: 10000 }
    )
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('observes WYSIWYG, Source, and tab changes without changing editor authority', async() => {
    const initialReports = await readSettledReports(page)
    const initial = initialReports.at(-1)
    expect(initial).toMatchObject({
      accepted: true,
      revision: 1,
      recognition: {
        annotationCounts: {
          addition: 0,
          deletion: 0,
          substitution: 0,
          highlight: 0,
          comment: 0
        }
      }
    })
    expect(initial?.documentId).toBeTruthy()
    expect(initial?.metrics.parseMs).toBeGreaterThanOrEqual(0)
    const firstDocumentId = initial?.documentId

    await placeCaretInEditor(page)
    await typeIntoEditor(page, ' {++new++}')
    // Save before waiting for Shadow. Persistence must never acquire a Shadow
    // barrier or consume one of its results.
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => fs.readFileSync(filePath, 'utf8'), {
      timeout: 10000
    }).toContain('{++new++}')
    await expect.poll(async() => {
      const latest = (await readSettledReports(page)).at(-1)
      return latest?.recognition?.annotationCounts.addition ?? 0
    }, { timeout: 10000 }).toBe(1)
    expect(await getMarkdownContent(page, app)).toContain('{++new++}')

    const sourceDocument = '# source\n\n{>>review note<<}\n'
    await setSourceMarkdown(page, app, sourceDocument)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => fs.readFileSync(filePath, 'utf8'), {
      timeout: 10000
    }).toBe(sourceDocument)
    await expect.poll(async() => {
      const latest = (await readSettledReports(page)).at(-1)
      return latest?.recognition?.annotationCounts.comment ?? 0
    }, { timeout: 10000 }).toBe(1)
    expect(await getMarkdownContent(page, app)).toBe(sourceDocument)

    const tabCount = await page.locator('.tabs-container > li').count()
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, '{--old--}\n')
    await page.waitForFunction(
      previous => document.querySelectorAll('.tabs-container > li').length > previous,
      tabCount,
      { timeout: 10000 }
    )
    const secondDocumentId = await page.evaluate(
      () => document.querySelector('.tabs-container > li.active')?.getAttribute('data-id')
    )
    expect(secondDocumentId).toBeTruthy()
    expect(secondDocumentId).not.toBe(firstDocumentId)

    // Switch back without waiting for the new tab's Shadow open. Late replies
    // must retain their own generation and cannot become the active document.
    await sendIpcToRenderer(app, 'mt::switch-tab-by-index', 0)
    const finalReports = await readSettledReports(page)
    expect(finalReports).toContainEqual(expect.objectContaining({
      documentId: secondDocumentId,
      recognition: expect.objectContaining({
        annotationCounts: expect.objectContaining({ deletion: 1 })
      })
    }))
    expect(finalReports.at(-1)?.documentId).toBe(firstDocumentId)
    expect(await getMarkdownContent(page, app)).toBe(sourceDocument)
    await expectNoRendererErrors(app)
  })
})

test('document-core Shadow stays absent without the exact opt-in flag', async() => {
  const { app, page } = await launchWithMarkdown('ordinary markdown\n', {
    suppressErrorDialog: true,
    env: { MARKTEXT_DOCUMENT_CORE_SHADOW: undefined }
  })
  try {
    await page.waitForTimeout(100)
    expect(await page.evaluate(
      () => window.__marktextDocumentCoreShadow === undefined
    )).toBe(true)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

import { expect, test } from '@playwright/test'
import {
  clickMenuById,
  expectEditorWindowHidden,
  expectNoRendererErrors,
  launchWithMarkdown
} from './helpers'

// Owner decisions of 25 September for the Review surface around the editor.
const source = 'Plain {++added++} text.\n'
const env = { MARKTEXT_E2E_HIDDEN_WINDOW: '1', MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: undefined }

test('Review menu items carry the agreed names and shortcuts', async() => {
  const { app } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    const items = await app.evaluate(({ Menu }) => Object.fromEntries(
      ['critic-add-comment', 'critic-mark-highlight', 'critic-mark-addition', 'critic-suggest-replacement',
        'critic-track-changes', 'critic-next', 'critic-previous', 'critic-accept', 'critic-reject']
        .map(id => {
          const item = Menu.getApplicationMenu()?.getMenuItemById(id)
          return [id, { label: item?.label, accelerator: item?.accelerator ?? null }]
        })
    ))
    expect(items).toEqual({
      'critic-add-comment': { label: 'Add Comment', accelerator: 'Command+Alt+Shift+M' },
      'critic-mark-highlight': { label: 'Highlight for Review', accelerator: null },
      'critic-mark-addition': { label: 'Mark as Addition', accelerator: null },
      'critic-suggest-replacement': { label: 'Suggest Replacement', accelerator: null },
      'critic-track-changes': { label: 'Track Changes', accelerator: 'Command+Shift+E' },
      'critic-next': { label: 'Next', accelerator: 'Command+Alt+]' },
      'critic-previous': { label: 'Previous', accelerator: 'Command+Alt+[' },
      'critic-accept': { label: 'Accept', accelerator: 'Command+Alt+A' },
      'critic-reject': { label: 'Reject', accelerator: 'Command+Alt+R' }
    })
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('the title bar shows tracking while it is on, and clicking it turns tracking off', async() => {
  const { app, page } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    const badge = page.getByTestId('title-bar-tracking')
    await expect(badge).toHaveCount(0)
    await clickMenuById(app, 'critic-track-changes')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveText('Tracking')
    await badge.click()
    await expect(badge).toHaveCount(0)
    await expect.poll(() => app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById('critic-track-changes')?.checked)).toBe(false)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('reader views name themselves in a banner that returns to Markup', async() => {
  const { app, page } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    const banner = page.getByTestId('core-reader-banner')
    await expect(banner).toHaveCount(0)
    await clickMenuById(app, 'critic-original')
    await expect(banner).toContainText('Original — read-only')
    await clickMenuById(app, 'critic-revised')
    await expect(banner).toContainText('Revised — read-only')
    await page.getByTestId('core-reader-banner-markup').click()
    await expect(banner).toHaveCount(0)
    await expect(page.locator('.editor-component [data-critic-kind="addition"]')).toBeVisible()
    await expectEditorWindowHidden(app)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('the sidebar author strip and title-bar Review button are gone', async() => {
  const { app, page } = await launchWithMarkdown(source, { suppressErrorDialog: true, env })
  try {
    await clickMenuById(app, 'critic-show')
    const paragraph = page.locator('.mu-paragraph-content').first()
    await paragraph.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    await expect(page.locator('.core-review-author-bar')).toHaveCount(0)
    await expect(page.locator('.title-bar .review-toggle:not([data-testid="title-bar-tracking"])')).toHaveCount(0)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('suggestions expose their review meaning to assistive technology', async() => {
  const { app, page } = await launchWithMarkdown('A {++new++} and {--old--} and {~~quick~>swift~~} and {==marked==}.\n', { suppressErrorDialog: true, env })
  try {
    const roles = await page.locator('.editor-component [data-critic-kind]').evaluateAll(nodes =>
      nodes.filter(node => node.textContent).map(node => `${(node as HTMLElement).dataset.criticKind}${(node as HTMLElement).dataset.criticArm ? `:${(node as HTMLElement).dataset.criticArm}` : ''}=${node.getAttribute('role')}`))
    expect(roles).toEqual(['addition=insertion', 'deletion=deletion', 'substitution:old=deletion', 'substitution:new=insertion', 'highlight=mark'])
    await clickMenuById(app, 'critic-show')
    const names = await page.getByTestId('critic-review-entry').locator(':scope > button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))
    expect(names).toEqual(['Addition: new', 'Deletion: old', 'Replacement: quick → swift', 'Highlight: marked'])
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

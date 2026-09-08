import { expect, test } from '@playwright/test'
import type { Page } from 'playwright'
import { readFileSync } from 'node:fs'
import { expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'
import { reviewActionWordBreaks } from './helpers/reviewActionWordBreaks'

const source = 'Passage.{>>A comment.<<}\n'
const tabTo = async(page: Page, testId: string): Promise<void> => {
  const target = page.getByTestId(testId)
  for (let index = 0; index < 80; index++) {
    if (await target.evaluate((node) => node === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  await expect(target).toBeFocused()
}

const expectReviewFits = async(page: Page): Promise<void> => {
  const overflow = await page.locator('#core-review-panel').evaluate((panel) => {
    const panelBounds = panel.getBoundingClientRect()
    const failures: string[] = []
    for (const element of panel.querySelectorAll<HTMLElement>('button, textarea, form')) {
      const bounds = element.getBoundingClientRect()
      if (bounds.width === 0 || bounds.height === 0) continue
      const name = element.dataset.testid ?? element.textContent?.trim() ?? element.tagName
      if (bounds.left < panelBounds.left - 1 || bounds.right > panelBounds.right + 1) {
        failures.push(
          `${name}: control ${bounds.left}..${bounds.right} outside panel ${panelBounds.left}..${panelBounds.right}`
        )
      }
      if (element.tagName === 'BUTTON') {
        const text = document.createRange()
        text.selectNodeContents(element)
        for (const rect of text.getClientRects()) {
          if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) {
            failures.push(`${name}: text overflows its button`)
          }
        }
      }
    }
    return failures
  })
  expect(overflow).toEqual([])
}

test('keyboard comment editing restores the selected review item after Escape and save', async() => {
  const { app, page, filePath } = await launchWithMarkdown(source, {
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    const marker = page.locator('.mu-critic-comment-marker')
    await marker.focus()
    await page.keyboard.press('Enter')
    await tabTo(page, 'critic-review-edit-comment')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('critic-review-comment-input')).toBeFocused()
    await page.keyboard.press('Escape')
    const selected = page.locator('.core-review-entry.active > button')
    await expect(selected).toBeFocused()
    await tabTo(page, 'critic-review-edit-comment')
    await page.keyboard.press('Enter')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await page.keyboard.insertText('Keyboard note.')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await expect(selected).toBeFocused()
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('Passage.{>>Keyboard note.<<}\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('reader and comment regions show keyboard focus in both themes', async() => {
  const { app, page } = await launchWithMarkdown(source, {
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    await page.locator('.mu-critic-comment-marker').focus()
    await page.keyboard.press('Enter')
    for (const theme of ['light', 'dark']) {
      await sendIpcToRenderer(app, 'mt::user-preference', { theme })
      for (const mode of ['comment', 'original', 'revised']) {
        if (mode !== 'comment') await page.getByTestId(`critic-review-${mode}`).click()
        const region = page.locator(`[data-projection="${mode}"]`)
        await expect(region).toBeVisible()
        await expect(region).toHaveAttribute('aria-busy', 'false')
        await region.focus()
        await page.keyboard.press('Tab')
        await page.keyboard.press('Shift+Tab')
        await expect(region).toBeFocused()
        await expect(region).toHaveCSS('outline-style', 'solid')
        await expect(region).toHaveCSS('outline-width', '2px')
        await page.screenshot({ path: test.info().outputPath(`${theme}-${mode}-focus.png`) })
      }
    }
  } finally {
    await app.close()
  }
})

test('review labels and marker names switch language while teleported comment text retains RTL direction', async() => {
  const { app, page, filePath } = await launchWithMarkdown('مرحبا.{>>ملاحظة (ABC 123).<<}\n', {
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    await page.locator('.mu-critic-comment-marker').focus()
    await page.keyboard.press('Enter')
    await sendIpcToRenderer(app, 'mt::user-preference', { textDirection: 'rtl' })
    for (const [locale, markerLabel, title, cancel] of [
      ['fr', 'Commentaire', 'Commentaires et suggestions', 'Annuler'],
      ['zh-CN', '批注', '批注和建议', '取消']
    ]) {
      await sendIpcToRenderer(app, 'language-changed', locale)
      await sendIpcToRenderer(app, 'mt::user-preference', { language: locale })
      await expect(page.locator('.mu-critic-comment-marker')).toHaveAttribute(
        'aria-label',
        markerLabel
      )
      await expect(page.locator('#core-review-panel h2')).toHaveText(title)
      await expect(page.locator('.core-review-comment')).toHaveCSS('direction', 'rtl')
      await tabTo(page, 'critic-review-edit-comment')
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('critic-review-comment-input')).toHaveCSS('direction', 'rtl')
      await expect(page.getByTestId('critic-review-comment-input')).toHaveValue('ملاحظة (ABC 123).')
      await expect(page.getByTestId('critic-review-comment-cancel')).toHaveText(cancel)
      await page.screenshot({ path: test.info().outputPath(`review-${locale}-rtl.png`) })
      await expectReviewFits(page)
      await page.keyboard.press('Escape')
    }
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('مرحبا.{>>ملاحظة (ABC 123).<<}\n')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('sidebar icons show keyboard focus and review actions use shared light/dark button states', async() => {
  const { app, page } = await launchWithMarkdown(source, {
    env: { MARKTEXT_E2E_HIDDEN_WINDOW: '1' }
  })
  try {
    await page.locator('.mu-critic-comment-marker').focus()
    await page.keyboard.press('Enter')
    const icon = page.getByRole('tab', { name: 'Comments and Suggestions', exact: true })
    for (const theme of ['light', 'dark']) {
      await sendIpcToRenderer(app, 'mt::user-preference', { theme })
      await page.setViewportSize({ width: 900, height: 700 })
      await icon.focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      await expect(icon).toBeFocused()
      await expect(icon).toHaveCSS('outline-style', 'solid')
      await expect(icon).toHaveCSS('outline-width', '2px')
      const action = page.getByTestId('critic-review-edit-comment')
      await expect(action).toBeVisible()
      await expect(page.getByTestId('critic-review-remove')).toBeVisible()
      await expect(page.locator('#core-review-panel .core-review-item-actions button')).toHaveCount(
        2
      )
      await expectReviewFits(page)
      expect(await page.locator('#core-review-panel').evaluate(reviewActionWordBreaks)).toEqual([])
      await page.screenshot({ path: test.info().outputPath(`review-${theme}-narrow-actions.png`) })
      for (const [state, token] of [
        ['hover', '--buttonBgColorHover'],
        ['active', '--buttonBgColorActive']
      ] as const) {
        await action.hover()
        if (state === 'active') await page.mouse.down()
        const colors = await action.evaluate((node, variable) => {
          const reference = document.createElement('span')
          reference.style.backgroundColor = `var(${variable})`
          node.append(reference)
          const expected = getComputedStyle(reference).backgroundColor
          reference.remove()
          return { actual: getComputedStyle(node).backgroundColor, expected }
        }, token)
        expect(colors.actual).toBe(colors.expected)
        if (state === 'active') {
          await page.mouse.move(0, 0)
          await page.mouse.up()
        }
      }
      await action.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('critic-review-comment-input')).toBeFocused()
      await expect(page.getByTestId('critic-review-next')).toBeHidden()
      await expect(page.locator('.core-review-entry.active > button')).toBeDisabled()
      await page.screenshot({ path: test.info().outputPath(`review-${theme}-narrow-focus.png`) })
      await expectReviewFits(page)
      await page.keyboard.press('Escape')
    }
  } finally {
    await app.close()
  }
})

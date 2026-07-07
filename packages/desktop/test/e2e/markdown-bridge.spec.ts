import { test, expect } from '@playwright/test'
import { launchWithMarkdown, typeIntoEditor, focusEditor } from './helpers'
import type { LaunchResult } from './helpers'

// The test-mode markdown bridge (specs/architecture/test-infrastructure.md):
// document bytes are read through window.__marktextTest.getTabMarkdown(),
// never by round-tripping through source mode. These specs pin the bridge's
// own contract; every other spec consumes it via getMarkdownContent.

declare global {
  interface Window {
    __marktextTest?: {
      registerTabMarkdownProvider(provider: () => string): void
      getTabMarkdown(): string
    }
  }
}

let launched: LaunchResult | null = null

test.afterEach(async() => {
  if (launched) {
    await launched.app.close()
    launched = null
  }
})

test('the bridge returns the committed markdown without toggling modes', async() => {
  launched = await launchWithMarkdown('hello world\n')
  const { page } = launched

  const markdown = await page.evaluate(() => {
    if (!window.__marktextTest) throw new Error('test bridge missing in test mode')
    return window.__marktextTest.getTabMarkdown()
  })

  expect(markdown).toBe('hello world\n')
  // Reading through the bridge must not have entered source mode.
  expect(await page.locator('.source-code').count()).toBe(0)
})

test('the bridge flushes pending edits before reading', async() => {
  launched = await launchWithMarkdown('hello world\n')
  const { page } = launched

  await focusEditor(page)
  await typeIntoEditor(page, 'edited')

  // No explicit save happens between typing and reading: the typed text can
  // only appear if the bridge itself flushes the engine.
  await expect
    .poll(async() =>
      page.evaluate(() => {
        if (!window.__marktextTest) throw new Error('test bridge missing in test mode')
        return window.__marktextTest.getTabMarkdown()
      })
    )
    .toContain('edited')
  expect(await page.locator('.source-code').count()).toBe(0)
})

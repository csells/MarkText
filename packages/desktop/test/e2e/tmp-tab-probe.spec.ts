import { test } from '@playwright/test'
import { closeElectron, launchWithMarkdown, openUntitledTabWithMarkdown } from './helpers'

test('tab creation probe', async() => {
  const { app, page } = await launchWithMarkdown('# Tab base\n')
  try {
    const count = () => page.evaluate(() =>
      document.querySelectorAll('.tabs-container > li').length)
    console.log('TAB-PROBE before:', await count())
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await openUntitledTabWithMarkdown(page, '')
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(300)
      console.log('TAB-PROBE after:', await count(), 'active:', await page.evaluate(() => {
        const a = document.activeElement
        return a ? `${a.tagName}.${[...a.classList].join('.')}` : 'none'
      }))
    }
  } finally {
    await closeElectron(app)
  }
})

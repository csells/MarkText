import { expect, test } from '@playwright/test'
import {
  clearRendererErrors,
  expectNoRendererErrors,
  getRendererErrors,
  launchWithMarkdown,
  waitForRendererError
} from './helpers'

// The e2e harness must FAIL CLOSED on renderer errors: any uncaught renderer
// exception during a spec makes the run red, without the spec having to opt in.
// These tests pin the two properties that guarantee it — (1) the error counter
// is installed on every launch, not just for specs that ask, and (2) the
// close-time guard actually throws when errors were captured.

test.describe('e2e harness fails closed on renderer errors', () => {
  test('the renderer-error counter is installed on a plain launch (no opt-in)', async() => {
    // allowErrors so THIS test's own teardown does not fail on the error we
    // inject on purpose.
    const { app, page } = await launchWithMarkdown('# Plain\n', { allowErrors: true })
    try {
      await page.evaluate(() => {
        setTimeout(() => {
          throw new Error('unopted-renderer-error')
        }, 0)
      })
      const captured = await waitForRendererError(
        app,
        (e) => !!e.message?.includes('unopted-renderer-error'),
        5000
      )
      expect(
        captured,
        'a plain launch must still capture renderer errors — the counter is unconditional'
      ).not.toBeNull()
    } finally {
      await app.close()
    }
  })

  test('expectNoRendererErrors throws when an error was captured (the guard has teeth)', async() => {
    const { app, page } = await launchWithMarkdown('# Guard\n', { allowErrors: true })
    try {
      await page.evaluate(() => {
        setTimeout(() => {
          throw new Error('guarded-renderer-error')
        }, 0)
      })
      await waitForRendererError(app, (e) => !!e.message?.includes('guarded-renderer-error'), 5000)

      await expect(expectNoRendererErrors(app)).rejects.toThrow(/guarded-renderer-error/)

      // Clearing the sink makes the guard pass again — proving it reflects
      // live state, not a latched flag.
      await clearRendererErrors(app)
      await expectNoRendererErrors(app)
      expect(await getRendererErrors(app)).toEqual([])
    } finally {
      await app.close()
    }
  })
})

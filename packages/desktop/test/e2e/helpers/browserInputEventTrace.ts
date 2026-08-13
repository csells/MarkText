import type { Page } from 'playwright'

export interface BrowserInputEventSample {
  readonly sequence: number
  readonly data: string
  readonly inputType: string
  readonly tEvent: number
}

interface BrowserInputEventProbe {
  readonly samples: BrowserInputEventSample[]
  readonly disconnect: () => void
}

type TracedWindow = Window & {
  __marktextBrowserInputEventProbe?: BrowserInputEventProbe
}

/**
 * Captures only the browser beforeinput origin used by the Core authority
 * latency definitions. Unlike the WYSIWYG input trace, this makes no DOM-echo
 * claim for CodeMirror's hidden-textarea input model.
 */
export const startBrowserInputEventTrace = async(
  page: Page,
  rootSelector: string
): Promise<void> => {
  if (rootSelector.trim().length === 0) {
    throw new Error('Browser input event trace root selector is required')
  }
  await page.evaluate(selector => {
    const tracedWindow = window as TracedWindow
    tracedWindow.__marktextBrowserInputEventProbe?.disconnect()
    const root = document.querySelector(selector)
    if (!(root instanceof HTMLElement)) {
      throw new Error('Browser input event trace root is unavailable')
    }
    const samples: BrowserInputEventSample[] = []
    const handleBeforeInput = (event: Event): void => {
      if (!(event.target instanceof Node) || !root.contains(event.target)) return
      const input = event as InputEvent
      if (input.inputType !== 'insertText' || input.data === null) return
      samples.push(Object.freeze({
        sequence: samples.length + 1,
        data: input.data,
        inputType: input.inputType,
        tEvent: performance.now()
      }))
    }
    root.addEventListener('beforeinput', handleBeforeInput, true)
    tracedWindow.__marktextBrowserInputEventProbe = Object.freeze({
      samples,
      disconnect: () => {
        root.removeEventListener('beforeinput', handleBeforeInput, true)
        delete tracedWindow.__marktextBrowserInputEventProbe
      }
    })
  }, rootSelector)
}

export const waitForBrowserInputEventTrace = async(
  page: Page,
  count: number,
  timeout = 5000
): Promise<void> => {
  await page.waitForFunction(expected =>
    (window as TracedWindow).__marktextBrowserInputEventProbe?.samples.length ===
      expected,
  count,
  { timeout })
}

export const readBrowserInputEventTrace = async(
  page: Page
): Promise<readonly BrowserInputEventSample[]> => page.evaluate(() => {
  const probe = (window as TracedWindow).__marktextBrowserInputEventProbe
  if (probe === undefined) throw new Error('Browser input event trace is not running')
  return probe.samples.map(sample => ({ ...sample }))
})

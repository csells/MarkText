import fs from 'node:fs'
import path from 'node:path'
import type { CDPSession, Page } from 'playwright'

// Opt-in diagnostics for the upstream warm-session producer. None of them
// runs unless its environment variable asks for it, and none changes the
// measured protocol beyond the cost of what it records.

type TraceEvents = unknown[]

/**
 * Starts a renderer CPU profile and a Chromium trace around the measured
 * keys, as MARKTEXT_UPSTREAM_WARM_PROFILE=1 and MARKTEXT_UPSTREAM_WARM_TRACE=1
 * ask. The returned function stops both and writes `<name>.cpuprofile` and
 * `<name>.trace.json` to `directory`.
 */
export const startWarmRendererRecording = async(
  page: Page,
  options: Readonly<{ profile: boolean, trace: boolean }>
): Promise<(directory: string, name: string) => Promise<void>> => {
  const profiler = options.profile ? await page.context().newCDPSession(page) : undefined
  if (profiler !== undefined) {
    await profiler.send('Profiler.enable')
    await profiler.send('Profiler.start')
  }
  const tracing: CDPSession | undefined = options.trace ? await page.context().newCDPSession(page) : undefined
  const events: TraceEvents = []
  if (tracing !== undefined) {
    tracing.on('Tracing.dataCollected', (data: { value: TraceEvents }) => { events.push(...data.value) })
    await tracing.send('Tracing.start', {
      categories: 'devtools.timeline,blink,blink.user_timing,disabled-by-default-devtools.timeline',
      transferMode: 'ReportEvents'
    })
  }
  return async(directory, name) => {
    if (profiler !== undefined) {
      const { profile } = await profiler.send('Profiler.stop')
      fs.writeFileSync(path.join(directory, `${name}.cpuprofile`), JSON.stringify(profile), { flag: 'wx' })
      await profiler.detach()
    }
    if (tracing !== undefined) {
      const done = new Promise(resolve => tracing.once('Tracing.tracingComplete', resolve))
      await tracing.send('Tracing.end')
      await done
      fs.writeFileSync(path.join(directory, `${name}.trace.json`), JSON.stringify(events), { flag: 'wx' })
      await tracing.detach()
    }
  }
}

/**
 * Times a fixed, already optimized loop at every `keydown` or `keyup`. Its
 * duration shows how fast the renderer's core runs at that moment, which
 * differs between apps that idle between keys and apps that keep working. At
 * keydown the loop is short so that it barely warms the core for the key it
 * precedes. The keyup loop is the calibration every performance run records
 * (`performanceCalibration.ts`).
 */
export const installKeyCalibration = async(page: Page, event: 'keydown' | 'keyup'): Promise<void> => {
  await page.evaluate((type) => {
    const spin = (count: number): number => {
      let value = 0
      for (let index = 0; index < count; index += 1) value = (value * 31 + index) | 0
      return value
    }
    for (let index = 0; index < 400; index += 1) spin(3000)
    const times: number[] = []
    Object.assign(window, { __marktextKeyCalibration: times })
    document.addEventListener(type, () => {
      const start = window.performance.now()
      const value = spin(type === 'keydown' ? 30_000 : 300_000)
      // Using the value keeps the loop from being optimized away.
      times.push(window.performance.now() - start + (value === 0.5 ? 1 : 0))
    }, true)
  }, event)
}

export const readKeyCalibration = async(page: Page): Promise<number[]> =>
  page.evaluate(() => (window as unknown as { __marktextKeyCalibration?: number[] }).__marktextKeyCalibration ?? [])

/**
 * The editor's DOM as MARKTEXT_UPSTREAM_WARM_DOM=1 reports it: element and
 * text sizes, sidebar width, non-editable islands, and any element under a
 * Chromium display lock, each of which changes the cost of a caret update.
 */
export const captureEditorDom = async(page: Page): Promise<unknown> => page.evaluate(() => {
  const editor = document.querySelector('.editor-component')
  if (!(editor instanceof HTMLElement)) throw new Error('MarkText editor is unavailable')
  const side = document.querySelector('.side-bar')
  const nonEditable: Record<string, number> = {}
  for (const element of editor.querySelectorAll('[contenteditable="false"]')) {
    const key = `${element.tagName}.${[...element.classList].slice(0, 3).join('.')}`
    nonEditable[key] = (nonEditable[key] ?? 0) + 1
  }
  const displayLocks = [...document.querySelectorAll('*')].flatMap(element => {
    const own = getComputedStyle(element).contentVisibility
    const details = element.tagName === 'DETAILS'
      ? getComputedStyle(element, '::details-content').contentVisibility
      : 'visible'
    return own !== 'visible' || details !== 'visible' || element.getAttribute('hidden') === 'until-found'
      ? [`${element.tagName}.${element.className} own=${own} details=${details}`]
      : []
  })
  return {
    documentElements: document.querySelectorAll('*').length,
    editorElements: editor.querySelectorAll('*').length,
    editorTextLength: editor.textContent?.length ?? 0,
    editableElements: editor.querySelectorAll('[contenteditable="true"]').length,
    nonEditable,
    displayLocks,
    sidebarWidth: side instanceof HTMLElement ? side.offsetWidth : null,
    editorWidth: editor.offsetWidth,
    firstBlocks: [...editor.querySelectorAll(':scope > * > *')].slice(0, 8).map(block => block.outerHTML.slice(0, 400))
  }
})

/**
 * The median forced layout after appending one character to the first
 * paragraph's text, with every stylesheet and with each one disabled in
 * turn. Run after the measured keys: it changes the DOM behind the editor
 * and restores it.
 */
export const probeForcedLayout = async(page: Page): Promise<unknown> => page.evaluate(() => {
  const now = (): number => window.performance.now()
  // Reading a layout value forces the pending layout.
  const layout = (): number => document.body.offsetHeight
  const content = document.querySelector('.editor-component .mu-paragraph-content')
  const text = content === null ? null : document.createTreeWalker(content, NodeFilter.SHOW_TEXT).nextNode()
  if (!(text instanceof Text)) throw new Error('The first paragraph has no text')
  const measure = (): number => {
    const times: number[] = []
    for (let index = 0; index < 25; index += 1) {
      text.appendData('y')
      const start = now()
      layout()
      times.push(now() - start)
      text.deleteData(text.length - 1, 1)
      layout()
    }
    times.sort((left, right) => left - right)
    return times[12]
  }
  measure()
  const withAll = measure()
  const withoutEach = [...document.styleSheets].map((sheet, index) => {
    sheet.disabled = true
    layout()
    measure()
    const without = measure()
    sheet.disabled = false
    layout()
    return { index, href: sheet.href, without }
  })
  return { withAll, withoutEach }
})

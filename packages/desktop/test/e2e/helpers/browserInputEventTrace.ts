import type { Page } from 'playwright'

import {
  captureExactCompositorPresentation
} from './performancePresentationCheckpoint'

export interface BrowserInputEventSample {
  readonly sequence: number
  readonly data: string
  readonly inputType: string
  readonly tEvent: number
  readonly tEcho?: number
  readonly tFrame?: number
  readonly expectedDocumentCheckpoint: BrowserInputDocumentCheckpoint
  readonly echoDocumentCheckpoint?: BrowserInputDocumentCheckpoint
  readonly frameDocumentCheckpoint?: BrowserInputDocumentCheckpoint
}

export interface BrowserInputDocumentCheckpoint {
  readonly valueLength: number
  readonly valueHash: string
}

export type CompleteBrowserInputEventSample = BrowserInputEventSample &
  Readonly<{
    readonly tEcho: number
    readonly tFrame: number
    readonly echoDocumentCheckpoint: BrowserInputDocumentCheckpoint
    readonly frameDocumentCheckpoint: BrowserInputDocumentCheckpoint
  }>

const sameCheckpoint = (
  left: BrowserInputDocumentCheckpoint,
  right: BrowserInputDocumentCheckpoint
): boolean => left.valueLength === right.valueLength &&
  left.valueHash === right.valueHash

export function requireCompleteBrowserInputEventSample(
  sample: BrowserInputEventSample
): CompleteBrowserInputEventSample {
  if (
    sample.tEcho === undefined || sample.tFrame === undefined ||
    sample.echoDocumentCheckpoint === undefined ||
    sample.frameDocumentCheckpoint === undefined
  ) throw new Error('Browser input event sample is incomplete')
  if (sample.tEvent > sample.tEcho || sample.tEcho > sample.tFrame) {
    throw new Error('Browser input event sample timing order is invalid')
  }
  if (
    !sameCheckpoint(
      sample.expectedDocumentCheckpoint,
      sample.echoDocumentCheckpoint
    ) ||
    !sameCheckpoint(
      sample.expectedDocumentCheckpoint,
      sample.frameDocumentCheckpoint
    )
  ) throw new Error('Browser input event sample checkpoint differs')
  return sample as CompleteBrowserInputEventSample
}

interface ExpectedBrowserInputDocumentCheckpoint
  extends BrowserInputDocumentCheckpoint {
  readonly value: string
}

export function expectedCodeMirrorInputCheckpoint(input: Readonly<{
  readonly value: string
  readonly selectionStart: number
  readonly selectionEnd: number
  readonly data: string
}>): ExpectedBrowserInputDocumentCheckpoint {
  if (
    !Number.isSafeInteger(input.selectionStart) ||
    !Number.isSafeInteger(input.selectionEnd) ||
    input.selectionStart < 0 || input.selectionEnd < input.selectionStart ||
    input.selectionEnd > input.value.length
  ) throw new RangeError('CodeMirror input selection is invalid')
  const value = input.value.slice(0, input.selectionStart) + input.data +
    input.value.slice(input.selectionEnd)
  return Object.freeze({ value, ...checkpointFor(value) })
}

const checkpointFor = (value: string): BrowserInputDocumentCheckpoint => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return Object.freeze({
    valueLength: value.length,
    valueHash: (hash >>> 0).toString(16).padStart(8, '0')
  })
}

interface MutableBrowserInputEventSample {
  sequence: number
  data: string
  inputType: string
  tEvent: number
  tEcho?: number
  tFrame?: number
  expectedDocumentCheckpoint: BrowserInputDocumentCheckpoint
  echoDocumentCheckpoint?: BrowserInputDocumentCheckpoint
  frameDocumentCheckpoint?: BrowserInputDocumentCheckpoint
  expectedValue?: string
}

export function observeCodeMirrorDocumentCheckpoint(
  sample: Pick<
    MutableBrowserInputEventSample,
    'expectedValue' | 'tEcho' | 'tFrame' | 'echoDocumentCheckpoint' |
    'frameDocumentCheckpoint'
  >,
  value: string,
  observedAt: number,
  phase: 'echo' | 'frame'
): boolean {
  if (sample.expectedValue === undefined || value !== sample.expectedValue) {
    return false
  }
  if (phase === 'echo') {
    if (sample.tEcho !== undefined) return false
    sample.tEcho = observedAt
    sample.echoDocumentCheckpoint = checkpointFor(value)
    return true
  }
  if (sample.tEcho === undefined || sample.tFrame !== undefined) return false
  sample.tFrame = observedAt
  sample.frameDocumentCheckpoint = checkpointFor(value)
  sample.expectedValue = undefined
  return true
}

interface BrowserInputEventProbe {
  readonly samples: MutableBrowserInputEventSample[]
  readonly disconnect: () => void
}

type TracedWindow = Window & {
  __marktextBrowserInputEventProbe?: BrowserInputEventProbe
}

/**
 * Captures the browser beforeinput origin and CodeMirror's exact document
 * checkpoint. The echo is the first matching CodeMirror change; the frame is
 * the next render opportunity that retains that same exact document value.
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
    const host = root.querySelector('.CodeMirror') as
      | (Element & {
        CodeMirror?: {
          getValue(): string
          listSelections(): readonly Readonly<{
            anchor: unknown
            head: unknown
          }>[]
          indexFromPos(position: unknown): number
          on(event: 'change', listener: () => void): void
          off(event: 'change', listener: () => void): void
        }
      })
      | null
    const codeMirror = host?.CodeMirror
    if (codeMirror === undefined) {
      throw new Error('Browser input event trace requires CodeMirror')
    }
    const checkpoint = (value: string): BrowserInputDocumentCheckpoint => {
      let hash = 0x811c9dc5
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
      }
      return Object.freeze({
        valueLength: value.length,
        valueHash: (hash >>> 0).toString(16).padStart(8, '0')
      })
    }
    const samples: MutableBrowserInputEventSample[] = []
    const handleChange = (): void => {
      const value = codeMirror.getValue()
      const observedAt = performance.now()
      for (const sample of samples) {
        if (
          sample.expectedValue === undefined || value !== sample.expectedValue ||
          sample.tEcho !== undefined
        ) continue
        sample.tEcho = observedAt
        sample.echoDocumentCheckpoint = checkpoint(value)
        requestAnimationFrame(() => {
          if (sample.expectedValue === undefined || sample.tFrame !== undefined) return
          const frameValue = codeMirror.getValue()
          if (frameValue !== sample.expectedValue) return
          sample.tFrame = performance.now()
          sample.frameDocumentCheckpoint = checkpoint(frameValue)
          sample.expectedValue = undefined
        })
      }
    }
    const handleBeforeInput = (event: Event): void => {
      if (!(event.target instanceof Node) || !root.contains(event.target)) return
      const input = event as InputEvent
      if (input.inputType !== 'insertText' || input.data === null) return
      const selections = codeMirror.listSelections()
      if (selections.length !== 1) return
      const selection = selections[0]
      if (selection === undefined) return
      const anchor = codeMirror.indexFromPos(selection.anchor)
      const head = codeMirror.indexFromPos(selection.head)
      const selectionStart = Math.min(anchor, head)
      const selectionEnd = Math.max(anchor, head)
      const current = codeMirror.getValue()
      const expectedValue = current.slice(0, selectionStart) + input.data +
        current.slice(selectionEnd)
      samples.push({
        sequence: samples.length + 1,
        data: input.data,
        inputType: input.inputType,
        tEvent: performance.now(),
        expectedDocumentCheckpoint: checkpoint(expectedValue),
        expectedValue
      })
    }
    codeMirror.on('change', handleChange)
    root.addEventListener('beforeinput', handleBeforeInput, true)
    tracedWindow.__marktextBrowserInputEventProbe = Object.freeze({
      samples,
      disconnect: () => {
        codeMirror.off('change', handleChange)
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
      expected &&
      (window as TracedWindow).__marktextBrowserInputEventProbe?.samples.every(
        sample => sample.tEcho !== undefined && sample.tFrame !== undefined
      ) === true,
  count,
  { timeout })
}

export const waitForBrowserInputEventEcho = async(
  page: Page,
  count: number,
  timeout = 5000
): Promise<void> => {
  await page.waitForFunction(expected =>
    (window as TracedWindow).__marktextBrowserInputEventProbe?.samples.length ===
      expected &&
      (window as TracedWindow).__marktextBrowserInputEventProbe?.samples.every(
        sample => sample.tEcho !== undefined
      ) === true,
  count,
  { timeout })
}

export const captureBrowserInputEventPresentation = async(
  page: Page,
  sampleIndex = 0,
  timeout = 30_000
): Promise<Readonly<{
  readonly sequence: number
  readonly tEvent: number
  readonly tEcho: number
  readonly tPresent: number
}>> => {
  const presentation = await captureExactCompositorPresentation(page, {
    readAcknowledged: () => page.evaluate(index => {
      const sample = (window as TracedWindow)
        .__marktextBrowserInputEventProbe?.samples[index]
      if (sample?.tEcho === undefined ||
          sample.echoDocumentCheckpoint === undefined) {
        throw new Error('Browser input event trace has no acknowledged sample')
      }
      return Object.freeze({
        tEvent: sample.tEvent,
        tAcknowledged: sample.tEcho,
        expectedCheckpoint: sample.expectedDocumentCheckpoint,
        acknowledgedCheckpoint: sample.echoDocumentCheckpoint
      })
    }, sampleIndex),
    readPresented: () => page.evaluate(index => {
      const sample = (window as TracedWindow)
        .__marktextBrowserInputEventProbe?.samples[index]
      if (sample === undefined) throw new Error('Browser input event sample is missing')
      const host = document.querySelector('.source-code .CodeMirror') as
        | (Element & { CodeMirror?: { getValue(): string } })
        | null
      const value = host?.CodeMirror?.getValue() ?? ''
      let hash = 0x811c9dc5
      for (let offset = 0; offset < value.length; offset += 1) {
        hash ^= value.charCodeAt(offset)
        hash = Math.imul(hash, 0x01000193)
      }
      return Object.freeze({
        observedAt: performance.now(),
        checkpoint: Object.freeze({
          valueLength: value.length,
          valueHash: (hash >>> 0).toString(16).padStart(8, '0')
        })
      })
    }, sampleIndex)
  }, timeout)
  return Object.freeze({
    sequence: sampleIndex + 1,
    tEvent: presentation.tEvent,
    tEcho: presentation.tAcknowledged,
    tPresent: presentation.tPresented
  })
}

export const readBrowserInputEventTrace = async(
  page: Page
): Promise<readonly BrowserInputEventSample[]> => page.evaluate(() => {
  const probe = (window as TracedWindow).__marktextBrowserInputEventProbe
  if (probe === undefined) throw new Error('Browser input event trace is not running')
  return probe.samples.map(sample => ({
    sequence: sample.sequence,
    data: sample.data,
    inputType: sample.inputType,
    tEvent: sample.tEvent,
    tEcho: sample.tEcho,
    tFrame: sample.tFrame,
    expectedDocumentCheckpoint: sample.expectedDocumentCheckpoint,
    echoDocumentCheckpoint: sample.echoDocumentCheckpoint,
    frameDocumentCheckpoint: sample.frameDocumentCheckpoint
  }))
})

import type { Page } from 'playwright'

export interface InputDomCheckpoint {
  readonly targetIndex: number
  readonly textLength: number
  readonly textHash: string
}

export interface InputLatencySample {
  readonly sequence: number
  readonly data: string
  readonly inputType: string
  readonly tEvent: number
  /** First exact DOM text-checkpoint observation after the browser input. */
  readonly tEcho?: number
  /** The next requestAnimationFrame callback (a render opportunity, not paint). */
  readonly tFrame?: number
  readonly expectedDomCheckpoint: InputDomCheckpoint
  readonly echoDomCheckpoint?: InputDomCheckpoint
}

export interface InputLatencyTraceOptions {
  readonly maxSamples?: number
}

export interface InputLatencyTraceStatus {
  readonly accepting: boolean
  readonly pendingSamples: number
  readonly sampleCount: number
  readonly stopReason?: 'capacity' | 'explicit' | 'unsupported-input'
}

interface MutableInputLatencySample {
  sequence: number
  data: string
  inputType: string
  tEvent: number
  tEcho?: number
  tFrame?: number
  expectedDomCheckpoint: InputDomCheckpoint
  echoDomCheckpoint?: InputDomCheckpoint
  expectedText?: string
  observedElement: Element
  targetIndex: number
}

interface InputLatencyProbe {
  readonly samples: MutableInputLatencySample[]
  readonly pending: MutableInputLatencySample[]
  readonly accepting: boolean
  readonly stopReason?: InputLatencyTraceStatus['stopReason']
  readonly disconnect: () => void
  readonly stop: () => void
}

type TracedWindow = Window & {
  __marktextInputLatencyProbe?: InputLatencyProbe
}

const DEFAULT_MAX_SAMPLES = 256

export const startInputLatencyTrace = async(
  page: Page,
  options: InputLatencyTraceOptions = {}
): Promise<void> => {
  const maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES
  if (!Number.isInteger(maxSamples) || maxSamples <= 0) {
    throw new Error('Input latency trace maxSamples must be a positive integer')
  }

  await page.evaluate(capacity => {
    const tracedWindow = window as TracedWindow
    tracedWindow.__marktextInputLatencyProbe?.disconnect()

    const editor = document.querySelector('.editor-component')
    if (!(editor instanceof HTMLElement)) {
      throw new Error('MarkText editor is unavailable')
    }

    const targetSelector = '.mu-paragraph-content'
    const samples: MutableInputLatencySample[] = []
    const pending: MutableInputLatencySample[] = []
    let accepting = true
    let stopReason: InputLatencyTraceStatus['stopReason']
    let inputListenerAttached = true
    let observerConnected = true

    const checkpointFor = (
      targetIndex: number,
      text: string
    ): InputDomCheckpoint => {
      let hash = 0x811c9dc5
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
      }
      return {
        targetIndex,
        textLength: text.length,
        textHash: (hash >>> 0).toString(16).padStart(8, '0')
      }
    }

    const targetIndexOf = (target: Element): number => {
      const targets = editor.querySelectorAll(targetSelector)
      for (let index = 0; index < targets.length; index += 1) {
        if (targets.item(index) === target) return index
      }
      return -1
    }

    const selectionOffsets = (
      target: Element
    ): { start: number, end: number } | undefined => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return undefined
      const selected = selection.getRangeAt(0)
      if (
        !target.contains(selected.startContainer) ||
        !target.contains(selected.endContainer)
      ) {
        return undefined
      }
      const prefix = document.createRange()
      prefix.selectNodeContents(target)
      prefix.setEnd(selected.startContainer, selected.startOffset)
      const suffix = document.createRange()
      suffix.selectNodeContents(target)
      suffix.setEnd(selected.endContainer, selected.endOffset)
      return {
        start: prefix.toString().length,
        end: suffix.toString().length
      }
    }

    let handleBeforeInput: (event: Event) => void = () => {}
    const detachInputListener = (): void => {
      if (!inputListenerAttached) return
      editor.removeEventListener('beforeinput', handleBeforeInput, true)
      inputListenerAttached = false
    }
    const discardPendingPayloads = (): void => {
      for (const sample of pending) sample.expectedText = undefined
      pending.length = 0
    }

    const observer = new MutationObserver(() => {
      if (pending.length === 0) return
      const observedAt = performance.now()
      const currentTargets = new Map<
        number,
        { element: Element, text: string, checkpoint: InputDomCheckpoint }
      >()
      let retained = 0

      for (let index = 0; index < pending.length; index += 1) {
        const sample = pending[index]
        let current = currentTargets.get(sample.targetIndex)
        if (!current) {
          let target = sample.observedElement
          if (!target.isConnected || !editor.contains(target)) {
            const reacquired = editor
              .querySelectorAll(targetSelector)
              .item(sample.targetIndex)
            if (reacquired) {
              target = reacquired
              sample.observedElement = reacquired
            }
          }
          if (target.isConnected && editor.contains(target)) {
            const text = target.textContent ?? ''
            current = {
              element: target,
              text,
              checkpoint: checkpointFor(sample.targetIndex, text)
            }
            currentTargets.set(sample.targetIndex, current)
          }
        }

        if (
          current !== undefined &&
          sample.expectedText !== undefined &&
          current.text === sample.expectedText
        ) {
          sample.tEcho = observedAt
          sample.echoDomCheckpoint = current.checkpoint
          sample.expectedText = undefined
        } else {
          pending[retained] = sample
          retained += 1
        }
      }
      pending.length = retained
      if (!accepting && pending.length === 0 && observerConnected) {
        observer.disconnect()
        observerConnected = false
      }
    })
    observer.observe(editor, {
      characterData: true,
      childList: true,
      subtree: true
    })

    const stopAccepting = (
      reason: NonNullable<InputLatencyTraceStatus['stopReason']>,
      drainPending: boolean
    ): void => {
      accepting = false
      stopReason ??= reason
      detachInputListener()
      if (!drainPending) discardPendingPayloads()
      if (pending.length === 0 && observerConnected) {
        observer.disconnect()
        observerConnected = false
      }
    }

    handleBeforeInput = (event: Event): void => {
      const inputEvent = event as InputEvent
      if (!(event.target instanceof Element)) return
      const selectionNode = window.getSelection()?.anchorNode
      const selectionElement = selectionNode instanceof Element
        ? selectionNode
        : selectionNode?.parentElement
      const observedElement =
        event.target.closest(targetSelector) ??
        selectionElement?.closest(targetSelector)
      if (!observedElement || !editor.contains(observedElement)) return
      if (inputEvent.inputType !== 'insertText' || inputEvent.data === null) {
        stopAccepting('unsupported-input', false)
        return
      }

      const targetIndex = targetIndexOf(observedElement)
      const offsets = selectionOffsets(observedElement)
      if (targetIndex < 0 || offsets === undefined) {
        stopAccepting('unsupported-input', false)
        return
      }
      const baseText = observedElement.textContent ?? ''
      const expectedText =
        baseText.slice(0, offsets.start) +
        inputEvent.data +
        baseText.slice(offsets.end)
      const expectedDomCheckpoint = checkpointFor(
        targetIndex,
        expectedText
      )

      // If several browser inputs arrive before MutationObserver runs, advance
      // only the still-pending checkpoints whose prior expected state is the
      // new event's actual base. The final cumulative state then conservatively
      // satisfies every linked prefix at the same observed time.
      for (const sample of pending) {
        if (
          sample.targetIndex === targetIndex &&
          sample.expectedText === baseText
        ) {
          sample.expectedText = expectedText
          sample.expectedDomCheckpoint = expectedDomCheckpoint
        }
      }

      const sample: MutableInputLatencySample = {
        sequence: samples.length + 1,
        data: inputEvent.data,
        inputType: inputEvent.inputType,
        tEvent: performance.now(),
        expectedDomCheckpoint,
        expectedText,
        observedElement,
        targetIndex
      }
      samples.push(sample)
      pending.push(sample)
      requestAnimationFrame(() => {
        sample.tFrame = performance.now()
      })

      if (samples.length >= capacity) {
        stopAccepting('capacity', true)
      }
    }

    editor.addEventListener('beforeinput', handleBeforeInput, true)
    tracedWindow.__marktextInputLatencyProbe = {
      samples,
      pending,
      get accepting() {
        return accepting
      },
      get stopReason() {
        return stopReason
      },
      disconnect: () => {
        detachInputListener()
        if (observerConnected) observer.disconnect()
        observerConnected = false
        discardPendingPayloads()
        delete tracedWindow.__marktextInputLatencyProbe
      },
      stop: () => stopAccepting('explicit', false)
    }
  }, maxSamples)
}

export const stopInputLatencyTrace = async(page: Page): Promise<void> => {
  await page.evaluate(() => {
    const probe = (window as TracedWindow).__marktextInputLatencyProbe
    if (!probe) throw new Error('Input latency trace is not running')
    probe.stop()
  })
}

export const waitForInputLatencyTrace = async(
  page: Page,
  sampleCount: number,
  timeout = 5000
): Promise<void> => {
  await page.waitForFunction(
    expectedCount => {
      const samples = (window as TracedWindow).__marktextInputLatencyProbe?.samples
      return samples !== undefined &&
        samples.length === expectedCount &&
        samples.every(sample =>
          sample.tEcho !== undefined && sample.tFrame !== undefined
        )
    },
    sampleCount,
    { timeout }
  )
}

export const readInputLatencyTrace = async(
  page: Page
): Promise<InputLatencySample[]> =>
  page.evaluate(() => {
    const samples = (window as TracedWindow).__marktextInputLatencyProbe?.samples
    if (samples === undefined) throw new Error('Input latency trace is not running')
    return samples.map(sample => ({
      sequence: sample.sequence,
      data: sample.data,
      inputType: sample.inputType,
      tEvent: sample.tEvent,
      tEcho: sample.tEcho,
      tFrame: sample.tFrame,
      expectedDomCheckpoint: sample.expectedDomCheckpoint,
      echoDomCheckpoint: sample.echoDomCheckpoint
    }))
  })

export const readInputLatencyTraceStatus = async(
  page: Page
): Promise<InputLatencyTraceStatus> =>
  page.evaluate(() => {
    const probe = (window as TracedWindow).__marktextInputLatencyProbe
    if (!probe) throw new Error('Input latency trace is not running')
    return {
      accepting: probe.accepting,
      pendingSamples: probe.pending.length,
      sampleCount: probe.samples.length,
      stopReason: probe.stopReason
    }
  })

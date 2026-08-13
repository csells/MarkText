import type { Page } from 'playwright'

export interface UpstreamBaselineInputObservation {
  readonly tEvent: number
  readonly tAcknowledged?: number
  readonly tStableFrame?: number
  readonly expectedTextHash: string
  readonly acknowledgedTextHash?: string
  readonly stableFrameTextHash?: string
}

export interface UpstreamBaselineInputTiming {
  readonly t_echo: number
  readonly t_frame: number
}

interface BrowserProbeSample extends UpstreamBaselineInputObservation {
  readonly expectedText: string
  readonly targetIndex: number
}

interface BrowserProbe {
  readonly samples: BrowserProbeSample[]
  readonly stopReason?: 'unsupported-input' | 'unstable-checkpoint'
  disconnect(): void
}

type ProbedWindow = Window & {
  __marktextUpstreamBaselineInputProbe?: BrowserProbe
}

const finiteTimestamp = (value: number | undefined, label: string): number => {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} is missing or invalid`)
  }
  return value
}

export const reportUpstreamBaselineInputObservation = (
  observation: UpstreamBaselineInputObservation
): UpstreamBaselineInputTiming => {
  const acknowledgedAt = finiteTimestamp(
    observation.tAcknowledged,
    'DOM acknowledgement timestamp'
  )
  const stableFrameAt = finiteTimestamp(
    observation.tStableFrame,
    'Stable rendered frame timestamp'
  )
  if (acknowledgedAt < observation.tEvent) {
    throw new Error('DOM acknowledgement precedes browser input dispatch')
  }
  if (stableFrameAt < acknowledgedAt) {
    throw new Error('Stable rendered frame precedes DOM acknowledgement')
  }
  if (observation.acknowledgedTextHash !== observation.expectedTextHash) {
    throw new Error('DOM acknowledgement does not match the expected checkpoint')
  }
  if (observation.stableFrameTextHash !== observation.expectedTextHash) {
    throw new Error('Stable frame does not retain the expected DOM checkpoint')
  }
  return Object.freeze({
    t_echo: acknowledgedAt - observation.tEvent,
    t_frame: stableFrameAt - observation.tEvent
  })
}

/**
 * Installs an external browser-boundary probe in the unmodified upstream
 * renderer. The probe observes Muya's DOM only; it neither imports Muya nor
 * reads Vue/Pinia state.
 */
export const startUpstreamBaselineInputProbe = async(
  page: Page
): Promise<void> => {
  await page.evaluate(() => {
    const probedWindow = window as ProbedWindow
    probedWindow.__marktextUpstreamBaselineInputProbe?.disconnect()
    const editor = document.querySelector('.editor-component')
    if (!(editor instanceof HTMLElement)) {
      throw new Error('Upstream Muya editor is unavailable')
    }
    const targetSelector = '.mu-paragraph-content'
    const samples: BrowserProbeSample[] = []
    let stopReason: BrowserProbe['stopReason']

    const hashText = (text: string): string => {
      let hash = 0x811c9dc5
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
      }
      return (hash >>> 0).toString(16).padStart(8, '0')
    }
    const targets = (): NodeListOf<Element> =>
      editor.querySelectorAll(targetSelector)
    const targetAt = (index: number): Element | undefined =>
      targets().item(index) ?? undefined
    const targetIndexOf = (target: Element): number => {
      const current = targets()
      for (let index = 0; index < current.length; index += 1) {
        if (current.item(index) === target) return index
      }
      return -1
    }
    const selectionOffsets = (
      target: Element
    ): { start: number, end: number } | undefined => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount !== 1) return undefined
      const selected = selection.getRangeAt(0)
      if (
        !target.contains(selected.startContainer) ||
        !target.contains(selected.endContainer)
      ) return undefined
      const start = document.createRange()
      start.selectNodeContents(target)
      start.setEnd(selected.startContainer, selected.startOffset)
      const end = document.createRange()
      end.selectNodeContents(target)
      end.setEnd(selected.endContainer, selected.endOffset)
      return { start: start.toString().length, end: end.toString().length }
    }

    const observer = new MutationObserver(() => {
      const sample = samples[0]
      if (sample === undefined || sample.tAcknowledged !== undefined) return
      const target = targetAt(sample.targetIndex)
      const text = target?.textContent ?? ''
      if (text !== sample.expectedText) return
      const acknowledgedHash = hashText(text)
      ;(sample as { tAcknowledged?: number }).tAcknowledged = performance.now()
      ;(sample as { acknowledgedTextHash?: string }).acknowledgedTextHash =
        acknowledgedHash
      requestAnimationFrame(() => {
        const stableTarget = targetAt(sample.targetIndex)
        const stableText = stableTarget?.textContent ?? ''
        if (stableText !== sample.expectedText) {
          stopReason = 'unstable-checkpoint'
          return
        }
        ;(sample as { tStableFrame?: number }).tStableFrame = performance.now()
        ;(sample as { stableFrameTextHash?: string }).stableFrameTextHash =
          hashText(stableText)
      })
    })
    observer.observe(editor, {
      characterData: true,
      childList: true,
      subtree: true
    })

    const handleBeforeInput = (event: Event): void => {
      if (samples.length !== 0) return
      const input = event as InputEvent
      const selectionNode = window.getSelection()?.anchorNode
      const selectionElement = selectionNode instanceof Element
        ? selectionNode
        : selectionNode?.parentElement
      const eventElement = event.target instanceof Element ? event.target : undefined
      const target = eventElement?.closest(targetSelector) ??
        selectionElement?.closest(targetSelector)
      if (
        !target ||
        !editor.contains(target) ||
        input.inputType !== 'insertText' ||
        input.data === null
      ) {
        stopReason = 'unsupported-input'
        return
      }
      const offsets = selectionOffsets(target)
      const targetIndex = targetIndexOf(target)
      if (offsets === undefined || targetIndex < 0) {
        stopReason = 'unsupported-input'
        return
      }
      const text = target.textContent ?? ''
      const expectedText = text.slice(0, offsets.start) +
        input.data + text.slice(offsets.end)
      samples.push({
        tEvent: performance.now(),
        expectedText,
        expectedTextHash: hashText(expectedText),
        targetIndex
      })
    }
    editor.addEventListener('beforeinput', handleBeforeInput, true)
    probedWindow.__marktextUpstreamBaselineInputProbe = {
      samples,
      get stopReason() {
        return stopReason
      },
      disconnect: () => {
        editor.removeEventListener('beforeinput', handleBeforeInput, true)
        observer.disconnect()
        delete probedWindow.__marktextUpstreamBaselineInputProbe
      }
    }
  })
}

export const waitForUpstreamBaselineInputProbe = async(
  page: Page,
  timeout = 30_000
): Promise<void> => {
  await page.waitForFunction(() => {
    const probe = (window as ProbedWindow).__marktextUpstreamBaselineInputProbe
    if (probe?.stopReason !== undefined) {
      throw new Error(`Upstream input probe stopped: ${probe.stopReason}`)
    }
    const sample = probe?.samples[0]
    return sample?.tAcknowledged !== undefined &&
      sample.tStableFrame !== undefined
  }, undefined, { timeout })
}

export const readUpstreamBaselineInputProbe = async(
  page: Page
): Promise<UpstreamBaselineInputTiming> => {
  const observation = await page.evaluate(() => {
    const probe = (window as ProbedWindow).__marktextUpstreamBaselineInputProbe
    const sample = probe?.samples[0]
    if (sample === undefined) throw new Error('Upstream input probe has no sample')
    return {
      tEvent: sample.tEvent,
      tAcknowledged: sample.tAcknowledged,
      tStableFrame: sample.tStableFrame,
      expectedTextHash: sample.expectedTextHash,
      acknowledgedTextHash: sample.acknowledgedTextHash,
      stableFrameTextHash: sample.stableFrameTextHash
    }
  })
  return reportUpstreamBaselineInputObservation(observation)
}

import type { Page } from 'playwright'
import { afterEach, expect, it, vi } from 'vitest'
import {
  readInputLatencyTrace,
  readInputLatencyTraceStatus,
  startInputLatencyTrace,
  stopInputLatencyTrace,
  type InputLatencySample
} from '../../e2e/helpers/inputLatencyTrace'

const page = {
  evaluate: async <R, A>(evaluate: (argument: A) => R, argument: A): Promise<R> =>
    evaluate(argument)
} as unknown as Page

const traceWindow = window as Window & {
  __marktextInputLatencyProbe?: {
    disconnect(): void
    readonly samples: readonly (InputLatencySample & {
      readonly observedElement?: Element
      readonly expectedText?: string
    })[]
  }
}

afterEach(() => {
  traceWindow.__marktextInputLatencyProbe?.disconnect()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function editorFixture(): { editor: HTMLElement; paragraph: HTMLElement } {
  const editor = document.createElement('div')
  editor.className = 'editor-component'
  const paragraph = document.createElement('span')
  paragraph.className = 'mu-paragraph-content'
  paragraph.textContent = 'seed'
  editor.append(paragraph)
  document.body.append(editor)
  document.getSelection()?.setPosition(paragraph.firstChild, 4)
  return { editor, paragraph }
}

it('observes input before an earlier registered synchronous editor owner replaces the paragraph', async() => {
  const { editor, paragraph } = editorFixture()
  let now = 10
  let dispatchedAt: number | undefined
  const frames: FrameRequestCallback[] = []
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  editor.addEventListener(
    'beforeinput',
    (event) => {
      now = 20
      dispatchedAt = performance.now()
      const replacement = document.createElement('span')
      replacement.className = 'mu-paragraph-content'
      replacement.textContent = 'seed!'
      paragraph.replaceWith(replacement)
      document.getSelection()?.setPosition(replacement.firstChild, 5)
      event.preventDefault()
      now = 30
    },
    true
  )
  await startInputLatencyTrace(page)
  paragraph.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: '!'
    })
  )
  await Promise.resolve()
  const samples = await readInputLatencyTrace(page)
  expect(samples).toHaveLength(1)
  const [echo] = samples
  const checkpoint = { targetIndex: 0, textLength: 5, textHash: 'eac7d1f7' }
  expect(echo.expectedDomCheckpoint).toEqual(checkpoint)
  expect(echo.tEvent).toBe(10)
  expect(dispatchedAt).toBe(20)
  expect(echo.tEvent).toBeLessThan(Number(dispatchedAt))
  expect(echo.tEcho).toBe(30)
  expect(echo.echoDomCheckpoint).toEqual(checkpoint)
  expect(echo.tFrame).toBeUndefined()
  expect(frames).toHaveLength(1)
  now = 40
  frames[0](now)
  expect(await readInputLatencyTrace(page)).toEqual([
    {
      sequence: 1,
      data: '!',
      inputType: 'insertText',
      tEvent: 10,
      tEcho: 30,
      tFrame: 40,
      expectedDomCheckpoint: checkpoint,
      echoDomCheckpoint: checkpoint,
      frameDomCheckpoint: checkpoint
    }
  ])
  expect(await readInputLatencyTraceStatus(page)).toMatchObject({
    pendingSamples: 0,
    sampleCount: 1
  })
  expect(traceWindow.__marktextInputLatencyProbe?.samples[0].observedElement).toBeUndefined()
})

it('ignores input outside the editor even when the document selection remains inside it', async() => {
  editorFixture()
  const outside = document.createElement('textarea')
  document.body.append(outside)
  await startInputLatencyTrace(page)
  for (const inputType of ['insertText', 'insertFromPaste']) {
    outside.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType,
        data: '!'
      })
    )
  }
  expect(await readInputLatencyTraceStatus(page)).toEqual({
    accepting: true,
    pendingSamples: 0,
    sampleCount: 0,
    stopReason: undefined
  })
})

it('disconnects the ancestor listener and pending DOM observation', async() => {
  const { paragraph } = editorFixture()
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  await startInputLatencyTrace(page)
  paragraph.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: '!'
    })
  )
  expect(await readInputLatencyTraceStatus(page)).toMatchObject({
    pendingSamples: 1,
    sampleCount: 1
  })
  const disconnected = traceWindow.__marktextInputLatencyProbe
  if (!disconnected) throw new Error('Missing input trace')
  disconnected.disconnect()
  paragraph.textContent = 'seed!'
  document.getSelection()?.setPosition(paragraph.firstChild, 5)
  paragraph.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: '?'
    })
  )
  await Promise.resolve()
  expect(disconnected.samples).toHaveLength(1)
  expect(disconnected.samples[0].observedElement).toBeUndefined()
  expect(disconnected.samples[0].expectedText).toBeUndefined()
  expect(frames).toEqual([])
  await expect(readInputLatencyTrace(page)).rejects.toThrow('Input latency trace is not running')
})

it.each(['explicit', 'unsupported-input', 'disconnect'] as const)(
  'releases a pending frame reference on %s without changing its recorded echo',
  async(reason) => {
    const { paragraph } = editorFixture()
    let now = 10
    const frames: FrameRequestCallback[] = []
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback)
    )
    await startInputLatencyTrace(page)
    paragraph.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: '!'
      })
    )
    now = 20
    paragraph.textContent = 'seed!'
    document.getSelection()?.setPosition(paragraph.firstChild, 5)
    await Promise.resolve()
    const probe = traceWindow.__marktextInputLatencyProbe
    if (!probe) throw new Error('Missing input trace')
    const [sample] = probe.samples
    const checkpoint = { targetIndex: 0, textLength: 5, textHash: 'eac7d1f7' }
    expect(sample.observedElement).toBe(paragraph)
    expect(sample.expectedText).toBe('seed!')
    expect(sample.tEcho).toBe(20)
    expect(frames).toHaveLength(1)
    if (reason === 'explicit') await stopInputLatencyTrace(page)
    else if (reason === 'disconnect') probe.disconnect()
    else {
      paragraph.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertFromPaste',
          data: null
        })
      )
    }
    now = 30
    frames[0](now)
    expect(sample.observedElement).toBeUndefined()
    expect(sample.expectedText).toBeUndefined()
    expect(sample.tEvent).toBe(10)
    expect(sample.tEcho).toBe(20)
    expect(sample.expectedDomCheckpoint).toEqual(checkpoint)
    expect(sample.echoDomCheckpoint).toEqual(checkpoint)
    expect(sample.tFrame).toBeUndefined()
    expect(sample.frameDomCheckpoint).toBeUndefined()
  }
)

it('retains a capacity-limited pending target until its exact frame completes', async() => {
  const { paragraph } = editorFixture()
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  await startInputLatencyTrace(page, { maxSamples: 1 })
  paragraph.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: '!'
    })
  )
  const probe = traceWindow.__marktextInputLatencyProbe
  if (!probe) throw new Error('Missing input trace')
  expect(probe.samples[0].observedElement).toBe(paragraph)
  expect(await readInputLatencyTraceStatus(page)).toMatchObject({
    accepting: false,
    pendingSamples: 1,
    sampleCount: 1,
    stopReason: 'capacity'
  })
  paragraph.textContent = 'seed!'
  await Promise.resolve()
  expect(probe.samples[0].observedElement).toBe(paragraph)
  expect(frames).toHaveLength(1)
  frames[0](performance.now())
  expect(probe.samples[0].observedElement).toBeUndefined()
  const [sample] = await readInputLatencyTrace(page)
  expect(sample.tFrame).toBeDefined()
  expect(sample.frameDomCheckpoint).toEqual(sample.expectedDomCheckpoint)
  expect(await readInputLatencyTraceStatus(page)).toMatchObject({ pendingSamples: 0 })
})

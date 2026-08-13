import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'

import {
  readInputLatencyTrace,
  readInputLatencyTraceStatus,
  startInputLatencyTrace,
  stopInputLatencyTrace,
  waitForInputLatencyTrace
} from './helpers/inputLatencyTrace'
import { launchWithMarkdown, placeCaretInEditor } from './helpers'

test.describe('upstream editor input-to-render-opportunity trace', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeEach(async() => {
    const launched = await launchWithMarkdown(
      'latency probe\n\nunrelated block'
    )
    app = launched.app
    page = launched.page
    await placeCaretInEditor(page)
    await startInputLatencyTrace(page)
  })

  test.afterEach(async() => {
    if (app) await app.close()
  })

  test('records one plain-text input from browser event through the next frame', async() => {
    await page.keyboard.type('x', { delay: 0 })
    await waitForInputLatencyTrace(page, 1)

    const [sample] = await readInputLatencyTrace(page)
    expect(sample).toBeDefined()
    expect(sample?.data).toBe('x')
    expect(sample?.inputType).toBe('insertText')
    expect(sample?.expectedDomCheckpoint).toBeDefined()
    expect(sample?.echoDomCheckpoint).toBeDefined()
    expect(sample?.tEvent).toBeLessThanOrEqual(sample?.tEcho ?? -1)
    expect(sample?.tEcho).toBeLessThanOrEqual(sample?.tFrame ?? -1)
    expect(sample?.echoDomCheckpoint).toEqual(
      sample?.expectedDomCheckpoint
    )
    expect(sample?.frameDomCheckpoint).toEqual(
      sample?.expectedDomCheckpoint
    )
  })

  test('preserves a zero-delay unique-token burst through the next frame', async() => {
    const token = 'q7v2m9z4k6'

    await page.keyboard.type(token, { delay: 0 })
    await waitForInputLatencyTrace(page, token.length)

    const samples = await readInputLatencyTrace(page)
    expect(samples.map(sample => sample.data).join('')).toBe(token)
    expect(samples.map(sample => sample.sequence)).toEqual(
      token.split('').map((_, index) => index + 1)
    )
    expect(samples).toHaveLength(token.length)
    for (const sample of samples) {
      expect(sample.expectedDomCheckpoint).toBeDefined()
      expect(sample.echoDomCheckpoint).toBeDefined()
      if (sample.tEcho === undefined || sample.tFrame === undefined) {
        throw new Error(`Input latency sample ${sample.sequence} is incomplete`)
      }
      expect(sample.tEvent).toBeLessThanOrEqual(sample.tEcho)
      expect(sample.tEcho).toBeLessThanOrEqual(sample.tFrame)
      expect(sample.echoDomCheckpoint).toEqual(
        sample.expectedDomCheckpoint
      )
      expect(sample.frameDomCheckpoint).toEqual(
        sample.expectedDomCheckpoint
      )
    }
  })

  test('requires the expected checkpoint after a prevented input', async() => {
    await page.evaluate(() => {
      const editor = document.querySelector('.editor-component')
      if (!editor) throw new Error('MarkText editor is unavailable')
      const target = editor.querySelector('.mu-paragraph-content')
      if (!target) throw new Error('Active paragraph is unavailable')
      target.textContent = ''
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(target)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    await startInputLatencyTrace(page)

    await page.evaluate(() => {
      const target = document.querySelector(
        '.editor-component .mu-paragraph-content'
      )
      if (!target) throw new Error('Active paragraph is unavailable')
      target.addEventListener('beforeinput', event => event.preventDefault(), {
        capture: true,
        once: true
      })
      const accepted = target.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'x',
        inputType: 'insertText'
      }))
      if (accepted) throw new Error('Synthetic input was not prevented')
    })

    await page.evaluate(async() => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const target = document.querySelector(
        '.editor-component .mu-paragraph-content'
      )
      if (!target) throw new Error('Active paragraph is unavailable')
      target.append(document.createElement('span'))
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    })

    const [pendingSample] = await readInputLatencyTrace(page)
    const status = await readInputLatencyTraceStatus(page)
    expect(pendingSample?.data, JSON.stringify(status)).toBe('x')
    expect(pendingSample?.tFrame).toBeUndefined()
    expect(pendingSample?.tEcho).toBeUndefined()
    expect(pendingSample?.echoDomCheckpoint).toBeUndefined()

    await page.evaluate(() => {
      const target = document.querySelector(
        '.editor-component .mu-paragraph-content'
      )
      if (!target) throw new Error('Active paragraph is unavailable')
      target.append('x')
    })
    await waitForInputLatencyTrace(page, 1)

    const [completedSample] = await readInputLatencyTrace(page)
    if (
      completedSample?.tEcho === undefined ||
      completedSample.tFrame === undefined
    ) {
      throw new Error('Expected a completed late input latency sample')
    }
    expect(completedSample.tEcho).toBeLessThanOrEqual(completedSample.tFrame)
    expect(completedSample.echoDomCheckpoint).toEqual(
      completedSample.expectedDomCheckpoint
    )
    expect(completedSample.frameDomCheckpoint).toEqual(
      completedSample.expectedDomCheckpoint
    )
    await stopInputLatencyTrace(page)
  })

  test('stops accepting samples at its configured bound', async() => {
    await startInputLatencyTrace(page, { maxSamples: 2 })

    await page.keyboard.type('xy', { delay: 0 })
    await waitForInputLatencyTrace(page, 2)
    await page.keyboard.type('z', { delay: 0 })

    const samples = await readInputLatencyTrace(page)
    expect(samples.map(sample => sample.data)).toEqual(['x', 'y'])
    expect(samples).toHaveLength(2)
    expect(await readInputLatencyTraceStatus(page)).toEqual({
      accepting: false,
      pendingSamples: 0,
      sampleCount: 2,
      stopReason: 'capacity'
    })
  })
})

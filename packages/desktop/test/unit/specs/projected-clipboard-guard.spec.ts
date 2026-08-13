import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it, vi } from 'vitest'

import {
  installProjectedSelectionClipboardGuard,
  installUnprovenSelectionClipboardGuard
} from '@/documentConsumers/projectedClipboardGuard'
import { createProjectedSelectionClipboardAuthority } from '@/documentConsumers/projectedSelectionClipboardAuthority'

const selection = Object.freeze({
  anchor: Object.freeze({ path: Object.freeze([0, 'text']), offset: 0 }),
  focus: Object.freeze({ path: Object.freeze([0, 'text']), offset: 3 })
})

const projected = () => {
  const core = createDocumentCore()
  return core.project(core.open('**new**'), 'revised')
}

describe('projected clipboard selection guard', () => {
  it('fails closed for native copy until a selection projection producer exists', () => {
    const target = new EventTarget()
    const observed = vi.fn()
    target.addEventListener('copy', observed)
    const uninstall = installUnprovenSelectionClipboardGuard(target)

    const guarded = new Event('copy', { bubbles: true, cancelable: true })
    expect(target.dispatchEvent(guarded)).toBe(false)
    expect(guarded.defaultPrevented).toBe(true)
    expect(observed).not.toHaveBeenCalled()

    const guardedCut = new Event('cut', { bubbles: true, cancelable: true })
    expect(target.dispatchEvent(guardedCut)).toBe(false)
    expect(guardedCut.defaultPrevented).toBe(true)

    uninstall()
    const legacy = new Event('copy', { bubbles: true, cancelable: true })
    expect(target.dispatchEvent(legacy)).toBe(true)
    expect(legacy.defaultPrevented).toBe(false)
    expect(observed).toHaveBeenCalledOnce()
  })

  it('writes a proven Cut projection before invoking its document mutation', () => {
    const target = new EventTarget()
    const clipboard = new Map<string, string>()
    const lifecycle: string[] = []
    const onCut = vi.fn(() => { lifecycle.push('cut') })
    const clipboardData = {
      setData: vi.fn((type: string, value: string) => {
        lifecycle.push(type)
        clipboard.set(type, value)
      })
    }
    const state: {
      payload?: Readonly<{ text: string; html: string }>
    } = {}
    const uninstall = installProjectedSelectionClipboardGuard(
      target,
      () => state.payload,
      onCut
    )
    const event = (type: 'copy' | 'cut'): Event => {
      const value = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(value, 'clipboardData', { value: clipboardData })
      return value
    }

    expect(target.dispatchEvent(event('copy'))).toBe(false)
    expect(clipboardData.setData).not.toHaveBeenCalled()
    expect(target.dispatchEvent(event('cut'))).toBe(false)
    expect(clipboardData.setData).not.toHaveBeenCalled()
    expect(onCut).not.toHaveBeenCalled()

    state.payload = { text: 'projected text', html: '<strong>projected</strong>' }
    expect(target.dispatchEvent(event('copy'))).toBe(false)
    expect(clipboard).toEqual(new Map([
      ['text/plain', 'projected text'],
      ['text/html', '<strong>projected</strong>']
    ]))

    clipboardData.setData.mockClear()
    lifecycle.length = 0
    expect(target.dispatchEvent(event('cut'))).toBe(false)
    expect(clipboardData.setData.mock.calls).toEqual([
      ['text/plain', 'projected text'],
      ['text/html', '<strong>projected</strong>']
    ])
    expect(onCut).toHaveBeenCalledOnce()
    expect(lifecycle).toEqual(['text/plain', 'text/html', 'cut'])
    uninstall()
  })

  it.each(['copy', 'cut'] as const)(
    'retries native %s once its pending Core selection projection is ready',
    async(operation) => {
      let releaseSettle: (() => void) | undefined
      const settle = new Promise<void>(resolve => { releaseSettle = resolve })
      const authority = createProjectedSelectionClipboardAuthority({
        settle: () => settle,
        selectionSourceRange: () => ({ start: 0, end: 3 }),
        selectionProjectionAtBarrier: async() => projected()
      })
      const target = new EventTarget()
      const clipboard = new Map<string, string>()
      const lifecycle: string[] = []
      const onCut = vi.fn(() => { lifecycle.push('cut') })
      const event = (type: 'copy' | 'cut'): Event => {
        const value = new Event(type, { bubbles: true, cancelable: true })
        Object.defineProperty(value, 'clipboardData', {
          value: {
            setData(type: string, text: string) {
              lifecycle.push(type)
              clipboard.set(type, text)
            }
          }
        })
        return value
      }
      const retried = vi.fn(async(type: 'copy' | 'cut') => {
        const payload = await authority.prepare(selection, 'rich')
        if (payload !== undefined) target.dispatchEvent(event(type))
      })
      const uninstall = installProjectedSelectionClipboardGuard(
        target,
        () => authority.payload(),
        onCut,
        retried
      )

      const initialPreparation = authority.prepare(selection, 'rich')
      expect(target.dispatchEvent(event(operation))).toBe(false)
      expect(clipboard).toEqual(new Map())
      expect(retried).toHaveBeenCalledOnce()
      expect(retried).toHaveBeenCalledWith(operation)
      expect(onCut).not.toHaveBeenCalled()

      releaseSettle?.()
      await initialPreparation
      await retried.mock.results[0]?.value
      expect(clipboard).toEqual(new Map([
        ['text/plain', '**new**'],
        ['text/html', '<p><strong>new</strong></p>\n']
      ]))
      expect(retried).toHaveBeenCalledOnce()
      expect(onCut).toHaveBeenCalledTimes(operation === 'cut' ? 1 : 0)
      expect(lifecycle).toEqual([
        'text/plain',
        'text/html',
        ...(operation === 'cut' ? ['cut'] : [])
      ])
      uninstall()
    }
  )

  it('does not reissue a pending Cut after its Core selection becomes stale', async() => {
    let releaseProjection: ((value: ReturnType<typeof projected>) => void) | undefined
    const projection = new Promise<ReturnType<typeof projected>>(resolve => {
      releaseProjection = resolve
    })
    const selectionProjectionAtBarrier = vi.fn(() => projection)
    const authority = createProjectedSelectionClipboardAuthority({
      settle: async() => {},
      selectionSourceRange: () => ({ start: 0, end: 3 }),
      selectionProjectionAtBarrier
    })
    const target = new EventTarget()
    const setData = vi.fn()
    const onCut = vi.fn()
    const event = (): Event => {
      const value = new Event('cut', { bubbles: true, cancelable: true })
      Object.defineProperty(value, 'clipboardData', { value: { setData } })
      return value
    }
    let reissues = 0
    const retry = vi.fn(async(_type: 'copy' | 'cut') => {
      const payload = await authority.prepare(selection, 'rich')
      if (payload !== undefined) {
        reissues += 1
        target.dispatchEvent(event())
      }
    })
    const uninstall = installProjectedSelectionClipboardGuard(
      target,
      () => authority.payload(),
      onCut,
      retry
    )

    expect(target.dispatchEvent(event())).toBe(false)
    await Promise.resolve()
    await Promise.resolve()
    expect(selectionProjectionAtBarrier).toHaveBeenCalledOnce()
    authority.reset()
    releaseProjection?.(projected())
    await retry.mock.results[0]?.value

    expect(reissues).toBe(0)
    expect(setData).not.toHaveBeenCalled()
    expect(onCut).not.toHaveBeenCalled()
    uninstall()
  })

  it('does not reissue Copy when the selection cannot map to Core source', async() => {
    const authority = createProjectedSelectionClipboardAuthority({
      settle: async() => {},
      selectionSourceRange: () => undefined,
      selectionProjectionAtBarrier: async() => projected()
    })
    const target = new EventTarget()
    const setData = vi.fn()
    const event = (): Event => {
      const value = new Event('copy', { bubbles: true, cancelable: true })
      Object.defineProperty(value, 'clipboardData', { value: { setData } })
      return value
    }
    let reissues = 0
    const retry = vi.fn(async(_type: 'copy' | 'cut') => {
      const payload = await authority.prepare(selection, 'rich')
      if (payload !== undefined) {
        reissues += 1
        target.dispatchEvent(event())
      }
    })
    const uninstall = installProjectedSelectionClipboardGuard(
      target,
      () => authority.payload(),
      undefined,
      retry
    )

    expect(target.dispatchEvent(event())).toBe(false)
    await retry.mock.results[0]?.value
    expect(reissues).toBe(0)
    expect(setData).not.toHaveBeenCalled()
    uninstall()
  })
})

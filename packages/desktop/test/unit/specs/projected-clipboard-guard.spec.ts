import { describe, expect, it, vi } from 'vitest'

import {
  installProjectedSelectionClipboardGuard,
  installUnprovenSelectionClipboardGuard
} from '@/documentConsumers/projectedClipboardGuard'

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
})

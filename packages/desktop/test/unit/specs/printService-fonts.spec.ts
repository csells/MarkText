import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  window.path ??= { sep: '/' } as typeof window.path
})

import MarkdownPrint from '@/services/printService'

describe('MarkdownPrint — font readiness before native printing', () => {
  const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
  let printer: MarkdownPrint | undefined

  afterEach(() => {
    printer?.clearup()
    if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
    else Reflect.deleteProperty(document, 'fonts')
  })

  it('loads the fonts and characters used by the hidden print content before resolving', async() => {
    let finishLoading!: () => void
    const pending = new Promise<void>((resolve) => {
      finishLoading = resolve
    })
    const load = vi.fn(() => pending)
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } })
    printer = new MarkdownPrint()
    let ready = false
    const rendering = Promise.resolve(
      printer.renderMarkdown(
        '<style>@font-face{font-family:Unused;src:url(unused.woff2)}</style>' +
          '<article style="display:none">' +
          '<span style="font:italic 20px MathFace">x</span>' +
          '<sup style="font:14px NumberFace">2</sup>' +
          '<span style="font:italic 20px MathFace">y</span>' +
          '</article>'
      )
    ).then(() => {
      ready = true
    })

    await Promise.resolve()
    expect(ready).toBe(false)
    expect(load.mock.calls).toEqual([
      [expect.stringContaining('MathFace'), 'xy'],
      [expect.stringContaining('NumberFace'), '2']
    ])
    finishLoading()
    await rendering
    expect(ready).toBe(true)
  })

  it('rejects font failures so the caller cannot print silently missing glyphs', async() => {
    const failure = new Error('Embedded font could not be loaded')
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: vi.fn().mockRejectedValue(failure) }
    })
    printer = new MarkdownPrint()
    await expect(
      Promise.resolve(printer.renderMarkdown('<span style="font:italic 20px MathFace">x</span>'))
    ).rejects.toBe(failure)
    expect(document.querySelector('.print-container')).toBeNull()
  })

  it('marks superseded readiness stale and keeps cleanup bound to its original container', async() => {
    let finishFirst!: () => void
    const firstFonts = new Promise<void>((resolve) => {
      finishFirst = resolve
    })
    const load = vi.fn().mockReturnValueOnce(firstFonts).mockResolvedValue([])
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } })
    printer = new MarkdownPrint()
    const firstRendering = printer.renderMarkdown('<span style="font:20px MathFace">first</span>')
    const second = await printer.renderMarkdown('<span style="font:20px MathFace">second</span>')
    finishFirst()
    const first = await firstRendering
    expect(first.isCurrent()).toBe(false)
    expect(second.isCurrent()).toBe(true)
    first.clearup()
    expect(document.querySelector('.print-container')?.textContent).toBe('second')
    expect(second.isCurrent()).toBe(true)
  })

  it('invalidates readiness when native cleanup runs while fonts are pending', async() => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: vi.fn(() => pending) }
    })
    printer = new MarkdownPrint()
    const rendering = printer.renderMarkdown('<span style="font:20px MathFace">x</span>')
    printer.clearup()
    finish()
    expect((await rendering).isCurrent()).toBe(false)
    expect(document.querySelector('.print-container')).toBeNull()
  })

  it('contains an obsolete font failure without removing or failing the newer print', async() => {
    let failFirst!: (error: Error) => void
    const firstFonts = new Promise<void>((_resolve, reject) => {
      failFirst = reject
    })
    const load = vi.fn().mockReturnValueOnce(firstFonts).mockResolvedValue([])
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } })
    printer = new MarkdownPrint()
    const firstRendering = printer.renderMarkdown('<span style="font:20px MathFace">first</span>')
    const second = await printer.renderMarkdown('<span style="font:20px MathFace">second</span>')
    failFirst(new Error('Obsolete font failed'))
    const first = await firstRendering
    expect(first.isCurrent()).toBe(false)
    first.clearup()
    expect(second.isCurrent()).toBe(true)
    expect(document.querySelector('.print-container')?.textContent).toBe('second')
  })
})

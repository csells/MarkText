import { describe, expect, it, vi } from 'vitest'
import { scrollSourceEditorToLine } from '@/util/sourceModeToc'

// marktext #3580 follow-up: clicking a TOC entry in Source Code mode must put
// the heading at the TOP of the viewport (not the bottom, as CodeMirror's
// minimal `scrollIntoView` did) and animate the scroll. Because CodeMirror runs
// with viewportMargin: Infinity (full-height render), the OUTER `.source-code`
// container is the scrollable element — that is what gets scrolled.
type SourceEditor = Parameters<typeof scrollSourceEditorToLine>[0]

describe('scrollSourceEditorToLine', () => {
  const makeEditor = () => {
    const setCursor = vi.fn()
    const heightAtLine = vi.fn(() => 480)
    const editor: SourceEditor = { setCursor, heightAtLine }
    return { editor, setCursor, heightAtLine }
  }

  it('smooth-scrolls the container so the line sits at the top', () => {
    const { editor, setCursor, heightAtLine } = makeEditor()
    const containerScrollTo = vi.fn()
    const container = { scrollTo: containerScrollTo } as unknown as HTMLElement

    scrollSourceEditorToLine(editor, 12, container)

    // line top resolved as a local Y coordinate
    expect(heightAtLine).toHaveBeenCalledWith(12, 'local')
    // the OUTER container is scrolled so that Y sits at the top, animated
    expect(containerScrollTo).toHaveBeenCalledWith({ top: 480, behavior: 'smooth' })
    // caret moved without its native scroll fighting the animation
    expect(setCursor).toHaveBeenCalledWith({ line: 12, ch: 0 }, undefined, { scroll: false })
  })

  it('still places the caret but does not throw when no container is given', () => {
    const { editor, setCursor, heightAtLine } = makeEditor()
    scrollSourceEditorToLine(editor, 5, null)
    expect(setCursor).toHaveBeenCalledWith({ line: 5, ch: 0 }, undefined, { scroll: false })
    expect(heightAtLine).not.toHaveBeenCalled()
  })
})

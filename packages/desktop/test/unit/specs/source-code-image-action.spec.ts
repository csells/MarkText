import { createPinia, setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest'

// Real-mount component spec per specs/architecture/test-infrastructure.md:
// sourceCode.vue is mounted with @vue/test-utils; behaviors are driven the way
// the app drives them (bus events, CodeMirror events routed through a mocked
// @/codeMirror boundary) and asserted on the buffer, stores, and IPC.

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      marktext?: { env: { windowId: number } }
      fileUtils?: { isSamePathSync: (a: string, b: string) => boolean }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.marktext ??= { env: { windowId: 1 } }
  w.window.fileUtils ??= { isSamePathSync: (a, b) => a === b }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {} }
  }
})

vi.mock('@/services/notification', () => ({ default: { notify: vi.fn(), name: 'notify' } }))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn(() => Promise.resolve(true))
}))
vi.mock(import('vue-i18n'), async(importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useI18n: (() => ({ t: (key: string) => key })) as unknown as typeof actual.useI18n
  }
})
// Package-boundary spy: everything stays real, the analyzer call count and
// arguments become observable (the analysis cache contract needs both).
vi.mock(import('@muyajs/core'), async(importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, analyzeMarkdownComments: vi.fn(actual.analyzeMarkdownComments) }
})

interface CMPosition {
  line: number
  ch: number
}

interface FakeCM {
  cursorState: { focus: CMPosition | null; anchor: CMPosition | null }
  fire: (event: string) => void
  getValue: () => string
  setValue: (value: string) => void
  getCursor: (which?: string) => CMPosition | null
  getLine: (line: number) => string
  firstLine: () => number
  lastLine: () => number
  lineCount: () => number
  indexFromPos: (pos: CMPosition) => number
  posFromIndex: (index: number) => CMPosition
  replaceRange: (replacement: string, from: CMPosition, to?: CMPosition) => void
  setSelection: Mock
  operation: (fn: () => void) => void
  on: (event: string, handler: (...args: unknown[]) => void) => void
  setOption: Mock
  focus: Mock
  execCommand: Mock
  hasFocus: () => boolean
  invalidateImageCache: Mock
  getScrollerElement: () => HTMLElement
  somethingSelected: () => boolean
}

const { codeMirrorMock, createdEditors, setCursorAtFirstLineMock, setTextDirectionMock } =
  vi.hoisted(() => {
    const createdEditors: FakeCM[] = []

    const makeFakeCM = (value: string): FakeCM => {
      let current = value
      const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
      const cursorState: FakeCM['cursorState'] = {
        focus: { line: 0, ch: 0 },
        anchor: { line: 0, ch: 0 }
      }
      const lines = () => current.split('\n')
      const indexFromPos = (pos: CMPosition) => {
        const allLines = lines()
        let index = 0
        for (let i = 0; i < pos.line; i++) {
          index += (allLines[i] ?? '').length + 1
        }
        return index + pos.ch
      }
      const posFromIndex = (index: number) => {
        const allLines = lines()
        let rest = index
        for (let line = 0; line < allLines.length; line++) {
          if (rest <= allLines[line].length) return { line, ch: rest }
          rest -= allLines[line].length + 1
        }
        return { line: allLines.length - 1, ch: allLines[allLines.length - 1].length }
      }
      const cm: FakeCM = {
        cursorState,
        fire: (event) => {
          for (const handler of handlers.get(event) ?? []) handler(cm)
        },
        getValue: () => current,
        setValue: (v) => {
          current = v
        },
        getCursor: (which) => (which === 'anchor' ? cursorState.anchor : cursorState.focus),
        getLine: (line) => lines()[line] ?? '',
        firstLine: () => 0,
        lastLine: () => lines().length - 1,
        lineCount: () => lines().length,
        indexFromPos,
        posFromIndex,
        replaceRange: (replacement, from, to = from) => {
          const start = indexFromPos(from)
          const end = indexFromPos(to)
          current = `${current.slice(0, start)}${replacement}${current.slice(end)}`
        },
        setSelection: vi.fn(),
        operation: (fn) => fn(),
        on: (event, handler) => {
          const list = handlers.get(event) ?? []
          list.push(handler)
          handlers.set(event, list)
        },
        setOption: vi.fn(),
        focus: vi.fn(),
        execCommand: vi.fn(),
        hasFocus: () => false,
        invalidateImageCache: vi.fn(),
        getScrollerElement: () => document.createElement('div'),
        somethingSelected: () => false
      }
      return cm
    }

    const codeMirrorMock = vi.fn((_container: HTMLElement, options: Record<string, unknown>) => {
      const cm = makeFakeCM(String(options.value ?? ''))
      createdEditors.push(cm)
      return cm
    })

    return {
      codeMirrorMock,
      createdEditors,
      setCursorAtFirstLineMock: vi.fn(),
      setTextDirectionMock: vi.fn()
    }
  })
vi.mock('@/codeMirror', () => ({
  default: codeMirrorMock,
  setCursorAtFirstLine: setCursorAtFirstLineMock,
  setTextDirection: setTextDirectionMock
}))

import { analyzeMarkdownComments, wordCount } from '@muyajs/core'
import bus from '@/bus'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { initCommentCommandRouter } from '@/review/commentCommandRouter'
import {
  createSourceCommentAnalysis,
  sourceCommentIndexRanges as sourceCommentIndexRangesFromAnalysis,
  type SourceCommentParserOptions
} from '@/components/editorWithTabs/sourceCommentController'
import SourceCode from '@/components/editorWithTabs/sourceCode.vue'

// The router is what the app uses to dispatch comment commands to the
// mounted overlay's surface; registering it here keeps that path real.
initCommentCommandRouter()

let wrapper: VueWrapper | null = null
let sendSpy: MockInstance

interface MountedSource {
  cm: FakeCM
  listenForContentChange: MockInstance
  updateComments: MockInstance
  updateActiveComments: MockInstance
}

const mountSource = (markdown: string): MountedSource => {
  const editorStore = useEditorStore()
  const preferencesStore = usePreferencesStore()
  preferencesStore.sourceCode = true
  editorStore.currentFile = { id: 'tab-1' } as never
  const listenForContentChange = vi
    .spyOn(editorStore, 'LISTEN_FOR_CONTENT_CHANGE')
    .mockImplementation(() => {})
  const updateComments = vi.spyOn(editorStore, 'UPDATE_COMMENTS').mockImplementation(() => {})
  const updateActiveComments = vi
    .spyOn(editorStore, 'UPDATE_ACTIVE_COMMENTS')
    .mockImplementation(() => {})
  wrapper = mount(SourceCode, {
    props: { markdown, muyaIndexCursor: null, textDirection: 'ltr' }
  })
  const cm = createdEditors[createdEditors.length - 1]
  // Mounting parks the cursor at the first line; tests assert on what the
  // action under test does afterwards.
  setCursorAtFirstLineMock.mockClear()
  sendSpy.mockClear()
  return { cm, listenForContentChange, updateComments, updateActiveComments }
}

describe('sourceCode (mounted)', () => {
  beforeEach(() => {
    wrapper?.unmount()
    wrapper = null
    setActivePinia(createPinia())
    createdEditors.length = 0
    setCursorAtFirstLineMock.mockClear()
    vi.mocked(analyzeMarkdownComments).mockClear()
    sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send').mockImplementation(() => {})
    sendSpy.mockClear()
  })

  it('rewrites ![id](old) to ![alt](result) on the matched line', () => {
    const { cm } = mountSource('![abc123](old.png) tail')
    bus.emit('image-action', { id: 'abc123', result: 'new.png', alt: 'cat' })
    expect(cm.getValue()).toBe('![cat](new.png) tail')
  })

  it('rewrites only the line carrying the id, leaving siblings intact', () => {
    const { cm } = mountSource('before\n![abc123](old.png)\nafter')
    bus.emit('image-action', { id: 'abc123', result: 'new.png', alt: 'cat' })
    expect(cm.getValue()).toBe('before\n![cat](new.png)\nafter')
  })

  it('shifts a cursor sitting after the image by the length delta', () => {
    // ![abc123](old.png) is 18 chars; ![cat](new.png) is 15 -> delta -3.
    const { cm } = mountSource('![abc123](old.png) tail')
    const focus = { line: 0, ch: 20 }
    const anchor = { line: 0, ch: 20 }
    cm.cursorState.focus = focus
    cm.cursorState.anchor = anchor
    bus.emit('image-action', { id: 'abc123', result: 'new.png', alt: 'cat' })
    expect(focus.ch).toBe(17)
    expect(anchor.ch).toBe(17)
    expect(cm.setSelection).toHaveBeenCalledWith(anchor, focus, { scroll: true })
  })

  it('clamps a cursor inside the old image to the end of the new image text', () => {
    // New image text length = alt(3) + result(7) + 5 = 15.
    const { cm } = mountSource('![abc123](old.png)')
    const focus = { line: 0, ch: 5 }
    const anchor = { line: 0, ch: 5 }
    cm.cursorState.focus = focus
    cm.cursorState.anchor = anchor
    bus.emit('image-action', { id: 'abc123', result: 'new.png', alt: 'cat' })
    expect(focus.ch).toBe(15)
    expect(anchor.ch).toBe(15)
  })

  it('leaves a cursor at or before the image start untouched', () => {
    const { cm } = mountSource('![abc123](old.png) tail')
    const focus = { line: 0, ch: 0 }
    const anchor = { line: 0, ch: 0 }
    cm.cursorState.focus = focus
    cm.cursorState.anchor = anchor
    bus.emit('image-action', { id: 'abc123', result: 'new.png', alt: 'cat' })
    expect(focus.ch).toBe(0)
    expect(anchor.ch).toBe(0)
  })

  it('only adjusts pointers that sit on the rewritten line', () => {
    const { cm } = mountSource('![abc123](old.png)\nplain text line')
    const focus = { line: 1, ch: 4 }
    const anchor = { line: 1, ch: 4 }
    cm.cursorState.focus = focus
    cm.cursorState.anchor = anchor
    bus.emit('image-action', { id: 'abc123', result: 'new.png', alt: 'cat' })
    // Image is on line 0; line-1 pointers are off the edited line, so untouched.
    expect(focus.ch).toBe(4)
    expect(anchor.ch).toBe(4)
  })

  it('does nothing when the id is absent from every line', () => {
    const { cm } = mountSource('no images here')
    cm.cursorState.focus = { line: 0, ch: 3 }
    cm.cursorState.anchor = { line: 0, ch: 3 }
    bus.emit('image-action', { id: 'zzz', result: 'r.png', alt: 'x' })
    expect(cm.getValue()).toBe('no images here')
    expect(cm.setSelection).not.toHaveBeenCalled()
    expect(setCursorAtFirstLineMock).not.toHaveBeenCalled()
  })

  it('early-returns on the structure-deleted branch (id present, no image markup)', () => {
    // The id still appears (indexOf > 0) but the ![..](..) was deleted, so the
    // broad image regex finds no match -> early return, no selection change.
    const { cm } = mountSource('see abc123 ref')
    cm.cursorState.focus = { line: 0, ch: 10 }
    cm.cursorState.anchor = { line: 0, ch: 10 }
    bus.emit('image-action', { id: 'abc123', result: 'r.png', alt: 'x' })
    expect(cm.getValue()).toBe('see abc123 ref')
    expect(cm.setSelection).not.toHaveBeenCalled()
    expect(setCursorAtFirstLineMock).not.toHaveBeenCalled()
  })

  it('skips an image whose id starts at column 0 (indexOf > 0 quirk)', () => {
    // findIndex uses `line.indexOf(id) > 0` (strict), so a line that begins
    // with the id renders no rewrite. Pinning the off-by-one rather than fixing.
    const { cm } = mountSource('abc123](old.png)')
    bus.emit('image-action', { id: 'abc123', result: 'new.png', alt: 'cat' })
    expect(cm.getValue()).toBe('abc123](old.png)')
  })

  it('falls back to setCursorAtFirstLine when a pointer is null after a rewrite', () => {
    const { cm } = mountSource('![abc123](old.png)')
    cm.cursorState.focus = { line: 0, ch: 5 }
    cm.cursorState.anchor = null
    bus.emit('image-action', { id: 'abc123', result: 'new.png', alt: 'cat' })
    expect(cm.getValue()).toBe('![cat](new.png)')
    expect(cm.setSelection).not.toHaveBeenCalled()
    expect(setCursorAtFirstLineMock).toHaveBeenCalledTimes(1)
    // Unmount commits the buffer through getMarkdownAndCursor, which walks
    // both cursors; give it back a real anchor first.
    cm.cursorState.anchor = { line: 0, ch: 0 }
  })

  it('flushes the current source buffer when external reload asks the active editor to commit', () => {
    const { cm, listenForContentChange, updateComments, updateActiveComments } =
      mountSource('latest source\n')
    cm.cursorState.focus = { line: 0, ch: 6 }
    cm.cursorState.anchor = { line: 0, ch: 6 }

    bus.emit('flush-active-editor')

    expect(updateComments).toHaveBeenCalled()
    expect(updateActiveComments).toHaveBeenCalled()
    expect(sendSpy).toHaveBeenCalledWith('mt::editor-add-comment-selection-changed', 1, false)
    expect(listenForContentChange).toHaveBeenCalledWith({
      id: 'tab-1',
      markdown: 'latest source\n',
      wordCount: wordCount('latest source\n'),
      muyaIndexCursor: {
        anchor: { line: 0, ch: 6 },
        focus: { line: 0, ch: 6 }
      }
    })
  })

  it('does not re-run full comment analysis for cursor-only source moves', () => {
    const { cm, updateComments, updateActiveComments } = mountSource(
      'A <!--MC:a-->reviewed<!--MC:~a--> line.\n'
    )
    cm.cursorState.focus = { line: 0, ch: 6 }
    cm.cursorState.anchor = { line: 0, ch: 6 }
    bus.emit('flush-active-editor')

    vi.useFakeTimers()
    try {
      cm.cursorState.focus = { line: 0, ch: 20 }
      cm.cursorState.anchor = { line: 0, ch: 20 }
      cm.fire('cursorActivity')
      vi.advanceTimersByTime(150)
      cm.cursorState.focus = { line: 0, ch: 21 }
      cm.cursorState.anchor = { line: 0, ch: 21 }
      cm.fire('cursorActivity')
      vi.advanceTimersByTime(150)
    } finally {
      vi.useRealTimers()
    }

    // The string-keyed analysis cache is what keeps cursor-only moves
    // cheap; the store writes receive the SAME cached object each time.
    expect(vi.mocked(analyzeMarkdownComments)).toHaveBeenCalledTimes(1)
    expect(updateComments).toHaveBeenCalledTimes(3)
    expect(new Set(updateComments.mock.calls.map((call) => call[0])).size).toBe(1)
    expect(updateActiveComments).toHaveBeenCalledTimes(3)
  })

  it('analyzes source comments with the current markdown parser preferences', () => {
    const preferences = usePreferencesStore()
    preferences.footnote = true
    preferences.isGitlabCompatibilityEnabled = false
    preferences.trimUnnecessaryCodeBlockEmptyLines = true
    const { cm } = mountSource('A <!--MC:a-->reviewed<!--MC:~a--> line.\n')
    cm.cursorState.focus = { line: 0, ch: 20 }
    cm.cursorState.anchor = { line: 0, ch: 20 }

    bus.emit('flush-active-editor')

    expect(vi.mocked(analyzeMarkdownComments)).toHaveBeenCalledWith(
      'A <!--MC:a-->reviewed<!--MC:~a--> line.\n',
      {
        footnote: true,
        math: true,
        isGitlabCompatibilityEnabled: false,
        trimUnnecessaryCodeBlockEmptyLines: true,
        frontMatter: true
      }
    )
  })

  it('keeps source-mode Add Comment disabled for whitespace-only selections', () => {
    const store = useEditorStore()
    const { cm } = mountSource('A   span\n')
    store.addCommentEnabled = true
    cm.cursorState.focus = { line: 0, ch: 4 }
    cm.cursorState.anchor = { line: 0, ch: 1 }

    cm.fire('cursorActivity')

    expect(store.addCommentEnabled).toBe(false)
    expect(sendSpy).toHaveBeenCalledWith('mt::editor-add-comment-selection-changed', 1, false)
  })

  it('keeps source-mode Add Comment disabled for task-list checkbox prefixes', () => {
    const store = useEditorStore()
    const { cm } = mountSource('- [ ] task\n')
    store.addCommentEnabled = true
    cm.cursorState.focus = { line: 0, ch: 10 }
    cm.cursorState.anchor = { line: 0, ch: 2 }

    cm.fire('cursorActivity')

    expect(store.addCommentEnabled).toBe(false)
    expect(sendSpy).toHaveBeenCalledWith('mt::editor-add-comment-selection-changed', 1, false)
  })

  it.each([
    {
      label: 'semicolon JSON frontmatter',
      markdown: ';;;\n{"review":"text"}\n;;;\n\nOutside\n',
      focus: { line: 1, ch: 12 },
      anchor: { line: 1, ch: 1 }
    },
    {
      label: 'brace JSON frontmatter',
      markdown: '{\n"review": "text"\n}\n\nOutside\n',
      focus: { line: 1, ch: 11 },
      anchor: { line: 1, ch: 1 }
    }
  ])('keeps source-mode Add Comment disabled inside $label', ({ markdown, focus, anchor }) => {
    const store = useEditorStore()
    const { cm } = mountSource(markdown)
    store.addCommentEnabled = true
    cm.cursorState.focus = focus
    cm.cursorState.anchor = anchor

    cm.fire('cursorActivity')

    expect(store.addCommentEnabled).toBe(false)
    expect(sendSpy).toHaveBeenCalledWith('mt::editor-add-comment-selection-changed', 1, false)
  })

  it('does not update metadata-looking definitions inside ignored source blocks', () => {
    const open = '{"version":2,"status":"open","authors":["Ada"],"createdAt":"2026-06-30T10:00:00.000Z"}'
    const markdown = [
      '---',
      `[MC:a]: ${open}`,
      '---',
      '',
      'A <!--MC:a-->reviewed<!--MC:~a--> line.',
      '',
      `[MC:a]: ${open}`,
      ''
    ].join('\n')
    const { cm } = mountSource(markdown)

    bus.emit('comment:edit', { id: 'a', patch: { status: 'resolved' } })

    const statuses = cm
      .getValue()
      .split('\n')
      .filter((line) => line.startsWith('[MC:a]: '))
      .map((line) => (line.includes('"status":"resolved"') ? 'resolved' : 'open'))
    expect(statuses).toEqual(['open', 'resolved'])
  })
})

describe('sourceCommentController index ranges', () => {
  const parserOptions: SourceCommentParserOptions = {
    footnote: false,
    math: true,
    isGitlabCompatibilityEnabled: false,
    trimUnnecessaryCodeBlockEmptyLines: false,
    frontMatter: true
  }

  it('scans line-start and standalone MC markers as source comment ranges', () => {
    const lineStart = '<!--MC:a-->alpha<!--MC:~a-->\n'
    const standalone = ['<!--MC:a-->', '', 'reviewed paragraph', '', '<!--MC:~a-->', ''].join('\n')

    expect(
      sourceCommentIndexRangesFromAnalysis(createSourceCommentAnalysis(lineStart, parserOptions))
    ).toEqual([
      {
        id: 'a',
        start: lineStart.indexOf('alpha'),
        end: lineStart.indexOf('<!--MC:~a-->')
      }
    ])
    const range = sourceCommentIndexRangesFromAnalysis(
      createSourceCommentAnalysis(standalone, parserOptions)
    )[0]
    expect(range?.id).toBe('a')
    expect(standalone.slice(range.start, range.end)).toContain('reviewed paragraph')
  })
})

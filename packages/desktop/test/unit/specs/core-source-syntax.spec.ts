// @vitest-environment jsdom
import codeMirror from '@/codeMirror'
import 'codemirror/mode/javascript/javascript'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCodeMirrorCoreAdapter } from '@/documentAuthority/codeMirrorCoreAdapter'
import { bindCodeMirrorSourceSyntax } from '@/documentAuthority/codeMirrorSourceSyntax'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
const rects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
beforeEach(() => {
  Object.defineProperties(Range.prototype, {
    getBoundingClientRect: { configurable: true, value: () => new DOMRect(0, 0, 10, 20) },
    getClientRects: { configurable: true, value: () => [new DOMRect(0, 0, 10, 20)] }
  })
})
afterEach(() => {
  for (const [name, descriptor] of [
    ['getBoundingClientRect', rect],
    ['getClientRects', rects]
  ] as const) {
    if (descriptor === undefined) Reflect.deleteProperty(Range.prototype, name)
    else Object.defineProperty(Range.prototype, name, descriptor)
  }
})

function fixture(source: string, failRead: () => boolean = () => false) {
  const host = document.body.appendChild(document.createElement('div'))
  const editor = codeMirror(host, { value: source, viewportMargin: Infinity })
  Object.defineProperty(editor.getScrollerElement(), 'clientHeight', {
    configurable: true,
    value: 500
  })
  Object.defineProperties(editor.getWrapperElement(), {
    clientWidth: { configurable: true, value: 800 },
    offsetWidth: { configurable: true, value: 800 }
  })
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  const manager = createCoreDocumentSessionManager({ createBinding: () => binding })
  manager.open({ documentId: 'source-syntax.md', source, lineEnding: '\r\n' })
  const lease = manager.lease('source-syntax.md')
  const adapter = createCodeMirrorCoreAdapter(editor.getDoc(), lease.binding, {
    canonicalSource: source,
    insertedLineEnding: '\r\n',
    nativeHistoryScope: 'source-syntax'
  })
  const errors: unknown[] = []
  const detach = bindCodeMirrorSourceSyntax({
    editor,
    adapter,
    read: (revision) => {
      if (failRead()) throw new Error('Source syntax unavailable')
      return lease.projectAcknowledgedSourceSyntax(revision)
    },
    observe: (refresh) => lease.binding.observe(refresh),
    onFailure: (error) => errors.push(error)
  })
  editor.setSize(800, 500)
  editor.refresh()
  return {
    editor,
    adapter,
    binding,
    lease,
    errors,
    painted: (selector: string) =>
      Array.from(host.querySelectorAll(selector))
        .map((node) => node.textContent)
        .join(''),
    dispose() {
      detach()
      adapter.dispose()
      manager.abort('source-syntax.md')
      host.remove()
    }
  }
}

describe('Source syntax through the existing CodeMirror presentation', () => {
  it.each([
    {
      source: '{++**new**++} {--old--}\r\n{>>*note* $x_y$<<}\r\n',
      selector: '.cm-critic-addition',
      text: '{++**new**++}'
    },
    {
      source: '{++**new**++} {--old--}\r\n{>>*note* $x_y$<<}\r\n',
      selector: '.cm-critic-comment .cm-em, .cm-critic-comment.cm-em',
      text: '*note*'
    },
    {
      source: '{>>{--**old**--}{++*new*++}<<}',
      selector: '.cm-critic-comment .cm-strong, .cm-critic-comment.cm-strong',
      text: '**old**'
    },
    { source: '$x_y$ vs plain\n', selector: '.cm-math-inline', text: '$x_y$' }
  ])('paints $selector using source-owned spans', ({ source, selector, text }) => {
    const app = fixture(source)
    try {
      app.editor.getTokenAt(
        { line: app.editor.lastLine(), ch: app.editor.getLine(app.editor.lastLine()).length },
        true
      )
      expect(app.painted(selector)).toContain(text)
      expect(app.editor.getOption('mode')).toBe(null)
      expect(app.errors).toEqual([])
    } finally {
      app.dispose()
    }
  })

  it('preserves the existing source math contract and keeps literal CM spellings unclassified', () => {
    const app = fixture(
      '$\\text{F}_\\text{A}$\r\n\r\n$$\r\n\\sum_{i=1}^{n} a_i\r\n$$\r\n\r\n`{++**literal**++}`\r\n'
    )
    try {
      expect(app.painted('.cm-em')).toBe('')
      expect(app.painted('.cm-math-inline')).toContain('$\\text{F}_\\text{A}$')
      expect(app.painted('.cm-math-block')).toContain('sum_')
      expect(app.painted('.cm-critic-addition')).toBe('')
      expect(app.painted('.cm-strong')).toBe('')
      expect(app.errors).toEqual([])
    } finally {
      app.dispose()
    }
  })

  it('refreshes exact CRLF source positions through typing, one undo/redo and preference changes', async() => {
    const source = '# Heading\r\n\r\n{x}\r\n'
    const app = fixture(source)
    try {
      app.editor.replaceRange('{++**new**++}', { line: 2, ch: 0 }, { line: 2, ch: 3 }, '+input')
      await app.adapter.settled()
      await vi.waitFor(() => expect(app.painted('.cm-strong')).toBe('**new**'))
      expect(app.binding.sourceAtBarrier()).toMatchObject({
        source: '# Heading\r\n\r\n{++**new**++}\r\n'
      })
      await app.adapter.history('undo')
      await vi.waitFor(() => expect(app.painted('.cm-strong')).toBe(''))
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo')
      await vi.waitFor(() => expect(app.painted('.cm-strong')).toBe('**new**'))
      app.editor.replaceRange('$x_y$', { line: 2, ch: 0 }, { line: 2, ch: 13 }, '+input')
      await app.adapter.settled()
      await vi.waitFor(() => expect(app.painted('.cm-math-inline')).toBe('$x_y$'))
      await app.adapter.configure({ math: false })
      await vi.waitFor(() => expect(app.painted('.cm-math-inline')).toBe(''))
      expect(app.errors).toEqual([])
    } finally {
      app.dispose()
    }
  })

  it.each([
    { source: '$\\frac{x}{y}$\r\n', selector: '.cm-tag', text: '\\frac' },
    {
      source: '```javascript\r\nconst value = 42;\r\n```\r\n',
      selector: '.cm-keyword',
      text: 'const'
    }
  ])(
    'retains existing embedded-language coloring inside model-owned literal bodies',
    ({ source, selector, text }) => {
      const app = fixture(source)
      try {
        expect(app.painted(selector)).toContain(text)
        expect(app.painted('.cm-keyword.cm-comment')).toBe('')
        expect(app.painted('.cm-em')).toBe('')
        expect(app.errors).toEqual([])
      } finally {
        app.dispose()
      }
    }
  )

  it('gates syntax reads by lease ownership and exact revision without touching source/history', async() => {
    const app = fixture('**source**\r\n')
    try {
      const original = app.binding.sourceAtBarrier()
      expect(() => app.lease.binding.sourceSyntaxAtBarrier()).toThrow('cannot bypass')
      expect(() => app.lease.projectAcknowledgedSourceSyntax(0)).toThrow('revision is invalid')
      expect(() => app.lease.projectAcknowledgedSourceSyntax(2)).toThrow('revision changed')
      expect(
        app.lease.projectAcknowledgedSourceSyntax(1).spans.some((span) => span.kind === 'strong')
      ).toBe(true)
      expect(app.binding.sourceAtBarrier()).toMatchObject({
        source: '**source**\r\n',
        revision: 1,
        recoveryHistory: { undo: [], redo: [] }
      })
      expect(original).toMatchObject({ source: '**source**\r\n' })
      app.editor.replaceRange('new', { line: 0, ch: 2 }, { line: 0, ch: 8 }, '+input')
      await app.adapter.settled()
      expect(() => app.lease.projectAcknowledgedSourceSyntax(1)).toThrow('revision changed')
    } finally {
      app.dispose()
    }
    expect(() => app.lease.projectAcknowledgedSourceSyntax(2)).toThrow('lease is released')
  })

  it.each([false, true])(
    'surfaces failed syntax reads without changing source, selection or history (initial: %s)',
    async(initial) => {
      let unavailable = initial
      const app = fixture('**old**\r\n', () => unavailable)
      try {
        if (!initial) {
          unavailable = true
          app.editor.replaceRange('new', { line: 0, ch: 2 }, { line: 0, ch: 5 }, '+input')
          await app.adapter.settled()
        }
        await vi.waitFor(() => expect(app.errors).toHaveLength(1))
        expect(app.errors[0]).toMatchObject({ message: 'Source syntax unavailable' })
        expect(app.painted('.cm-strong')).toBe('')
        expect(app.binding.sourceAtBarrier()).toMatchObject({
          source: initial ? '**old**\r\n' : '**new**\r\n'
        })
        expect(app.editor.getValue()).toBe(initial ? '**old**\n' : '**new**\n')
        if (!initial) {
          unavailable = false
          await app.adapter.history('undo')
          await vi.waitFor(() => expect(app.painted('.cm-strong')).toBe('**old**'))
        }
      } finally {
        app.dispose()
      }
    }
  )

  it('does not publish stale accepted syntax over a native composition draft', async() => {
    const source = '**old**\r\n'
    const app = fixture(source)
    try {
      app.adapter.compositionStart()
      app.editor.replaceRange('draft', { line: 0, ch: 0 }, { line: 0, ch: 7 }, '+input')
      expect(app.painted('.cm-strong')).toBe('')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      app.editor.replaceRange('*new*', { line: 0, ch: 0 }, { line: 0, ch: 5 }, '+input')
      await app.adapter.compositionEnd()
      await vi.waitFor(() => expect(app.painted('.cm-em')).toBe('*new*'))
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '*new*\r\n' })
      await app.adapter.history('undo')
      await vi.waitFor(() => expect(app.painted('.cm-strong')).toBe('**old**'))
      expect(app.errors).toEqual([])
    } finally {
      app.dispose()
    }
  })
})

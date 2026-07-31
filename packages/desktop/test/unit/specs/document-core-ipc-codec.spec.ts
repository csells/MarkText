import { describe, expect, it } from 'vitest'
import type { NodeId } from '@marktext/document-core'
import type {
  DocumentCoreCancelDispatchRequest,
  DocumentCoreClipboardWriteRequest,
  DocumentCoreCompleteDispatchRequest,
  DocumentCoreMainDispatchRequest,
  DocumentCoreMainSelectRequest,
  DocumentCoreOpenLinkRequest,
  DocumentCoreReconfigureMarkdownOptionsRequest,
  DocumentCoreStaticSinkRequest
} from '@shared/types/documentCore'
import {
  decodeDocumentCoreCancelDispatchRequest,
  decodeDocumentCoreClipboardWriteRequest,
  decodeDocumentCoreCompleteDispatchRequest,
  decodeDocumentCoreMainDispatchRequest,
  decodeDocumentCoreMainSelectRequest,
  decodeDocumentCoreOpenLinkRequest,
  decodeDocumentCoreReconfigureMarkdownOptionsRequest,
  decodeDocumentCoreStaticSinkRequest
} from 'main_renderer/ipc/documentCoreRuntimeCodec'

const position = (offset: number) => Object.freeze({
  offset,
  affinity: 'next' as const
})

const initialSelection = Object.freeze({
  anchor: position(1),
  focus: position(2)
})

const markupSelection = Object.freeze({
  session: 'session:1',
  revision: 'revision:1',
  view: 'markup' as const,
  anchor: position(1),
  focus: position(2)
})

const sourceSelection = Object.freeze({
  session: 'session:1',
  revision: 'revision:1',
  view: 'source' as const,
  anchor: position(1),
  focus: position(2)
})

const exportOptions = Object.freeze({
  title: 'Review',
  page: Object.freeze({
    size: Object.freeze({
      kind: 'custom' as const,
      widthMm: 210,
      heightMm: 297
    }),
    landscape: true,
    marginsMm: Object.freeze({
      top: 20,
      right: 15,
      bottom: 20,
      left: 15
    })
  }),
  theme: Object.freeze({
    kind: 'custom' as const,
    name: 'research.css'
  }),
  typography: Object.freeze({
    fontFamily: 'Source Serif',
    fontSizePx: 14,
    lineHeight: 1.5
  }),
  autoNumberHeadings: true,
  showFrontMatter: false,
  toc: Object.freeze({
    title: 'Contents',
    includeTopHeading: true
  }),
  header: Object.freeze({
    layout: 'single' as const,
    left: '',
    center: 'Review',
    right: ''
  }),
  footer: null,
  headerFooterAppearance: Object.freeze({
    drawRules: true,
    fontSizePx: 10
  })
})

const requestCases: readonly Readonly<{
  label: string
  value: object
  decode: (value: unknown) => object
}>[] = Object.freeze([
  {
    label: 'dispatch complete',
    value: {
      documentId: 'document:1',
      ticketId: 'dispatch:1'
    } satisfies DocumentCoreCompleteDispatchRequest,
    decode: decodeDocumentCoreCompleteDispatchRequest
  },
  {
    label: 'dispatch cancel',
    value: {
      documentId: 'document:1',
      ticketId: 'dispatch:1'
    } satisfies DocumentCoreCancelDispatchRequest,
    decode: decodeDocumentCoreCancelDispatchRequest
  },
  {
    label: 'select',
    value: {
      documentId: 'document:1',
      baseSnapshotId: 'snapshot:1',
      view: 'markup',
      selection: initialSelection
    } satisfies DocumentCoreMainSelectRequest,
    decode: decodeDocumentCoreMainSelectRequest
  },
  {
    label: 'reconfigure',
    value: {
      documentId: 'document:1',
      baseSnapshotId: 'snapshot:1',
      patch: {
        footnotes: true,
        gitLabMath: false
      }
    } satisfies DocumentCoreReconfigureMarkdownOptionsRequest,
    decode: decodeDocumentCoreReconfigureMarkdownOptionsRequest
  },
  {
    label: 'clipboard',
    value: {
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'markup',
      consumer: 'copy-rich',
      selection: { start: 0, end: 4 }
    } satisfies DocumentCoreClipboardWriteRequest,
    decode: decodeDocumentCoreClipboardWriteRequest
  },
  {
    label: 'open parser-owned link',
    value: {
      documentId: 'document:1',
      revisionId: 'revision:1',
      targetNodeId: 'p1:link:1' as NodeId
    } satisfies DocumentCoreOpenLinkRequest,
    decode: decodeDocumentCoreOpenLinkRequest
  },
  {
    label: 'styled HTML',
    value: {
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'revised',
      consumer: 'styled-html',
      suggestedName: 'Review',
      options: exportOptions
    } satisfies DocumentCoreStaticSinkRequest,
    decode: decodeDocumentCoreStaticSinkRequest
  },
  {
    label: 'PDF',
    value: {
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'markup',
      consumer: 'pdf',
      suggestedName: 'Review',
      options: exportOptions
    } satisfies DocumentCoreStaticSinkRequest,
    decode: decodeDocumentCoreStaticSinkRequest
  },
  {
    label: 'print',
    value: {
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'original',
      consumer: 'print',
      options: exportOptions
    } satisfies DocumentCoreStaticSinkRequest,
    decode: decodeDocumentCoreStaticSinkRequest
  }
])

const intentCases = Object.freeze([
  { kind: 'insert-text', target: markupSelection, text: 'x' },
  { kind: 'delete-text', target: markupSelection },
  { kind: 'replace-text', target: markupSelection, text: 'x' },
  {
    kind: 'replace-current-matches',
    target: markupSelection,
    query: {
      schema: 'document-search-query-1',
      text: 'old',
      syntax: 'regexp',
      caseSensitive: true,
      wholeWord: false
    },
    replacement: 'new'
  },
  { kind: 'format-text', target: markupSelection, format: 'strong' },
  {
    kind: 'replace-structure',
    target: markupSelection,
    replacement: '# heading'
  },
  {
    kind: 'convert-block',
    target: markupSelection,
    conversion: { kind: 'heading', level: 2 }
  },
  {
    kind: 'quick-insert-block',
    target: markupSelection,
    block: {
      kind: 'conversion',
      conversion: { kind: 'heading', level: 1 }
    }
  },
  {
    kind: 'quick-insert-block',
    target: markupSelection,
    block: { kind: 'diagram', language: 'mermaid' }
  },
  {
    kind: 'quick-insert-block',
    target: markupSelection,
    block: { kind: 'table', rows: 1, columns: 1 }
  },
  { kind: 'duplicate-block', target: markupSelection },
  { kind: 'delete-block', target: markupSelection },
  {
    kind: 'insert-paragraph',
    target: markupSelection,
    location: 'after'
  },
  { kind: 'insert-paragraph-break', target: markupSelection },
  { kind: 'insert-line-break', target: markupSelection },
  {
    kind: 'set-list-indentation',
    target: markupSelection,
    direction: 'increase'
  },
  {
    kind: 'set-task-checked',
    target: markupSelection,
    checked: true,
    cascade: true
  },
  {
    kind: 'set-code-language',
    target: markupSelection,
    language: 'typescript'
  },
  {
    kind: 'insert-link',
    target: markupSelection,
    href: 'https://example.test',
    title: 'example'
  },
  {
    kind: 'insert-image',
    target: markupSelection,
    src: 'image.png',
    alt: 'image',
    title: 'title'
  },
  {
    kind: 'insert-image',
    target: sourceSelection,
    src: 'source-image.png',
    alt: 'source image'
  },
  {
    kind: 'insert-footnote',
    target: markupSelection,
    label: 'note',
    content: 'text'
  },
  { kind: 'create-table', target: markupSelection, rows: 2, columns: 3 },
  {
    kind: 'insert-table-row',
    target: markupSelection,
    location: 'before'
  },
  { kind: 'remove-table-row', target: markupSelection },
  {
    kind: 'insert-table-column',
    target: markupSelection,
    location: 'right'
  },
  { kind: 'remove-table-column', target: markupSelection },
  {
    kind: 'align-table-column',
    target: markupSelection,
    alignment: 'center'
  },
  { kind: 'move-table-row', target: markupSelection, direction: 'down' },
  { kind: 'move-table-column', target: markupSelection, direction: 'left' },
  { kind: 'delete-table-cell-contents', target: markupSelection },
  {
    kind: 'paste-text',
    target: markupSelection,
    payload: { kind: 'external-text', text: 'paste' }
  },
  { kind: 'commit-composition', target: markupSelection, text: '入力' },
  {
    kind: 'author-critic-markup',
    target: markupSelection,
    input: { kind: 'substitution', replacement: 'new' }
  },
  {
    kind: 'edit-source',
    target: sourceSelection,
    text: '{++exact++}\r\n',
    selection: {
      anchor: position(14),
      focus: position(14)
    }
  },
  { kind: 'set-track-changes', enabled: true },
  { kind: 'set-projection', projection: 'revised' },
  {
    kind: 'resolve-change',
    target: 'node:1',
    decision: 'accept'
  },
  { kind: 'resolve-all-changes', decision: 'reject' },
  { kind: 'remove-highlight', target: 'node:1' },
  {
    kind: 'add-comment',
    range: { start: 1, end: 2 },
    comment: 'note'
  },
  { kind: 'edit-comment', target: 'node:1', comment: 'note' },
  { kind: 'remove-comment', target: 'node:1' },
  { kind: 'undo' },
  { kind: 'redo' }
])

describe('document-core main IPC runtime codec', () => {
  it('rejects block conversions that are not Quick Insert choices', () => {
    for (const conversion of [
      { kind: 'heading-shift', direction: 'promote' },
      { kind: 'loose-list-item' }
    ]) {
      expect(() => decodeDocumentCoreMainDispatchRequest({
        documentId: 'document:1',
        baseSnapshotId: 'snapshot:1',
        intent: {
          kind: 'quick-insert-block',
          target: markupSelection,
          block: { kind: 'conversion', conversion }
        }
      })).toThrow(/Quick Insert conversion/)
    }
  })

  it.each(requestCases)('decodes and deeply freezes a valid $label request', ({ value, decode }) => {
    const decoded = decode(structuredClone(value))
    expect(decoded).toEqual(value)
    expect(Object.isFrozen(decoded)).toBe(true)
  })

  it.each(requestCases)('rejects an extra top-level field on $label before use', ({ value, decode }) => {
    expect(() => decode({ ...structuredClone(value), injected: true }))
      .toThrow(/fields|unknown|closed/i)
  })

  it.each(intentCases)('decodes the closed $kind intent', (intent) => {
    const value = {
      documentId: 'document:1',
      baseSnapshotId: 'snapshot:1',
      intent
    } as DocumentCoreMainDispatchRequest
    const decoded = decodeDocumentCoreMainDispatchRequest(structuredClone(value))
    expect(decoded).toEqual(value)
    expect(Object.isFrozen(decoded.intent)).toBe(true)
  })

  it('rejects near-miss discriminators and invalid nested values', () => {
    expect(() => decodeDocumentCoreMainDispatchRequest({
      documentId: 'document:1',
      baseSnapshotId: 'snapshot:1',
      intent: { kind: 'undo-now' }
    })).toThrow(/intent|kind/i)
    expect(() => decodeDocumentCoreMainDispatchRequest({
      documentId: 'document:1',
      baseSnapshotId: 'snapshot:1',
      intent: {
        kind: 'set-task-checked',
        target: markupSelection,
        checked: 'yes',
        cascade: true
      }
    })).toThrow(/checked|boolean/i)
    expect(() => decodeDocumentCoreMainDispatchRequest({
      documentId: 'document:1',
      baseSnapshotId: 'snapshot:1',
      intent: {
        kind: 'reload-source-from-file',
        source: 'renderer-forged whole document'
      }
    })).toThrow(/intent|kind/i)
    expect(() => decodeDocumentCoreMainDispatchRequest({
      documentId: 'document:1',
      baseSnapshotId: 'snapshot:1',
      intent: {
        kind: 'insert-text',
        target: {
          ...markupSelection,
          anchor: { offset: -1, affinity: 'next' }
        },
        text: 'x'
      }
    })).toThrow(/offset|selection/i)
    expect(() => decodeDocumentCoreMainDispatchRequest({
      documentId: 'document:1',
      baseSnapshotId: 'snapshot:1',
      intent: {
        kind: 'replace-current-matches',
        target: markupSelection,
        query: {
          schema: 'document-search-query-1',
          text: 'old',
          syntax: 'literal',
          caseSensitive: false,
          wholeWord: false
        },
        replacement: 'new',
        matches: [{ start: 0, end: 3 }]
      }
    })).toThrow(/fields|unknown|closed/i)
    expect(() => decodeDocumentCoreMainDispatchRequest({
      documentId: 'document:1',
      baseSnapshotId: 'snapshot:1',
      intent: {
        kind: 'replace-current-matches',
        target: markupSelection,
        query: {
          schema: 'document-search-query-1',
          text: '(',
          syntax: 'regexp',
          caseSensitive: false,
          wholeWord: false
        },
        replacement: 'new'
      }
    })).toThrow(/invalid regular expression/i)
    expect(() => decodeDocumentCoreMainDispatchRequest({
      documentId: 'document:1',
      baseSnapshotId: 'snapshot:1',
      intent: {
        kind: 'replace-current-matches',
        target: markupSelection,
        query: {
          schema: 'document-search-query-1',
          text: 'a*',
          syntax: 'regexp',
          caseSensitive: false,
          wholeWord: false
        },
        replacement: 'new'
      }
    })).toThrow(/matches empty text/i)
    expect(() => decodeDocumentCoreReconfigureMarkdownOptionsRequest({
      documentId: 'document:1',
      baseSnapshotId: 'snapshot:1',
      patch: { footnotes: 'yes' }
    })).toThrow(/footnotes|boolean/i)
    expect(() => decodeDocumentCoreStaticSinkRequest({
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'markup',
      consumer: 'pdf-ish',
      suggestedName: 'Review',
      options: exportOptions
    })).toThrow(/consumer/i)
    expect(() => decodeDocumentCoreClipboardWriteRequest({
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'markup',
      consumer: 'copy-rich-and-run',
      selection: { start: 0, end: 1 }
    })).toThrow(/consumer/i)
  })

  it('rejects unsafe identifiers and non-finite semantic page dimensions', () => {
    expect(() => decodeDocumentCoreStaticSinkRequest({
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'markup',
      consumer: 'pdf',
      suggestedName: 'Review',
      options: {
        ...exportOptions,
        page: {
          ...exportOptions.page,
          size: {
            kind: 'custom',
            widthMm: Number.POSITIVE_INFINITY,
            heightMm: 10
          }
        }
      }
    })).toThrow(/page size|widthMm|finite/i)
  })

  it('keeps export options deeply closed and denies renderer styling authority', () => {
    const base = {
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'markup',
      consumer: 'pdf',
      suggestedName: 'Review',
      options: exportOptions
    }
    const decoded = decodeDocumentCoreStaticSinkRequest(base)
    expect(Object.isFrozen(decoded.options)).toBe(true)
    expect(Object.isFrozen(decoded.options.page)).toBe(true)
    expect(Object.isFrozen(decoded.options.page.size)).toBe(true)
    expect(Object.isFrozen(decoded.options.page.marginsMm)).toBe(true)
    expect(Object.isFrozen(decoded.options.theme)).toBe(true)
    expect(Object.isFrozen(decoded.options.typography)).toBe(true)
    expect(Object.isFrozen(decoded.options.toc)).toBe(true)
    expect(Object.isFrozen(decoded.options.header)).toBe(true)
    expect(Object.isFrozen(decoded.options.headerFooterAppearance)).toBe(true)

    expect(() => decodeDocumentCoreStaticSinkRequest({
      ...base,
      html: '<script>rendererAuthority()</script>'
    })).toThrow(/html|unknown|closed|fields/i)
    expect(() => decodeDocumentCoreStaticSinkRequest({
      ...base,
      pageOptions: { landscape: false }
    })).toThrow(/pageOptions|unknown|closed|fields/i)
    expect(() => decodeDocumentCoreStaticSinkRequest({
      ...base,
      options: {
        ...exportOptions,
        injectedCss: 'body{display:none}'
      }
    })).toThrow(/options|closed|fields/i)
    expect(() => decodeDocumentCoreStaticSinkRequest({
      ...base,
      options: {
        ...exportOptions,
        theme: {
          kind: 'custom',
          name: 'research.css',
          css: 'body{display:none}'
        }
      }
    })).toThrow(/theme|closed|fields/i)
    expect(() => decodeDocumentCoreStaticSinkRequest({
      ...base,
      options: {
        ...exportOptions,
        theme: {
          kind: 'custom',
          name: '/tmp/research.css'
        }
      }
    })).toThrow(/theme|filename|safe/i)
  })

  it('rejects clipboard and static requests that do not name one immutable revision', () => {
    expect(() => decodeDocumentCoreClipboardWriteRequest({
      documentId: 'document:1',
      view: 'markup',
      consumer: 'copy-rich',
      selection: { start: 0, end: 4 }
    })).toThrow(/revision|missing|fields/i)
    expect(() => decodeDocumentCoreStaticSinkRequest({
      documentId: 'document:1',
      view: 'revised',
      consumer: 'styled-html',
      suggestedName: 'Review'
    })).toThrow(/revision|missing|fields/i)
  })

  it('accepts only a safe filename hint for main-owned file dialogs', () => {
    const base = {
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'revised',
      consumer: 'styled-html',
      options: exportOptions
    }
    expect(() => decodeDocumentCoreStaticSinkRequest(base))
      .toThrow(/suggestedName|missing|fields/i)
    expect(() => decodeDocumentCoreStaticSinkRequest({
      ...base,
      targetPath: '/tmp/result.html'
    })).toThrow(/targetPath|unknown|closed|fields/i)
    expect(() => decodeDocumentCoreStaticSinkRequest({
      ...base,
      targetPath: '/tmp/result.html',
      suggestedName: 'Review'
    })).toThrow(/targetPath|unknown|closed|fields/i)
    expect(() => decodeDocumentCoreStaticSinkRequest({
      ...base,
      suggestedName: '../Review'
    })).toThrow(/filename|separator|suggestedName/i)
  })

  it('rejects every renderer-supplied static output path', () => {
    for (const request of [
      {
        documentId: 'document:1',
        revisionId: 'revision:1',
        view: 'markup',
        consumer: 'styled-html',
        targetPath: '/tmp/forged.html',
        options: exportOptions
      },
      {
        documentId: 'document:1',
        revisionId: 'revision:1',
        view: 'markup',
        consumer: 'pdf',
        targetPath: '/tmp/forged.pdf',
        options: exportOptions
      },
      {
        documentId: 'document:1',
        revisionId: 'revision:1',
        view: 'markup',
        consumer: 'print',
        proofPath: '/tmp/forged-print.pdf',
        options: exportOptions
      }
    ]) {
      expect(() => decodeDocumentCoreStaticSinkRequest(request))
        .toThrow(/targetPath|proofPath|unknown|closed|fields/i)
    }
  })

  it.each([
    'normal-copy',
    'copy-rich',
    'copy-html',
    'copy-markdown',
    'copy-table',
    'cut',
    'cut-table'
  ] as const)('admits the closed %s clipboard consumer', (consumer) => {
    expect(decodeDocumentCoreClipboardWriteRequest({
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'markup',
      consumer,
      selection: { start: 0, end: 1 }
    })).toMatchObject({ consumer })
  })

  it('admits only a parser node identity for heading-link clipboard materialization', () => {
    expect(decodeDocumentCoreClipboardWriteRequest({
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'markup',
      consumer: 'copy-heading-link',
      targetNodeId: 'p1:heading:1'
    })).toEqual({
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'markup',
      consumer: 'copy-heading-link',
      targetNodeId: 'p1:heading:1'
    })

    for (const request of [
      {
        documentId: 'document:1',
        revisionId: 'revision:1',
        view: 'source',
        consumer: 'copy-heading-link',
        targetNodeId: 'p1:heading:1'
      },
      {
        documentId: 'document:1',
        revisionId: 'revision:1',
        view: 'markup',
        consumer: 'copy-heading-link',
        targetNodeId: ''
      },
      {
        documentId: 'document:1',
        revisionId: 'revision:1',
        view: 'markup',
        consumer: 'copy-heading-link',
        targetNodeId: 'p1:heading:1',
        slug: 'renderer-forged'
      },
      {
        documentId: 'document:1',
        revisionId: 'revision:1',
        view: 'markup',
        consumer: 'copy-heading-link',
        selection: { start: 0, end: 1 }
      }
    ]) {
      expect(() => decodeDocumentCoreClipboardWriteRequest(request)).toThrow()
    }
  })

  it('admits exact source copy/cut but rejects rendered source consumers', () => {
    expect(decodeDocumentCoreClipboardWriteRequest({
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'source',
      consumer: 'copy-markdown',
      selection: { start: 1, end: 4 }
    })).toMatchObject({
      view: 'source',
      consumer: 'copy-markdown'
    })
    expect(decodeDocumentCoreClipboardWriteRequest({
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'source',
      consumer: 'cut',
      selection: { start: 1, end: 4 }
    })).toMatchObject({
      view: 'source',
      consumer: 'cut'
    })
    expect(() => decodeDocumentCoreClipboardWriteRequest({
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'source',
      consumer: 'copy-rich',
      selection: { start: 1, end: 4 }
    })).toThrow(/source|copy-markdown|normal-copy/i)
  })
})

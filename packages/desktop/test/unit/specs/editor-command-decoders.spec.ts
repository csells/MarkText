import { describe, expect, it } from 'vitest'
import {
  decodeEditorExportCommand,
  decodeMisspellingRequest,
  decodeReplaceRequest,
  decodeSearchRequest
} from '@/components/editorWithTabs/editorCommandDecoders'

describe('closed editor command decoders', () => {
  it('accepts only exact export consumers and closed option fields', () => {
    const options = {
      title: 'Document',
      page: {
        size: {
          kind: 'custom',
          widthMm: 210,
          heightMm: 297
        },
        landscape: false,
        marginsMm: {
          top: 20,
          right: 15,
          bottom: 20,
          left: 15
        }
      },
      theme: {
        kind: 'built-in',
        name: 'academic'
      },
      typography: {
        fontFamily: 'Source Serif',
        fontSizePx: 14,
        lineHeight: 1.5
      },
      autoNumberHeadings: true,
      showFrontMatter: true,
      toc: {
        title: 'Contents',
        includeTopHeading: false
      },
      header: {
        layout: 'three-columns',
        left: 'Left',
        center: 'Center',
        right: 'Right'
      },
      footer: null,
      headerFooterAppearance: {
        drawRules: true,
        fontSizePx: 11
      }
    }
    expect(decodeEditorExportCommand({
      type: 'pdf',
      options
    })).toEqual({
      type: 'pdf',
      options
    })

    // A malformed shape is refused before any field is interpreted, so these
    // are two distinct rejections rather than one that happens to fire first.
    expect(() => decodeEditorExportCommand({ type: 'pdfAnything', options }))
      .toThrow(/export type/)
    expect(() => decodeEditorExportCommand({ type: 'pdfAnything' }))
      .toThrow(/missing-required-key/)
    expect(() => decodeEditorExportCommand({
      type: 'print',
      options,
      unknown: true
    })).toThrow(/unknown-key/)
    expect(() => decodeEditorExportCommand({
      type: 'pdf',
      options: {
        ...options,
        page: {
          ...options.page,
          size: {
            kind: 'custom',
            widthMm: Number.NaN,
            heightMm: 297
          }
        }
      }
    })).toThrow(/widthMm|finite/)
    expect(() => decodeEditorExportCommand({
      type: 'print',
      options: {
        ...options,
        theme: {
          kind: 'custom',
          name: '../escape.css'
        }
      }
    })).toThrow(/theme|name|filename/)
  })

  it('decodes copy, paragraph, search, replace, and misspelling commands', () => {
    expect(decodeSearchRequest({
      value: 'needle',
      opt: {
        isCaseSensitive: true,
        isWholeWord: false,
        isRegexp: true
      }
    })).toEqual({
      query: {
        schema: 'document-search-query-1',
        text: 'needle',
        syntax: 'regexp',
        caseSensitive: true,
        wholeWord: false
      },
      // Absent means a plain search; only the find bar's Escape teardown
      // sets it to hand the caret to the active match.
      selectActiveMatch: false
    })
    expect(decodeReplaceRequest({
      query: 'needle',
      value: 'replacement',
      opt: {
        isSingle: true,
        isCaseSensitive: true,
        isWholeWord: false,
        isRegexp: true
      }
    })).toEqual({
      query: {
        schema: 'document-search-query-1',
        text: 'needle',
        syntax: 'regexp',
        caseSensitive: true,
        wholeWord: false
      },
      replacement: 'replacement',
      isSingle: true
    })
    expect(decodeMisspellingRequest({
      word: 'mispell',
      replacement: 'misspell'
    })).toEqual({
      word: 'mispell',
      replacement: 'misspell'
    })

    expect(() => decodeSearchRequest({ value: 1 })).toThrow(/search/)
    expect(() => decodeReplaceRequest({
      value: 'x',
      opt: { all: true }
    })).toThrow(/replace/)
    expect(() => decodeMisspellingRequest({
      word: 'x',
      replacement: 'y',
      extra: true
    })).toThrow(/misspelling/)
  })
})

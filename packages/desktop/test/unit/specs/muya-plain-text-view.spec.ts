import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'

import { createMuyaPlainTextView } from '@/documentAuthority/muyaPlainTextView'

describe('Muya plain-text view mapping', () => {
  it('derives detached Muya paths from a public Core projection map', () => {
    const core = createDocumentCore()
    const revision = core.open('head\n\nmiddle\n\ntail\n')

    const result = createMuyaPlainTextView(core.project(revision, 'revised'))

    expect(result).toEqual({
      kind: 'view',
      markdown: 'head\n\nmiddle\n\ntail\n',
      bindings: [
        { path: [0, 'text'], sourceRange: { start: 0, end: 4 }, text: 'head' },
        { path: [1, 'text'], sourceRange: { start: 6, end: 12 }, text: 'middle' },
        { path: [2, 'text'], sourceRange: { start: 14, end: 18 }, text: 'tail' }
      ]
    })
    expect(structuredClone(result)).toEqual(result)
  })

  it('renders structural and inline Markdown without inventing editable bindings', () => {
    const core = createDocumentCore()

    for (const source of ['# heading\n', 'plain *emphasis*\n', '- item\n']) {
      const revision = core.open(source)
      expect(createMuyaPlainTextView(core.project(revision, 'revised'))).toEqual({
        kind: 'view',
        markdown: source,
        bindings: []
      })
    }
  })

  it('renders all five CriticMarkup forms without inventing editable bindings', () => {
    const core = createDocumentCore()
    const revision = core.open(
      'before {++add++} {--del--} {~~old~>new~~} {==hi==} {>>note<<} after\n'
    )

    const result = createMuyaPlainTextView(core.project(revision, 'revised'))

    expect(result).toEqual({
      kind: 'view',
      markdown: 'before add  new hi  after\n',
      bindings: []
    })
    expect(structuredClone(result)).toEqual(result)
  })
})

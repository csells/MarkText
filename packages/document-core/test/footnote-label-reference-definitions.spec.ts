import { describe, expect, it } from 'vitest'

import { createDocumentCore, type DocumentRevision, type DocumentCore } from '../src/index.js'

interface Node {
  readonly kind: string
  readonly range: Readonly<{ start: number; end: number }>
  readonly attributes: Readonly<Record<string, string | number | boolean>>
  readonly children: readonly Node[]
}

const nodesOf = (core: DocumentCore, revision: DocumentRevision): Node[] => {
  const nodes: Node[] = []
  const pending: Node[] = [core.project(revision, 'revised').ast.root as unknown as Node]
  while (pending.length > 0) {
    const node = pending.shift()!
    nodes.push(node)
    pending.push(...node.children)
  }
  return nodes
}

const summary = (core: DocumentCore, revision: DocumentRevision) =>
  nodesOf(core, revision)
    .filter(node => ['definition', 'link', 'footnote-definition', 'footnote-reference'].includes(node.kind))
    .map(node => ({
      kind: node.kind,
      label: node.attributes['label'] ?? node.attributes['referenceLabel'],
      destination: node.attributes['semanticDestination']
    }))

// Upstream MarkText, like CommonMark, reads `[^label]: destination` as a link
// reference definition unless footnotes are on.
const source = 'See [the note][^1] and [^1].\n\n[^1]: https://example.com/note\n'

describe('footnote-style labels follow the footnotes switch', () => {
  it('defines and resolves a reference labelled `^1` without footnotes', () => {
    const core = createDocumentCore()
    const revision = core.open(source, { footnotes: false })
    expect(summary(core, revision)).toEqual([
      { kind: 'definition', label: '^1', destination: undefined },
      { kind: 'link', label: '^1', destination: 'https://example.com/note' },
      { kind: 'link', label: '^1', destination: 'https://example.com/note' }
    ])
  })

  it('keeps footnotes as footnotes when they are on', () => {
    const core = createDocumentCore()
    const revision = core.open(source, { footnotes: true })
    const items = summary(core, revision)
    const kinds = items.map(item => item.kind)
    expect(kinds).toContain('footnote-definition')
    expect(kinds.filter(kind => kind === 'footnote-reference')).toHaveLength(2)
    expect(kinds).not.toContain('definition')
    // A footnote's label names no link; only the body's URL is one.
    expect(items.filter(item => item.kind === 'link' && item.label === '^1')).toEqual([])
  })

  it('reads an edited document as a fresh open of its source does', () => {
    for (const footnotes of [false, true]) {
      const core = createDocumentCore()
      let revision = core.open(source, { footnotes })
      // Each edit is placed in the current source: typing before the
      // links, in the destination, breaking the definition's label and
      // restoring it.
      const edits: Array<(text: string) => { start: number, end: number, insert: string }> = [
        () => ({ start: 4, end: 4, insert: 'x' }),
        (text) => ({ start: text.indexOf('note\n'), end: text.indexOf('note\n'), insert: 'q' }),
        (text) => ({ start: text.lastIndexOf('[^1]:'), end: text.lastIndexOf('[^1]:') + 1, insert: '' }),
        (text) => ({ start: text.lastIndexOf('^1]:'), end: text.lastIndexOf('^1]:'), insert: '[' })
      ]
      for (const edit of edits) {
        revision = core.apply(revision, [edit(revision.source)], { projections: ['markup'] }).revision
        const fresh = createDocumentCore()
        const reopened = fresh.open(revision.source, { footnotes })
        expect(summary(core, revision)).toEqual(summary(fresh, reopened))
      }
    }
  })
})

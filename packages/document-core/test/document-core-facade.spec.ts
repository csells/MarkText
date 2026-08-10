import { describe, expect, it } from 'vitest'

import {
  createDocumentCore,
  DocumentCoreError,
  type DocumentCore,
  type DocumentRevision,
  type ProjectionCoordinateMap
} from '../src/index.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'

function markdownNodes(
  root: Readonly<{
    readonly children: readonly unknown[]
  }>
): readonly unknown[] {
  const nodes: unknown[] = []
  const pending: unknown[] = [root]
  while (pending.length > 0) {
    const node = pending.pop()
    if (
      node === null ||
      typeof node !== 'object' ||
      !('children' in node) ||
      !Array.isArray(node.children)
    ) {
      throw new Error('Projected Markdown AST contains an invalid node')
    }
    nodes.push(node)
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      pending.push(node.children[index])
    }
  }
  return nodes
}

function observableRevision(
  core: DocumentCore,
  revision: DocumentRevision
): unknown {
  const observableCoordinates = (
    coordinates: ProjectionCoordinateMap,
    projectedLength: number
  ): unknown => ({
    origins: Array.from(
      { length: projectedLength },
      (_, offset) => coordinates.originAt(offset)
    ),
    projectedPositions: Array.from(
      { length: projectedLength + 1 },
      (_, offset) => ({
        previous: coordinates.toSource(offset, 'previous'),
        next: coordinates.toSource(offset, 'next')
      })
    ),
    sourcePositions: Array.from(
      { length: revision.source.length + 1 },
      (_, offset) => ({
        previous: coordinates.toProjected(offset, 'previous'),
        next: coordinates.toProjected(offset, 'next')
      })
    )
  })
  const observableProjection = (
    name: 'original' | 'revised'
  ): unknown => {
    const projection = core.project(revision, name)
    return {
      markdown: projection.markdown,
      ast: projection.ast,
      coordinates: observableCoordinates(
        projection.coordinates,
        projection.markdown.length
      )
    }
  }
  const markup = core.project(revision, 'markup')
  const editingLength = markup.syntax.ast.root.range.end
  return {
    source: revision.source,
    annotations: revision.annotations,
    diagnostics: revision.diagnostics,
    original: observableProjection('original'),
    revised: observableProjection('revised'),
    markup: {
      events: markup.events,
      syntax: {
        ast: markup.syntax.ast,
        coordinates: observableCoordinates(
          markup.syntax.coordinates,
          editingLength
        )
      }
    }
  }
}

describe('document-core facade', () => {
  it('opens all five CriticMarkup forms without changing canonical source', () => {
    const source = 'keep {++add++} {--drop--} {~~old~>new~~} {==mark==} {>>note<<}'
    const core = createDocumentCore()
    const revision = core.open(source)

    expect(revision.source).toBe(source)
    expect(revision.annotations.map(annotation => ({
      kind: annotation.kind,
      source: source.slice(annotation.range.start, annotation.range.end)
    }))).toEqual([
      { kind: 'addition', source: '{++add++}' },
      { kind: 'deletion', source: '{--drop--}' },
      { kind: 'substitution', source: '{~~old~>new~~}' },
      { kind: 'highlight', source: '{==mark==}' },
      { kind: 'comment', source: '{>>note<<}' }
    ])
    expect(revision.annotations[0]).not.toHaveProperty('nodeId')
    expect(revision.annotations[0]?.arms[0]).not.toHaveProperty('nodeId')
  })

  it('derives Original and Revised Markdown from the same revision', () => {
    const source = 'keep {++add++} {--drop--} {~~old~>new~~} {==mark==} {>>note<<}'
    const core = createDocumentCore()
    const revision = core.open(source)
    const original = core.project(revision, 'original')
    const revised = core.project(revision, 'revised')

    expect(original).toMatchObject({
      kind: 'markdown',
      name: 'original',
      markdown: 'keep  drop old mark '
    })
    expect(revised).toMatchObject({
      kind: 'markdown',
      name: 'revised',
      markdown: 'keep add  new mark '
    })
  })

  it('publishes a balanced Markup event stream with an editing semantic spine', () => {
    const source =
      'a {++outer {--inner--}++} {~~old~>new~~} {==mark==} {>>note<<} z'
    const core = createDocumentCore()
    const revision = core.open(source)
    const markup = core.project(revision, 'markup')

    expect(markup.kind).toBe('markup')
    expect(markup.name).toBe('markup')
    expect(markup).not.toHaveProperty('markdown')
    expect(markup.syntax).not.toHaveProperty('markdown')
    expect(markup.syntax.ast.root.kind).toBe('document')
    expect(markup.events).toEqual([
      { kind: 'text', text: 'a ', sourceRange: { start: 0, end: 2 } },
      {
        kind: 'enter',
        mark: {
          kind: 'addition',
          annotationRange: { start: 2, end: 25 }
        }
      },
      { kind: 'text', text: 'outer ', sourceRange: { start: 5, end: 11 } },
      {
        kind: 'enter',
        mark: {
          kind: 'deletion',
          annotationRange: { start: 11, end: 22 }
        }
      },
      { kind: 'text', text: 'inner', sourceRange: { start: 14, end: 19 } },
      {
        kind: 'exit',
        mark: {
          kind: 'deletion',
          annotationRange: { start: 11, end: 22 }
        }
      },
      {
        kind: 'exit',
        mark: {
          kind: 'addition',
          annotationRange: { start: 2, end: 25 }
        }
      },
      { kind: 'text', text: ' ', sourceRange: { start: 25, end: 26 } },
      {
        kind: 'enter',
        mark: {
          kind: 'substitution',
          arm: 'old',
          annotationRange: { start: 26, end: 40 }
        }
      },
      { kind: 'text', text: 'old', sourceRange: { start: 29, end: 32 } },
      {
        kind: 'exit',
        mark: {
          kind: 'substitution',
          arm: 'old',
          annotationRange: { start: 26, end: 40 }
        }
      },
      {
        kind: 'enter',
        mark: {
          kind: 'substitution',
          arm: 'new',
          annotationRange: { start: 26, end: 40 }
        }
      },
      { kind: 'text', text: 'new', sourceRange: { start: 34, end: 37 } },
      {
        kind: 'exit',
        mark: {
          kind: 'substitution',
          arm: 'new',
          annotationRange: { start: 26, end: 40 }
        }
      },
      { kind: 'text', text: ' ', sourceRange: { start: 40, end: 41 } },
      {
        kind: 'enter',
        mark: {
          kind: 'highlight',
          annotationRange: { start: 41, end: 51 }
        }
      },
      { kind: 'text', text: 'mark', sourceRange: { start: 44, end: 48 } },
      {
        kind: 'exit',
        mark: {
          kind: 'highlight',
          annotationRange: { start: 41, end: 51 }
        }
      },
      { kind: 'text', text: ' ', sourceRange: { start: 51, end: 52 } },
      { kind: 'text', text: ' z', sourceRange: { start: 62, end: 64 } }
    ])
    expect(markup.events.flatMap(event =>
      event.kind === 'text' ? [event.text] : []
    ).join('')).toBe(
      'a outer inner oldnew mark  z'
    )
    const stack: object[] = []
    for (const event of markup.events) {
      if (event.kind === 'enter') stack.push(event.mark)
      if (event.kind === 'exit') expect(stack.pop()).toBe(event.mark)
    }
    expect(stack).toEqual([])
    expect(markup.events.flatMap(event =>
      event.kind === 'text' ? [] : [event.mark]
    ))
      .not.toContainEqual(expect.objectContaining({ nodeId: expect.anything() }))
    expect(revision.annotations.some(annotation => annotation.kind === 'comment'))
      .toBe(true)
    expect(core.project(revision, 'markup')).toBe(markup)
  })

  it('keeps the parser-emitted Markup spine when arm text would reparse differently', () => {
    const core = createDocumentCore()
    const markup = core.project(core.open('{~~*old~>new*~~}'), 'markup')
    const visibleText = markup.events.flatMap(event =>
      event.kind === 'text' ? [event.text] : []
    ).join('')
    const nodeKinds = markdownNodes(markup.syntax.ast.root).map(node =>
      (node as { readonly kind: string }).kind
    )

    // Flattening the two arms would synthesize `*oldnew*`, which a reparse
    // would treat as emphasis. The emitted editing spine protects that join.
    expect(visibleText).toBe('*oldnew*')
    expect(nodeKinds).not.toContain('emphasis')
    expect(markup.syntax.ast.root.range).toEqual({ start: 0, end: 9 })
    expect(markup.syntax.coordinates.originAt(0)).toEqual({
      kind: 'generated',
      sourcePosition: 3,
      affinity: 'next'
    })
    expect(markup.syntax.coordinates.toProjected(3, 'previous')).toBe(0)
    expect(markup.syntax.coordinates.toProjected(3, 'next')).toBe(1)
    expect(markup.syntax.coordinates.toSource(0, 'previous')).toBe(0)
    expect(markup.syntax.coordinates.toSource(0, 'next')).toBe(3)
    expect(markup.syntax.coordinates.toSource(5, 'previous')).toBe(7)
    expect(markup.syntax.coordinates.toSource(5, 'next')).toBe(9)
  })

  it('emits balanced marks for empty unary and substitution arms', () => {
    const source = '{++++}{----}{====}{~~~>~~}{~~~>new~~}{~~old~>~~}'
    const core = createDocumentCore()
    const markup = core.project(core.open(source), 'markup')
    const stack: object[] = []
    const marks: string[] = []

    for (const event of markup.events) {
      if (event.kind === 'enter') {
        stack.push(event.mark)
        marks.push(event.mark.kind === 'substitution'
          ? `${event.mark.kind}:${event.mark.arm}`
          : event.mark.kind)
      } else if (event.kind === 'exit') {
        expect(stack.pop()).toBe(event.mark)
      }
    }

    expect(stack).toEqual([])
    expect(marks).toEqual([
      'addition',
      'deletion',
      'highlight',
      'substitution:old',
      'substitution:new',
      'substitution:old',
      'substitution:new',
      'substitution:old',
      'substitution:new'
    ])
  })

  it('keeps deeply nested Markup projection event count linear', () => {
    const depth = 3_000
    const source = `${'{++a'.repeat(depth)}x${'++}'.repeat(depth)}`
    const core = createDocumentCore()
    const markup = core.project(core.open(source), 'markup')
    const stack: object[] = []
    const text: string[] = []

    expect(markup.events).toHaveLength(3 * depth)
    for (const event of markup.events) {
      if (event.kind === 'enter') stack.push(event.mark)
      if (event.kind === 'exit') expect(stack.pop()).toBe(event.mark)
      if (event.kind === 'text') text.push(event.text)
    }
    expect(stack).toEqual([])
    expect(text.join('')).toBe(`${'a'.repeat(depth)}x`)
  })

  it('materializes Markup without a second intrinsic CriticMarkup parse', () => {
    const source = 'before {++added++} {--deleted--} {~~old~>new~~} after'
    const core = createDocumentCore()
    const revision = core.open(source)
    const before = inspectDocumentCore(core).intrinsicSourceUnits

    core.project(revision, 'markup')

    expect(before).toBeGreaterThanOrEqual(source.length)
    expect(inspectDocumentCore(core).intrinsicSourceUnits).toBe(before)
  })

  it('publishes a sanitized Markdown AST with raw link-target facts', () => {
    const source = [
      '{--before--}{++[reference][target] ![reference image][target]++}',
      '',
      String.raw`[inline](</a%20b\c> "Raw\&Inline") ![inline image](<img/a%20b\c> "Raw\*Image")`,
      '',
      '<user@example.com> <https://example.test/a%20b>',
      '',
      String.raw`[target]: </resolved%20path\c> "Raw\&Reference"`,
      ''
    ].join('\n')
    const core = createDocumentCore()
    const revision = core.open(source)
    const revised = core.project(revision, 'revised')
    const nodes = markdownNodes(revised.ast.root) as ReadonlyArray<{
      readonly kind: string
      readonly range: Readonly<{ start: number; end: number }>
      readonly attributes: Readonly<Record<string, string | number | boolean>>
      readonly children: readonly unknown[]
    }>
    const definition = nodes.find(node => node.kind === 'definition')
    expect(definition).toBeDefined()
    const linked = nodes.filter(node =>
      node.kind === 'link' || node.kind === 'image' || node.kind === 'autolink'
    )
    expect(linked.map(node => ({
      kind: node.kind,
      rawDestination: node.attributes['rawDestination'],
      rawTitle: node.attributes['rawTitle'],
      referenceLabel: node.attributes['referenceLabel'],
      resolvedDefinitionStart: node.attributes['resolvedDefinitionStart'],
      resolvedDefinitionEnd: node.attributes['resolvedDefinitionEnd']
    }))).toEqual([
      {
        kind: 'link',
        rawDestination: String.raw`/resolved%20path\c`,
        rawTitle: String.raw`Raw\&Reference`,
        referenceLabel: 'target',
        resolvedDefinitionStart: definition?.range.start,
        resolvedDefinitionEnd: definition?.range.end
      },
      {
        kind: 'image',
        rawDestination: String.raw`/resolved%20path\c`,
        rawTitle: String.raw`Raw\&Reference`,
        referenceLabel: 'target',
        resolvedDefinitionStart: definition?.range.start,
        resolvedDefinitionEnd: definition?.range.end
      },
      {
        kind: 'link',
        rawDestination: String.raw`/a%20b\c`,
        rawTitle: String.raw`Raw\&Inline`,
        referenceLabel: undefined,
        resolvedDefinitionStart: undefined,
        resolvedDefinitionEnd: undefined
      },
      {
        kind: 'image',
        rawDestination: String.raw`img/a%20b\c`,
        rawTitle: String.raw`Raw\*Image`,
        referenceLabel: undefined,
        resolvedDefinitionStart: undefined,
        resolvedDefinitionEnd: undefined
      },
      {
        kind: 'autolink',
        rawDestination: 'user@example.com',
        rawTitle: undefined,
        referenceLabel: undefined,
        resolvedDefinitionStart: undefined,
        resolvedDefinitionEnd: undefined
      },
      {
        kind: 'autolink',
        rawDestination: 'https://example.test/a%20b',
        rawTitle: undefined,
        referenceLabel: undefined,
        resolvedDefinitionStart: undefined,
        resolvedDefinitionEnd: undefined
      }
    ])
    for (const node of nodes) {
      expect(node.attributes).not.toHaveProperty('destination')
      expect(node.attributes).not.toHaveProperty('title')
      expect(node).not.toHaveProperty('nodeId')
      expect(node).not.toHaveProperty('childAt')
      expect(node).not.toHaveProperty('childCount')
      expect(Object.values(node).some(value => typeof value === 'function')).toBe(false)
    }
  })

  it('publishes resolved and unresolved footnote-reference facts', () => {
    const source = 'resolved[^ok] unresolved[^missing]\n\n[^ok]: definition\n'
    const core = createDocumentCore()
    const projection = core.project(
      core.open(source, { footnotes: true }),
      'revised'
    )
    const nodes = markdownNodes(projection.ast.root) as ReadonlyArray<{
      readonly kind: string
      readonly range: Readonly<{ start: number; end: number }>
      readonly attributes: Readonly<Record<string, string | number | boolean>>
      readonly children: readonly unknown[]
    }>
    const definition = nodes.find(node => node.kind === 'footnote-definition')
    const references = nodes.filter(node => node.kind === 'footnote-reference')

    expect(references.map(node => node.attributes)).toEqual([
      expect.objectContaining({
        label: 'ok',
        resolved: true,
        resolvedDefinitionStart: definition?.range.start,
        resolvedDefinitionEnd: definition?.range.end
      }),
      expect.objectContaining({ label: 'missing', resolved: false })
    ])
    expect(references[1]?.attributes)
      .not.toHaveProperty('resolvedDefinitionStart')
    expect(references[1]?.attributes)
      .not.toHaveProperty('resolvedDefinitionEnd')
  })

  it('maps exact source and projection positions across CriticMarkup elision', () => {
    const core = createDocumentCore()
    const revision = core.open('A{++B++}C{--D--}E')
    const original = core.project(revision, 'original')
    const revised = core.project(revision, 'revised')

    expect(original.markdown).toBe('ACDE')
    expect(original.coordinates.toSource(1, 'previous')).toBe(1)
    expect(original.coordinates.toSource(1, 'next')).toBe(8)
    expect(original.coordinates.toSource(2, 'previous')).toBe(9)
    expect(original.coordinates.toSource(2, 'next')).toBe(12)
    expect(original.coordinates.toProjected(4, 'previous')).toBe(1)
    expect(original.coordinates.toProjected(4, 'next')).toBe(1)
    expect(original.coordinates.toProjected(12, 'previous')).toBe(2)
    expect(original.coordinates.toProjected(12, 'next')).toBe(2)

    expect(revised.markdown).toBe('ABCE')
    expect(revised.coordinates.toSource(1, 'previous')).toBe(1)
    expect(revised.coordinates.toSource(1, 'next')).toBe(4)
    expect(revised.coordinates.toSource(3, 'previous')).toBe(9)
    expect(revised.coordinates.toSource(3, 'next')).toBe(16)
    expect(revised.coordinates.toProjected(4, 'previous')).toBe(1)
    expect(revised.coordinates.toProjected(4, 'next')).toBe(1)
    expect(revised.coordinates.toProjected(12, 'previous')).toBe(3)
    expect(revised.coordinates.toProjected(12, 'next')).toBe(3)
  })

  it('reports generated protective escapes without claiming durable source', () => {
    const core = createDocumentCore()
    const revision = core.open('{{--z--}++x++}')
    const revised = core.project(revision, 'revised')

    expect(revised.markdown).toBe(String.raw`\{++x++}`)
    expect(revised.coordinates.originAt(0)).toEqual({
      kind: 'generated',
      sourcePosition: 0,
      affinity: 'next'
    })
    expect(revised.coordinates.originAt(1)).toEqual({
      kind: 'source',
      sourceOffset: 0
    })
    expect(revised.coordinates.toProjected(0, 'previous')).toBe(0)
    expect(revised.coordinates.toProjected(0, 'next')).toBe(1)
    expect(revised.coordinates.toSource(0, 'previous')).toBe(0)
    expect(revised.coordinates.toSource(0, 'next')).toBe(0)
    expect(revised.coordinates.toSource(1, 'previous')).toBe(0)
    expect(revised.coordinates.toSource(1, 'next')).toBe(0)
  })

  it('defines empty, fully elided, retained, and invalid coordinate boundaries', () => {
    const core = createDocumentCore()
    const empty = core.project(core.open(''), 'revised')

    expect(empty.coordinates.toSource(0, 'previous')).toBe(0)
    expect(empty.coordinates.toSource(0, 'next')).toBe(0)
    expect(empty.coordinates.toProjected(0, 'previous')).toBe(0)
    expect(empty.coordinates.toProjected(0, 'next')).toBe(0)
    expect(empty.coordinates.intersectsSource({ start: 0, end: 0 }))
      .toBe(false)
    expect(() => empty.coordinates.originAt(0)).toThrow(RangeError)
    expect(() => empty.coordinates.toSource(-1, 'next')).toThrow(RangeError)
    expect(() => empty.coordinates.toProjected(1, 'next')).toThrow(RangeError)
    expect(() => empty.coordinates.intersectsSource({ start: 1, end: 0 }))
      .toThrow(RangeError)

    const source = '{++x++}'
    const revision = core.open(source)
    const hidden = core.project(revision, 'original')
    const retained = core.project(revision, 'revised')

    expect(hidden.markdown).toBe('')
    expect(hidden.coordinates.toSource(0, 'previous')).toBe(0)
    expect(hidden.coordinates.toSource(0, 'next')).toBe(source.length)
    expect(hidden.coordinates.toProjected(3, 'previous')).toBe(0)
    expect(hidden.coordinates.toProjected(3, 'next')).toBe(0)
    expect(hidden.coordinates.intersectsSource({
      start: 0,
      end: source.length
    })).toBe(false)

    expect(retained.coordinates.originAt(0)).toEqual({
      kind: 'source',
      sourceOffset: 3
    })
    expect(retained.coordinates.intersectsSource({ start: 3, end: 4 }))
      .toBe(true)
    expect(retained.coordinates.intersectsSource({ start: 0, end: 3 }))
      .toBe(false)
  })

  it('caches each typed projection for the lifetime of its revision', () => {
    const core = createDocumentCore()
    const revision = core.open('A {++B++} C')
    const original = core.project(revision, 'original')
    const revised = core.project(revision, 'revised')

    expect(core.project(revision, 'original')).toBe(original)
    expect(core.project(revision, 'revised')).toBe(revised)
    expect(original).not.toBe(revised)
    expect(core.project(revision, 'original').ast).toBe(original.ast)
    expect(core.project(revision, 'original').coordinates)
      .toBe(original.coordinates)
  })

  it('materializes the deepest parser-admitted inline AST iteratively', () => {
    const delimiterCount = 16_000
    const source = `${'*'.repeat(delimiterCount)}x${'*'.repeat(delimiterCount)}`
    const core = createDocumentCore()
    const projection = core.project(core.open(source), 'revised')
    const pending: Array<readonly [
      (typeof projection.ast)['root'],
      number
    ]> = [[projection.ast.root, 1]]
    let maximumDepth = 0

    while (pending.length > 0) {
      const item = pending.pop()
      if (item === undefined) break
      const [node, depth] = item
      maximumDepth = Math.max(maximumDepth, depth)
      for (const child of node.children) {
        pending.push([child, depth + 1])
      }
    }

    expect(maximumDepth).toBeGreaterThan(7_900)
  })

  it('keeps CriticMarkup-looking text literal inside Markdown code', () => {
    const literal = '`{++inline++}`\n\n```md\n{--fenced--}\n```\n\n'
    const source = `${literal}{++real++}`
    const core = createDocumentCore()
    const revision = core.open(source)

    expect(revision.annotations.map(annotation => annotation.kind)).toEqual([
      'addition'
    ])
    expect(core.project(revision, 'original').markdown).toBe(literal)
    expect(core.project(revision, 'revised').markdown).toBe(`${literal}real`)
  })

  it('reports malformed recovery without changing canonical source', () => {
    const source = '{++a{--b++}c--}'
    const core = createDocumentCore()
    const revision = core.open(source)

    expect(revision.source).toBe(source)
    expect(revision.annotations.map(annotation => annotation.kind)).toEqual([
      'deletion'
    ])
    expect(revision.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'CM_UNTERMINATED_OPENER',
      'CM_NON_TOP_CLOSER'
    ])
  })

  it('uses document options for Markdown ranges that can own CriticMarkup', () => {
    const source = '[^a]: {++inside footnote++}\n'
    const core = createDocumentCore()
    const ordinary = core.open(source)
    const withFootnotes = core.open(source, { footnotes: true })

    expect(ordinary.annotations.map(annotation => annotation.kind)).toEqual([
      'addition'
    ])
    expect(core.project(ordinary, 'original').markdown).toBe('[^a]: \n')
    expect(core.project(ordinary, 'revised').markdown)
      .toBe('[^a]: inside footnote\n')

    expect(withFootnotes.annotations).toEqual([])
    expect(core.project(withFootnotes, 'original').markdown).toBe(source)
    expect(core.project(withFootnotes, 'revised').markdown).toBe(source)
  })

  it('materializes deeply nested annotations without using the call stack', () => {
    const depth = 3_000
    const source = `${'{++'.repeat(depth)}x${'++}'.repeat(depth)}`
    const revision = createDocumentCore().open(source)
    let annotation = revision.annotations[0]

    for (let level = 1; level < depth; level += 1) {
      expect(annotation?.kind).toBe('addition')
      annotation = annotation?.arms[0]?.annotations[0]
    }

    expect(annotation?.kind).toBe('addition')
    expect(annotation?.arms[0]?.annotations).toEqual([])
  })

  it('fails atomically instead of changing over-limit nesting semantics', () => {
    const depth = 16_385
    const source = `${'{++'.repeat(depth)}x${'++}'.repeat(depth)}`

    let rejection: unknown
    try {
      createDocumentCore().open(source)
    } catch (error) {
      rejection = error
    }

    expect(rejection).toBeInstanceOf(DocumentCoreError)
    expect(rejection).toMatchObject({
      code: 'CM_RESOURCE_CM_DEPTH_EXCEEDED',
      range: { start: 49_152, end: 49_155 },
      metadata: { limit: '16384', observed: '16385' }
    })
  })

  it('reopens through retained parser state with full-parse-equivalent results', () => {
    const source = 'one\n\nA {++new++} B {--old--}\n\nthree\n'
    const start = source.indexOf('three')
    const edit = {
      start,
      end: start + 5,
      insert: 'THREE with a longer plain-text ending'
    }
    const edits = [edit]
    const nextSource =
      source.slice(0, edit.start) +
      edit.insert +
      source.slice(edit.end)
    const incrementalCore = createDocumentCore()
    const opened = incrementalCore.open(source)
    const openedMarkup = incrementalCore.project(opened, 'markup')
    const before = inspectDocumentCore(incrementalCore).intrinsicSourceUnits
    const reopened = incrementalCore.reopen(opened, nextSource, edits)
    const spent =
      inspectDocumentCore(incrementalCore).intrinsicSourceUnits - before
    const fullCore = createDocumentCore()
    const full = fullCore.open(nextSource)
    const fullSpent = inspectDocumentCore(fullCore).intrinsicSourceUnits

    expect(observableRevision(incrementalCore, reopened))
      .toEqual(observableRevision(fullCore, full))
    expect(incrementalCore.project(opened, 'markup')).toBe(openedMarkup)
    expect(fullSpent).toBeGreaterThanOrEqual(nextSource.length)
    expect(spent).toBeLessThan(fullSpent)
  })

  it('merges partial reopen options over the previous revision options', () => {
    const source = '[^a]: {++inside footnote++}\n'
    const core = createDocumentCore()
    const previous = core.open(source, {
      footnotes: true,
      gfm: false,
      frontMatter: false
    })
    const insert = 'tail\n'
    const nextSource = source + insert
    const reopened = core.reopen(
      previous,
      nextSource,
      [{ start: source.length, end: source.length, insert }],
      { gfm: true }
    )

    expect(reopened.annotations).toEqual([])
    expect(core.project(reopened, 'original').markdown).toBe(nextSource)
    expect(core.project(reopened, 'revised').markdown).toBe(nextSource)
  })

  it('rejects mismatched and invalid edits without changing the previous revision', () => {
    const source = 'alpha {++beta++} omega'
    const core = createDocumentCore()
    const previous = core.open(source)
    const before = observableRevision(core, previous)

    expect(() => core.reopen(
      previous,
      'alpha {++BETA++} omega',
      [{ start: 9, end: 13, insert: 'wrong' }]
    )).toThrow(/does not match/i)
    expect(() => core.reopen(previous, source, [
      { start: 2, end: 5, insert: 'x' },
      { start: 4, end: 6, insert: 'y' }
    ])).toThrow(/invalid/i)

    expect(observableRevision(core, previous)).toEqual(before)

    const validSource = 'alpha {++BETA++} omega'
    const reopened = core.reopen(
      previous,
      validSource,
      [{ start: 9, end: 13, insert: 'BETA' }]
    )

    expect(reopened.source).toBe(validSource)
    expect(core.project(reopened, 'revised').markdown)
      .toBe('alpha BETA omega')
  })

  it('rejects branched or interleaved reopen attempts', () => {
    const core = createDocumentCore()
    const first = core.open('first\n\nMIDDLE\n\nTAIL\n')
    const second = core.open('# second\n\nMIDDLE\n\nTAIL\n')

    expect(core.project(first, 'original').markdown)
      .toBe('first\n\nMIDDLE\n\nTAIL\n')
    expect(() => core.reopen(
      first,
      'first\n\nMIDDLE\n\ntail\n',
      [{ start: 15, end: 19, insert: 'tail' }]
    )).toThrow(/current core revision/i)

    const current = core.reopen(
      second,
      '# second\n\nMIDDLE\n\ntail\n',
      [{ start: 18, end: 22, insert: 'tail' }]
    )
    expect(current.source).toBe('# second\n\nMIDDLE\n\ntail\n')
  })

  it('keeps the current revision usable after a candidate parse fails', () => {
    const source = 'head\n\ntail\n'
    const core = createDocumentCore()
    const current = core.open(source)
    const start = source.indexOf('tail')
    const depth = 16_385
    const overLimit = `${'{++'.repeat(depth)}x${'++}'.repeat(depth)}`
    const rejectedSource = `${source.slice(0, start)}${overLimit}\n`

    expect(() => core.reopen(current, rejectedSource, [{
      start,
      end: start + 4,
      insert: overLimit
    }])).toThrow('CM_RESOURCE_CM_DEPTH_EXCEEDED')

    const acceptedSource = 'head\n\nTAIL\n'
    const reopened = core.reopen(current, acceptedSource, [{
      start,
      end: start + 4,
      insert: 'TAIL'
    }])
    const fullCore = createDocumentCore()
    const full = fullCore.open(acceptedSource)
    expect(observableRevision(core, reopened)).toEqual(observableRevision(
      fullCore,
      full
    ))
  })
})

import { describe, expect, it } from 'vitest'

import {
  createDocumentCore,
  DocumentCoreError,
  DocumentSourceEditError,
  type CriticMarkupAnnotation,
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

function observableComment(
  core: DocumentCore,
  revision: DocumentRevision,
  comment: CriticMarkupAnnotation
): unknown {
  const projection = core.projectComment(revision, comment)
  return {
    kind: projection.kind,
    annotationRange: projection.annotationRange,
    markdown: projection.markdown,
    ast: projection.ast,
    origins: Array.from(
      { length: projection.markdown.length },
      (_, offset) => projection.coordinates.originAt(offset)
    ),
    projectedPositions: Array.from(
      { length: projection.markdown.length + 1 },
      (_, offset) => ({
        previous: projection.coordinates.toSource(offset, 'previous'),
        next: projection.coordinates.toSource(offset, 'next')
      })
    ),
    sourcePositions: Array.from(
      { length: revision.source.length + 1 },
      (_, offset) => ({
        previous: projection.coordinates.toProjected(offset, 'previous'),
        next: projection.coordinates.toProjected(offset, 'next')
      })
    )
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

  it('does not pair Markdown delimiters from distinct Addition arms', () => {
    const cases = [
      {
        source: '{++*++}x{++*++}',
        project: (core: DocumentCore, revision: DocumentRevision) =>
          core.project(revision, 'revised'),
        firstStar: 3,
        middle: 7,
        lastStar: 11
      },
      {
        source: '{>>{++*++}x{++*++}<<}',
        project: (core: DocumentCore, revision: DocumentRevision) => {
          const comment = revision.annotations[0]
          if (comment === undefined) throw new Error('Expected one Comment')
          return core.projectComment(revision, comment)
        },
        firstStar: 6,
        middle: 10,
        lastStar: 14
      }
    ] as const

    for (const testCase of cases) {
      const core = createDocumentCore()
      const revision = core.open(testCase.source)
      const projection = testCase.project(core, revision)
      const nodeKinds = markdownNodes(projection.ast.root).map(node =>
        (node as { readonly kind: string }).kind
      )

      expect(nodeKinds).not.toContain('emphasis')
      expect(projection.markdown).toBe('\\*x*')
      expect(Array.from(
        { length: projection.markdown.length },
        (_, offset) => projection.coordinates.originAt(offset)
      )).toEqual([
        {
          kind: 'generated',
          sourcePosition: testCase.firstStar,
          affinity: 'next'
        },
        { kind: 'source', sourceOffset: testCase.firstStar },
        { kind: 'source', sourceOffset: testCase.middle },
        { kind: 'source', sourceOffset: testCase.lastStar }
      ])
      expect(revision.source).toBe(testCase.source)
    }
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

  it('projects a Comment as an isolated full Markdown subdocument', () => {
    const payload = [
      '# Note',
      '',
      'See [inside][ref] {++now++}.',
      '',
      '[ref]: </comment%20path> "Local"',
      ''
    ].join('\n')
    const source = `[ref]: /root\n\n{>>${payload}<<}\n`
    const core = createDocumentCore()
    const revision = core.open(source)
    const comment = revision.annotations.find(annotation =>
      annotation.kind === 'comment'
    )
    if (comment === undefined) throw new Error('Expected one Comment')

    const projection = core.projectComment(revision, comment)
    const expectedMarkdown = payload.replace('{++', '').replace('++}', '')
    const nodes = markdownNodes(projection.ast.root) as ReadonlyArray<{
      readonly kind: string
      readonly range: Readonly<{ start: number; end: number }>
      readonly attributes: Readonly<Record<string, string | number | boolean>>
      readonly children: readonly unknown[]
    }>
    const definition = nodes.find(node => node.kind === 'definition')
    const link = nodes.find(node => node.kind === 'link')
    const payloadStart = source.indexOf('{>>') + 3
    const payloadEnd = source.indexOf('<<}', payloadStart)
    const additionStart = source.indexOf('{++', payloadStart)
    const retainedSourceOffsets = [
      ...Array.from(
        { length: additionStart - payloadStart },
        (_, index) => payloadStart + index
      ),
      ...Array.from({ length: 3 }, (_, index) => additionStart + 3 + index),
      ...Array.from(
        { length: payloadEnd - (additionStart + 9) },
        (_, index) => additionStart + 9 + index
      )
    ]

    expect(projection).toMatchObject({
      kind: 'comment',
      annotationRange: comment.range,
      markdown: expectedMarkdown
    })
    expect(nodes.map(node => node.kind)).toEqual(expect.arrayContaining([
      'document',
      'heading',
      'paragraph',
      'link',
      'definition'
    ]))
    expect(link?.attributes).toMatchObject({
      referenceLabel: 'ref',
      rawDestination: '/comment%20path',
      rawTitle: 'Local',
      resolvedDefinitionStart: definition?.range.start,
      resolvedDefinitionEnd: definition?.range.end
    })
    expect(Array.from(
      { length: projection.markdown.length },
      (_, offset) => projection.coordinates.originAt(offset)
    )).toEqual(retainedSourceOffsets.map(sourceOffset => ({
      kind: 'source',
      sourceOffset
    })))
    expect(projection.coordinates.toSource(0, 'previous')).toBe(0)
    expect(projection.coordinates.toSource(0, 'next')).toBe(payloadStart)
    expect(projection.coordinates.toSource(projection.markdown.length, 'previous'))
      .toBe(payloadEnd)
    expect(projection.coordinates.toSource(projection.markdown.length, 'next'))
      .toBe(source.length)
    expect(core.projectComment(revision, comment)).toBe(projection)
  })

  it('does not inherit an outer block container into a Comment', () => {
    const source = '- before {>># Local\n\n> quote\n\n- item\n<<} after\n'
    const core = createDocumentCore()
    const revision = core.open(source)
    const comment = revision.annotations[0]
    if (comment === undefined) throw new Error('Expected one Comment')
    const commentKinds = markdownNodes(
      core.projectComment(revision, comment).ast.root
    ).map(node => (node as Readonly<{ kind: string }>).kind)
    const outerKinds = markdownNodes(
      core.project(revision, 'revised').ast.root
    ).map(node => (node as Readonly<{ kind: string }>).kind)

    expect(commentKinds).toEqual(expect.arrayContaining([
      'heading',
      'blockquote',
      'list'
    ]))
    expect(commentKinds[1]).toBe('heading')
    expect(outerKinds.filter(kind => kind === 'list')).toHaveLength(1)
    expect(core.project(revision, 'revised').markdown)
      .toBe('- before  after\n')
  })

  it('keeps Comment reference and footnote definitions local', () => {
    const payload = [
      'Inside [local][ref], unresolved [outer][root], note[^n], and missing[^outer].',
      '',
      '[ref]: /comment',
      '',
      '[^n]: Comment footnote',
      '',
      '# End',
      ''
    ].join('\n')
    const source = [
      '[root]: /root',
      '',
      '[^outer]: Root footnote',
      '',
      `Before [root][root] and root[^outer]. {>>${payload}<<}`,
      '',
      'After [missing][local].',
      ''
    ].join('\n')
    const core = createDocumentCore()
    const revision = core.open(source, { footnotes: true })
    const comment = revision.annotations[0]
    if (comment === undefined) throw new Error('Expected one Comment')
    const commentNodes = markdownNodes(
      core.projectComment(revision, comment).ast.root
    ) as ReadonlyArray<{
      readonly kind: string
      readonly attributes: Readonly<Record<string, string | number | boolean>>
      readonly children: readonly unknown[]
    }>
    const outerNodes = markdownNodes(
      core.project(revision, 'revised').ast.root
    ) as ReadonlyArray<{
      readonly kind: string
      readonly attributes: Readonly<Record<string, string | number | boolean>>
      readonly children: readonly unknown[]
    }>

    expect(commentNodes.filter(node => node.kind === 'link').map(node =>
      node.attributes['rawDestination']
    )).toEqual(['/comment'])
    expect(commentNodes.find(node => node.kind === 'footnote-reference')?.attributes)
      .toMatchObject({ resolved: true })
    expect(commentNodes.filter(node => node.kind === 'footnote-reference').map(
      node => node.attributes['resolved']
    )).toEqual([true, false])
    expect(outerNodes.filter(node => node.kind === 'link').map(node =>
      node.attributes['rawDestination']
    )).toEqual(['/root'])
    expect(outerNodes.filter(node => node.kind === 'footnote-definition'))
      .toHaveLength(1)

    const plainCore = createDocumentCore()
    const plain = plainCore.open(source, { footnotes: false })
    const plainComment = plain.annotations[0]
    if (plainComment === undefined) throw new Error('Expected plain Comment')
    expect(markdownNodes(plainCore.projectComment(plain, plainComment).ast.root)
      .some(node => (node as Readonly<{ kind: string }>).kind.startsWith('footnote')))
      .toBe(false)
  })

  it('keeps definition precedence and resolves a separately closed multiline Comment', () => {
    const sameLineSource = [
      '{>>Review [evidence][ref].',
      '',
      '[ref]: https://example.com/local<<}'
    ].join('\n')
    const sameLineCore = createDocumentCore()
    const sameLine = sameLineCore.open(sameLineSource)
    const sameLineNodes = markdownNodes(
      sameLineCore.project(sameLine, 'revised').ast.root
    ) as ReadonlyArray<{
      readonly kind: string
      readonly attributes: Readonly<Record<string, string | number | boolean>>
      readonly children: readonly unknown[]
    }>
    const ownedDefinition = sameLineNodes.find(node => node.kind === 'definition')
    const destinationStart = ownedDefinition?.attributes['destinationStart']
    const destinationEnd = ownedDefinition?.attributes['destinationEnd']
    expect(sameLine.annotations).toEqual([])
    expect(sameLine.diagnostics.map(diagnostic => diagnostic.code))
      .toContain('CM_UNTERMINATED_OPENER')
    expect(ownedDefinition?.attributes).toMatchObject({ label: 'ref' })
    expect(sameLineSource.slice(
      typeof destinationStart === 'number' ? destinationStart : 0,
      typeof destinationEnd === 'number' ? destinationEnd : 0
    )).toBe('https://example.com/local<<}')

    const source = [
      'Claim.[^n]',
      '',
      '{>>Review [evidence][ref].',
      '',
      '[ref]: https://example.com/local',
      '<<}',
      '',
      '[^n]: Main note.'
    ].join('\n')
    const expectedSource = 'Claim.[^n]\n\n\n\n[^n]: Main note.'
    const expectedPayload = [
      'Review [evidence][ref].',
      '',
      '[ref]: https://example.com/local',
      ''
    ].join('\n')
    const core = createDocumentCore()
    const revision = core.open(source, { footnotes: true })
    const comment = revision.annotations.find(annotation => (
      annotation.kind === 'comment'
    ))
    if (comment === undefined) throw new Error('Expected one Comment')

    const commentStart = source.indexOf('{>>')
    const commentEnd = source.indexOf('<<}', commentStart) + 3
    expect(comment.range).toEqual({ start: commentStart, end: commentEnd })
    expect(source.slice(comment.range.start, comment.range.end))
      .toBe(`{>>${expectedPayload}<<}`)

    const projection = core.projectComment(revision, comment)
    const commentNodes = markdownNodes(projection.ast.root) as ReadonlyArray<{
      readonly kind: string
      readonly range: Readonly<{ start: number; end: number }>
      readonly attributes: Readonly<Record<string, string | number | boolean>>
      readonly children: readonly unknown[]
    }>
    const definition = commentNodes.find(node => node.kind === 'definition')
    expect(projection.markdown).toBe(expectedPayload)
    expect(commentNodes.find(node => node.kind === 'link')?.attributes)
      .toMatchObject({
        referenceLabel: 'ref',
        rawDestination: 'https://example.com/local',
        resolvedDefinitionStart: definition?.range.start,
        resolvedDefinitionEnd: definition?.range.end
      })

    const resolved = core.resolve(revision, comment, 'accept')
    expect(resolved.revision.source).toBe(expectedSource)
    const mainNodes = markdownNodes(
      core.project(resolved.revision, 'revised').ast.root
    ) as ReadonlyArray<{
      readonly kind: string
      readonly attributes: Readonly<Record<string, string | number | boolean>>
      readonly children: readonly unknown[]
    }>
    expect(mainNodes.find(node => node.kind === 'footnote-reference')?.attributes)
      .toMatchObject({ resolved: true })
    expect(mainNodes.filter(node => node.kind === 'footnote-definition'))
      .toHaveLength(1)
  })

  it('does not resolve definitions across distinct Comment Addition arms', () => {
    const linkCore = createDocumentCore()
    const linkRevision = linkCore.open(
      '{>>{++[x][r]++}\n\n{++[r]: /u\n++}<<}'
    )
    const linkComment = linkRevision.annotations[0]
    if (linkComment === undefined) throw new Error('Expected link Comment')
    const linkNodes = markdownNodes(
      linkCore.projectComment(linkRevision, linkComment).ast.root
    ) as ReadonlyArray<{
      readonly kind: string
      readonly attributes: Readonly<Record<string, string | number | boolean>>
      readonly children: readonly unknown[]
    }>

    expect(linkNodes.some(node => node.kind === 'link')).toBe(false)
    expect(linkNodes.some(node => node.kind === 'definition')).toBe(true)

    const footnoteCore = createDocumentCore()
    const footnoteRevision = footnoteCore.open(
      '{>>{++note[^r]++}\n\n{++[^r]: body\n++}<<}',
      { footnotes: true }
    )
    const footnoteComment = footnoteRevision.annotations[0]
    if (footnoteComment === undefined) {
      throw new Error('Expected footnote Comment')
    }
    const footnoteNodes = markdownNodes(
      footnoteCore.projectComment(footnoteRevision, footnoteComment).ast.root
    ) as ReadonlyArray<{
      readonly kind: string
      readonly attributes: Readonly<Record<string, string | number | boolean>>
      readonly children: readonly unknown[]
    }>

    expect(footnoteNodes.find(node => node.kind === 'footnote-reference')?.attributes)
      .toMatchObject({ resolved: false })
    expect(footnoteNodes.some(node => node.kind === 'footnote-definition'))
      .toBe(true)
  })

  it('selects the first same-scope definition for projected references', () => {
    const duplicateSource = [
      '{++[r]: /arm1\n++}',
      '',
      '{++[x][r]\n',
      '[r]: /arm2\n++}'
    ].join('\n')
    const sources = [duplicateSource, `{>>${duplicateSource}<<}`]

    for (const source of sources) {
      const core = createDocumentCore()
      const revision = core.open(source)
      const projection = source.startsWith('{>>')
        ? (() => {
          const comment = revision.annotations[0]
          if (comment === undefined) throw new Error('Expected one Comment')
          return core.projectComment(revision, comment)
        })()
        : core.project(revision, 'revised')
      const link = markdownNodes(projection.ast.root).find(node =>
        (node as Readonly<{ kind: string }>).kind === 'link'
      ) as Readonly<{
        readonly attributes: Readonly<Record<string, string | number | boolean>>
      }> | undefined

      expect(link?.attributes).toMatchObject({ rawDestination: '/arm2' })
    }

    const negativeSource = '{++[r]: /inner\n++}\n\n[x][r]'
    for (const source of [negativeSource, `{>>${negativeSource}<<}`]) {
      const negativeCore = createDocumentCore()
      const negative = negativeCore.open(source)
      const projection = source.startsWith('{>>')
        ? (() => {
          const comment = negative.annotations[0]
          if (comment === undefined) throw new Error('Expected one Comment')
          return negativeCore.projectComment(negative, comment)
        })()
        : negativeCore.project(negative, 'revised')
      expect(markdownNodes(projection.ast.root).some(node =>
        (node as Readonly<{ kind: string }>).kind === 'link'
      )).toBe(false)
      expect(projection.markdown).toContain('\\[x]\\[r]')
      const guardStart = projection.markdown.indexOf('\\[x]')
      expect(projection.coordinates.originAt(guardStart)).toEqual({
        kind: 'generated',
        sourcePosition: source.lastIndexOf('[x][r]'),
        affinity: 'next'
      })
      const shortcutGuardStart = projection.markdown.indexOf('\\[r]', guardStart + 1)
      expect(projection.coordinates.originAt(shortcutGuardStart)).toEqual({
        kind: 'generated',
        sourcePosition: source.lastIndexOf('[r]'),
        affinity: 'next'
      })
      const materializedCore = createDocumentCore()
      const materialized = materializedCore.open(projection.markdown)
      expect(markdownNodes(
        materializedCore.project(materialized, 'revised').ast.root
      ).some(node => (node as Readonly<{ kind: string }>).kind === 'link'))
        .toBe(false)
    }

    const positiveCore = createDocumentCore()
    const positive = positiveCore.open(
      '{++[x][r]\n\n[r]: /same\n++}'
    )
    const positiveLink = markdownNodes(
      positiveCore.project(positive, 'revised').ast.root
    ).find(node => (node as Readonly<{ kind: string }>).kind === 'link') as
      | Readonly<{
        readonly attributes: Readonly<Record<string, string | number | boolean>>
      }>
      | undefined
    expect(positiveLink?.attributes).toMatchObject({ rawDestination: '/same' })
  })

  it('selects the first same-scope footnote definition', () => {
    const source = [
      '{++[^r]: first\n++}',
      '',
      '{++note[^r]\n',
      '[^r]: second\n++}'
    ].join('\n')
    const core = createDocumentCore()
    const revision = core.open(source, { footnotes: true })
    const projection = core.project(revision, 'revised')
    const nodes = markdownNodes(projection.ast.root) as ReadonlyArray<{
      readonly kind: string
      readonly attributes: Readonly<Record<string, string | number | boolean>>
      readonly range: Readonly<{ start: number; end: number }>
      readonly children: readonly unknown[]
    }>
    const definitions = nodes.filter(node => node.kind === 'footnote-definition')
    const reference = nodes.find(node => node.kind === 'footnote-reference')

    expect(definitions).toHaveLength(2)
    expect(reference?.attributes).toMatchObject({ resolved: true })

    const negativeSource = '{++[^r]: one\n++}\n\nnote[^r]'
    for (const candidate of [negativeSource, `{>>${negativeSource}<<}`]) {
      const negativeCore = createDocumentCore()
      const negative = negativeCore.open(candidate, { footnotes: true })
      const negativeProjection = candidate.startsWith('{>>')
        ? (() => {
          const comment = negative.annotations[0]
          if (comment === undefined) throw new Error('Expected one Comment')
          return negativeCore.projectComment(negative, comment)
        })()
        : negativeCore.project(negative, 'revised')
      const negativeReference = markdownNodes(
        negativeProjection.ast.root
      ).find(node =>
        (node as Readonly<{ kind: string }>).kind === 'footnote-reference'
      ) as Readonly<{
        readonly attributes: Readonly<Record<string, string | number | boolean>>
      }> | undefined

      expect(negativeReference?.attributes).toMatchObject({
        label: 'r',
        resolved: false
      })
      expect(negativeProjection.markdown).toContain('note\\[^r]')
      // `[` is escapable ASCII punctuation, so a Markdown sink exposes the
      // author-visible spelling without leaking the engine-added slash.
      expect(negativeProjection.markdown.replace('\\[', '['))
        .toContain('note[^r]')
      const guardStart = negativeProjection.markdown.indexOf('\\[^r]')
      expect(negativeProjection.coordinates.originAt(guardStart)).toEqual({
        kind: 'generated',
        sourcePosition: candidate.lastIndexOf('[^r]'),
        affinity: 'next'
      })
      const materializedCore = createDocumentCore()
      const materialized = materializedCore.open(
        negativeProjection.markdown,
        { footnotes: true }
      )
      const materializedReference = markdownNodes(
        materializedCore.project(materialized, 'revised').ast.root
      ).find(node =>
        (node as Readonly<{ kind: string }>).kind === 'footnote-reference'
      ) as Readonly<{
        readonly attributes: Readonly<Record<string, string | number | boolean>>
      }> | undefined
      expect(materializedReference).toBeUndefined()
    }

    const bomPayload = `{--x--}\uFEFF# Heading\n\n${negativeSource}`
    for (const candidate of [bomPayload, `{>>${bomPayload}<<}`]) {
      const bomCore = createDocumentCore()
      const bomRevision = bomCore.open(candidate, { footnotes: true })
      const bomProjection = candidate.startsWith('{>>')
        ? (() => {
          const comment = bomRevision.annotations[0]
          if (comment === undefined) throw new Error('Expected one Comment')
          return bomCore.projectComment(bomRevision, comment)
        })()
        : bomCore.project(bomRevision, 'revised')
      const bomNodes = markdownNodes(bomProjection.ast.root) as ReadonlyArray<{
        readonly kind: string
        readonly attributes: Readonly<Record<string, string | number | boolean>>
        readonly children: readonly unknown[]
      }>

      expect(bomProjection.markdown).toContain('&#xFEFF;# Heading')
      expect(bomNodes.some(node => node.kind === 'heading')).toBe(false)
      expect(bomNodes.find(node => node.kind === 'footnote-reference')?.attributes)
        .toMatchObject({ label: 'r', resolved: false })
    }

    const initialSource = `A\n\n${negativeSource}`
    const nextSource = `B\n\n${negativeSource}`
    const incrementalCore = createDocumentCore()
    const initial = incrementalCore.open(initialSource, { footnotes: true })
    const reopened = incrementalCore.reopen(initial, nextSource, [{
      start: 0,
      end: 1,
      insert: 'B'
    }])
    const fullCore = createDocumentCore()
    const full = fullCore.open(nextSource, { footnotes: true })
    expect(observableRevision(incrementalCore, reopened))
      .toEqual(observableRevision(fullCore, full))
  })

  it('preserves literal and malformed Markdown-looking text inside Comments', () => {
    const payload = [
      '# Heading',
      '',
      '```md',
      '{++literal++}',
      '```',
      '',
      'unfinished {++ opener',
      ''
    ].join('\n')
    const source = `{>>${payload}<<}`
    const core = createDocumentCore()
    const revision = core.open(source)
    const comment = revision.annotations[0]
    if (comment === undefined) throw new Error('Expected one Comment')
    const projection = core.projectComment(revision, comment)
    const unfinishedStart = payload.lastIndexOf('{++')
    const guardedPayload =
      payload.slice(0, unfinishedStart) +
      '\\' +
      payload.slice(unfinishedStart)
    const nodeKinds = markdownNodes(projection.ast.root).map(node =>
      (node as Readonly<{ kind: string }>).kind
    )

    expect(projection.markdown).toBe(guardedPayload)
    expect(projection.coordinates.originAt(unfinishedStart)).toMatchObject({
      kind: 'generated',
      sourcePosition: source.indexOf('{++', source.indexOf('unfinished')),
      affinity: 'next'
    })
    expect(nodeKinds).toEqual(expect.arrayContaining([
      'heading',
      'code-block',
      'paragraph'
    ]))
    expect(comment.arms[0]?.annotations).toEqual([])
    expect(revision.source).toBe(source)
  })

  it('does not let an unfinished nested opener swallow a Comment closer', () => {
    const cases = [
      { source: '{>>{++<<}after', remainder: 'after' },
      { source: '{>>{++<<}after \\++}', remainder: 'after \\++}' },
      {
        source: '{>>{++<<}after [x](<++}>)',
        remainder: 'after [x](<++}>)'
      }
    ] as const

    for (const testCase of cases) {
      const core = createDocumentCore()
      const revision = core.open(testCase.source)
      const comment = revision.annotations[0]
      if (comment === undefined) {
        throw new Error(`Expected one Comment for ${testCase.source}`)
      }

      expect(revision.annotations).toHaveLength(1)
      expect(comment).toMatchObject({
        kind: 'comment',
        range: { start: 0, end: 9 }
      })
      const projection = core.projectComment(revision, comment)
      expect(projection.markdown).toBe('\\{++')
      expect(projection.coordinates.originAt(0)).toEqual({
        kind: 'generated',
        sourcePosition: 3,
        affinity: 'next'
      })
      expect(core.project(revision, 'revised').markdown)
        .toBe(testCase.remainder)
      expect(revision.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'CM_UNTERMINATED_OPENER',
          range: { start: 3, end: 6 }
        })
      ]))
    }

    const initialSource = '{>>{++<<}after [x](<abc>)'
    const nextSource = '{>>{++<<}after [x](<++}>)'
    const editStart = initialSource.indexOf('abc')
    const incrementalCore = createDocumentCore()
    const initial = incrementalCore.open(initialSource)
    const reopened = incrementalCore.reopen(initial, nextSource, [{
      start: editStart,
      end: editStart + 3,
      insert: '++}'
    }])
    const fullCore = createDocumentCore()
    const full = fullCore.open(nextSource)

    expect(observableRevision(incrementalCore, reopened))
      .toEqual(observableRevision(fullCore, full))
  })

  it('publishes malformed nested closer prefixes without recovery failure', () => {
    const source = '{--{=={--{~~==}--}~~}'
    expect(source).toHaveLength(21)

    const core = createDocumentCore()
    const revision = core.open(source)

    expect(revision.source).toBe(source)
    expect(revision.annotations).toEqual([
      expect.objectContaining({
        kind: 'deletion',
        range: { start: 0, end: 18 }
      })
    ])
    expect(() => core.project(revision, 'revised')).not.toThrow()

    const blockerDepth = 256
    const deepSource =
      '{--{==' +
      '{++'.repeat(blockerDepth) +
      '==}' +
      '++}'.repeat(blockerDepth) +
      '--}'
    const deepCore = createDocumentCore()
    const deepRevision = deepCore.open(deepSource)

    expect(deepRevision.source).toBe(deepSource)
    expect(inspectDocumentCore(deepCore).intrinsicSourceUnits)
      .toBeLessThanOrEqual(deepSource.length * 2)

    const cascadeDepth = 32
    const cascadeSource =
      '{--{=='.repeat(cascadeDepth) +
      '{--{~~==}--}~~}'
    const cascadeCore = createDocumentCore()
    const cascadeRevision = cascadeCore.open(cascadeSource)

    expect(cascadeRevision.source).toBe(cascadeSource)
    expect(inspectDocumentCore(cascadeCore).intrinsicSourceUnits)
      .toBeLessThanOrEqual(cascadeSource.length * 2)

    const fourPassSource = '{--{>>{--{=={--{>>--}==}<<}'
    expect(fourPassSource).toHaveLength(27)
    const fourPassCore = createDocumentCore()
    const fourPassRevision = fourPassCore.open(fourPassSource)

    expect(fourPassRevision.annotations).toEqual([
      expect.objectContaining({
        kind: 'comment',
        range: { start: 15, end: 27 }
      })
    ])
    expect(inspectDocumentCore(fourPassCore).intrinsicSourceUnits)
      .toBeLessThanOrEqual(fourPassSource.length * 2)
  })

  it('keeps Comment-looking closers inside completed local literal owners', () => {
    const cases = [
      {
        name: 'fenced code',
        payload: '```md\n<<}\n```\nlast\n',
        options: {},
        expectedKind: 'code-block'
      },
      {
        name: 'front matter',
        payload: '---\na: <<}\n---\nlast\n',
        options: { frontMatter: true },
        expectedKind: 'front-matter'
      },
      {
        name: 'direct link destination',
        payload: '[x](a<<}b) tail',
        options: {},
        expectedKind: 'link'
      },
      {
        name: 'reference definition title',
        payload: '[r]: /a "t <<} u"\n\n# end\n',
        options: {},
        expectedKind: 'definition'
      },
      {
        name: 'inline HTML',
        payload: '<span title="<<}">ok</span> tail',
        options: {},
        expectedKind: 'inline-html'
      },
      {
        name: 'double-dollar math block',
        payload: '$$\ninside <<}\n$$\nlast\n',
        options: { math: true },
        expectedKind: 'math-block'
      }
    ] as const

    for (const testCase of cases) {
      const source = `{>>${testCase.payload}<<}after`
      const core = createDocumentCore()
      const revision = core.open(source, testCase.options)
      const comment = revision.annotations[0]
      if (comment === undefined) throw new Error('Expected one Comment')

      expect(comment.range.end, testCase.name)
        .toBe(source.lastIndexOf('<<}') + 3)
      const projection = core.projectComment(revision, comment)
      expect(projection.markdown).toBe(testCase.payload)
      expect(markdownNodes(projection.ast.root).some(node =>
        (node as Readonly<{ kind: string }>).kind === testCase.expectedKind
      )).toBe(true)
      expect(core.project(revision, 'revised').markdown).toBe('after')
    }
  })

  it('lets a Comment closer stand against unfinished inline code and math', () => {
    const cases = [
      {
        source: '{>>a `x<<}` after<<}',
        options: {},
        payload: 'a `x',
        excludedKind: 'inline-code'
      },
      {
        source: '{>>a $x<<}$ after<<}',
        options: { math: true },
        payload: 'a $x',
        excludedKind: 'inline-math'
      }
    ] as const

    for (const testCase of cases) {
      const core = createDocumentCore()
      const revision = core.open(testCase.source, testCase.options)
      const comment = revision.annotations[0]
      if (comment === undefined) throw new Error('Expected one Comment')
      const firstCloserEnd = testCase.source.indexOf('<<}') + 3
      const projection = core.projectComment(revision, comment)

      expect(comment.range.end).toBe(firstCloserEnd)
      expect(projection.markdown).toBe(testCase.payload)
      expect(markdownNodes(projection.ast.root).some(node =>
        (node as Readonly<{ kind: string }>).kind === testCase.excludedKind
      )).toBe(false)
    }
  })

  it('projects nested CriticMarkup and empty Comments independently', () => {
    const source =
      '{>>before {++add++} {--drop--} {~~old~>new~~} {==mark==} {>>nested<<}<<} {>><<}'
    const core = createDocumentCore()
    const revision = core.open(source)
    const outer = revision.annotations[0]
    const empty = revision.annotations[1]
    const nested = outer?.arms[0]?.annotations.find(annotation =>
      annotation.kind === 'comment'
    )
    if (outer === undefined || empty === undefined || nested === undefined) {
      throw new Error('Expected outer, nested, and empty Comments')
    }

    expect(core.projectComment(revision, outer).markdown)
      .toBe('before add  new mark ')
    expect(core.projectComment(revision, nested).markdown).toBe('nested')
    expect(core.projectComment(revision, empty).markdown).toBe('')
    expect(core.projectComment(revision, empty).ast.root).toMatchObject({
      kind: 'document',
      range: { start: 0, end: 0 }
    })
  })

  it('rejects foreign and non-Comment annotations without advancing the head', () => {
    const source = 'A {++B++} {>>note<<}'
    const core = createDocumentCore()
    const revision = core.open(source)
    const addition = revision.annotations.find(annotation =>
      annotation.kind === 'addition'
    )
    const comment = revision.annotations.find(annotation =>
      annotation.kind === 'comment'
    )
    const foreignCore = createDocumentCore()
    const foreignRevision = foreignCore.open('{>>foreign<<}')
    const foreignComment = foreignRevision.annotations[0]
    if (addition === undefined || comment === undefined || foreignComment === undefined) {
      throw new Error('Expected test annotations')
    }

    expect(() => core.projectComment(revision, addition)).toThrow(/not a Comment/)
    expect(() => core.projectComment(revision, foreignComment))
      .toThrow(/does not belong to this revision/)
    expect(() => core.projectComment(revision, { ...comment }))
      .toThrow(/does not belong to this revision/)

    const nextSource = `${source}!`
    const reopened = core.reopen(revision, nextSource, [{
      start: source.length,
      end: source.length,
      insert: '!'
    }])
    expect(reopened.source).toBe(nextSource)
  })

  it('materializes a Comment without another intrinsic parse', () => {
    const source = '{>># Note\n\nSee [inside][ref].\n\n[ref]: /local\n<<}'
    const core = createDocumentCore()
    const revision = core.open(source)
    const comment = revision.annotations[0]
    if (comment === undefined) throw new Error('Expected one Comment')
    const before = inspectDocumentCore(core).intrinsicSourceUnits

    core.projectComment(revision, comment)

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

  it('applies the logical-node guard before late nesting validation', () => {
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
      code: 'CM_RESOURCE_LOGICAL_NODES_EXCEEDED',
      range: { start: 98_305, end: 98_305 },
      metadata: { limit: '65536', observed: '65537' }
    })
  })

  it('bounds malformed-syntax diagnostics before publishing a revision', () => {
    const admitted = createDocumentCore().open('++}'.repeat(1_024))
    expect(admitted.diagnostics).toHaveLength(1_024)

    let rejection: unknown
    try {
      createDocumentCore().open('++}'.repeat(1_025))
    } catch (error) {
      rejection = error
    }
    expect(rejection).toBeInstanceOf(DocumentCoreError)
    expect(rejection).toMatchObject({
      code: 'CM_RESOURCE_LOGICAL_NODES_EXCEEDED',
      metadata: { limit: '1024', observed: '1025' }
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

  it('atomically applies exact source edits without a caller-built candidate', () => {
    const source = 'alpha {++beta++} omega\r\n'
    const core = createDocumentCore()
    const previous = core.open(source)
    const edit = Object.freeze({ start: 9, end: 13, insert: 'BETA' })
    const edits = Object.freeze([edit])

    const applied = core.apply(previous, edits)

    expect(applied.revision.source).toBe('alpha {++BETA++} omega\r\n')
    expect(applied.change.appliedEdits).toEqual([edit])
    expect(applied.change.appliedEdits).not.toBe(edits)
    expect(Object.isFrozen(applied)).toBe(true)
    expect(Object.isFrozen(applied.change)).toBe(true)
    expect(Object.isFrozen(applied.change.appliedEdits)).toBe(true)
    expect(Object.isFrozen(applied.change.appliedEdits[0])).toBe(true)
    expect(core.project(applied.revision, 'revised').markdown)
      .toBe('alpha BETA omega\r\n')

    const exactCore = createDocumentCore()
    const exact = exactCore.open('a\r\n😀b\r\nc')
    const exactApplied = exactCore.apply(exact, [{
      start: 5,
      end: 6,
      insert: 'B'
    }])
    expect(exactApplied.revision.source).toBe('a\r\n😀B\r\nc')
  })

  it('publishes nothing when an atomic apply is invalid or rejected', () => {
    const source = 'head\n\ntail\n'
    const core = createDocumentCore()
    const current = core.open(source)
    const before = observableRevision(core, current)

    expect(() => core.apply(current, [
      { start: 2, end: 5, insert: 'x' },
      { start: 4, end: 6, insert: 'y' }
    ])).toThrow(DocumentSourceEditError)
    for (const malformed of [
      undefined,
      null,
      [undefined],
      [{ start: 0, end: 0, insert: 42 }]
    ]) {
      expect(() => core.apply(current, malformed as never))
        .toThrow(DocumentSourceEditError)
    }

    const start = source.indexOf('tail')
    const depth = 16_385
    const overLimit = `${'{++'.repeat(depth)}x${'++}'.repeat(depth)}`
    expect(() => core.apply(current, [{
      start,
      end: start + 4,
      insert: overLimit
    }])).toThrow('CM_RESOURCE_LOGICAL_NODES_EXCEEDED')

    expect(observableRevision(core, current)).toEqual(before)
    const accepted = core.apply(current, [{
      start,
      end: start + 4,
      insert: 'TAIL'
    }])
    expect(accepted.revision.source).toBe('head\n\nTAIL\n')
  })

  it('reopens Comment projections with full-parse-equivalent products', () => {
    const source = '{>># Note\n\nSee [inside][ref].\n\n[ref]: /old\n<<}\n\ntail\n'
    const start = source.indexOf('/old')
    const edit = { start, end: start + 4, insert: '/new-path' }
    const nextSource =
      source.slice(0, edit.start) + edit.insert + source.slice(edit.end)
    const incrementalCore = createDocumentCore()
    const opened = incrementalCore.open(source)
    const openedComment = opened.annotations[0]
    if (openedComment === undefined) throw new Error('Expected old Comment')
    const openedProjection = incrementalCore.projectComment(
      opened,
      openedComment
    )

    const reopened = incrementalCore.reopen(opened, nextSource, [edit])
    const reopenedComment = reopened.annotations[0]
    const fullCore = createDocumentCore()
    const full = fullCore.open(nextSource)
    const fullComment = full.annotations[0]
    if (reopenedComment === undefined || fullComment === undefined) {
      throw new Error('Expected reopened Comments')
    }

    expect(observableComment(incrementalCore, reopened, reopenedComment))
      .toEqual(observableComment(fullCore, full, fullComment))
    expect(incrementalCore.projectComment(opened, openedComment))
      .toBe(openedProjection)
    expect(() => incrementalCore.projectComment(reopened, openedComment))
      .toThrow(/does not belong to this revision/)
    expect(incrementalCore.projectComment(reopened, reopenedComment).markdown)
      .toContain('/new-path')
  })

  it('merges partial apply options over the previous revision options', () => {
    const source = '[^a]: {++inside footnote++}\n'
    const core = createDocumentCore()
    const previous = core.open(source, {
      footnotes: true,
      gfm: false,
      frontMatter: false
    })
    const insert = 'tail\n'
    const nextSource = source + insert
    const reopened = core.apply(
      previous,
      [{ start: source.length, end: source.length, insert }],
      { markdown: { gfm: true } }
    ).revision

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
    }])).toThrow('CM_RESOURCE_LOGICAL_NODES_EXCEEDED')

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

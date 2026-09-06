import { createDocumentCore, type DocumentSourceEdit, type MarkupRegionProjectionChange } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import { applyMuyaMarkupChanges } from '@/documentAuthority/muyaMarkupChanges'

const fixture = (source: string, edit: DocumentSourceEdit) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const previous = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
  const commit = core.apply(revision, [edit], { projections: ['markup'] })
  const change = commit.change.projections[0]
  if (change?.name !== 'markup' || change.scope !== 'regions') throw new Error('Expected a real regional Core reply')
  const actual = applyMuyaMarkupChanges(previous, structuredClone(change))
  const expected = createMuyaMarkupView(core.project(commit.revision, 'markup'), commit.revision.annotations)
  return { actual, expected, previous, change }
}

describe('Applying Core Markup regions to an existing Muya view', () => {
  it('updates the first punctuated paragraph of a large plain document through a regional reply', () => {
    const source = ['Warm editing paragraph.', ...Array.from({ length: 1000 }, () =>
      'Writing a useful document takes careful editing and a clear view of the text.'
    )].join('\n\n') + '\n'
    const start = 'Warm editing paragraph.'.length
    const { actual, expected, previous } = fixture(source, { start, end: start, insert: ' More.' })
    expect(actual).toEqual(expected)
    expect(actual?.state[1000]).toBe(previous.state[1000])
    expect(actual?.bindings[1000].sourceRange.start).toBe(previous.bindings[1000].sourceRange.start + 6)
  })

  it('retains heterogeneous native blocks while replacing one paragraph region', () => {
    const source = 'first {++target++} paragraph\n\n# Heading\n\n- first\n- second **bold**\n\n> quoted\n\n```js\nconst answer = 42\n```\n\n$$\nx^2\n$$\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n---\n\ntail {==marked==}{>>note<<}\n'
    const start = source.indexOf('target') + 2
    const { actual, expected, previous } = fixture(source, { start, end: start, insert: 'NEW' })
    expect(actual).toEqual(expected)
    for (let index = 0; index < previous.state.length; index += 1) {
      if (index !== 0) expect(actual?.state[index]).toBe(previous.state[index])
    }
    expect(actual?.bindings.some(binding => binding.path.length > 2)).toBe(true)
  })

  it('retains a heading before the replacement and rebases nested suffix leaves', () => {
    const { change } = fixture('head\n\nsecond\n\ntail', { start: 8, end: 9, insert: 'LONG' })
    const core = createDocumentCore()
    // The replacement region has identical source/syntax coordinates; its
    // unrelated prefix and suffix are native structural blocks in this view.
    const before = core.open('# H\n\n\nsecond\n\n- tail\n- retained')
    const next = core.open('# H\n\n\nseLONGond\n\n- tail\n- retained')
    const previous = createMuyaMarkupView(core.project(before, 'markup'), before.annotations)
    const actual = applyMuyaMarkupChanges(previous, change)
    expect(actual).toEqual(createMuyaMarkupView(core.project(next, 'markup'), next.annotations))
    expect(actual?.state[0]).toBe(previous.state[0])
    expect(actual?.state[2]).toBe(previous.state[2])
    expect(actual?.bindings.at(-1)?.path).toEqual(previous.bindings.at(-1)?.path)
  })

  it('matches a fresh plain-paragraph view while retaining untouched native state objects', () => {
    const source = 'first\n\nsecond\n\nlast'
    const { actual, expected, previous } = fixture(source, { start: 7, end: 8, insert: 'expanded' })
    expect(actual).toEqual(expected)
    expect(actual?.state[0]).toBe(previous.state[0])
    expect(actual?.state[2]).toBe(previous.state[2])
    expect(actual?.bindings[2].sourceRange.start).toBe(previous.bindings[2].sourceRange.start + 7)
  })

  it('matches the full annotated view including marks, Core spelling ranges, and shifted suffix bindings', () => {
    const source = 'head\n\nbefore {++added text++} after\n\n**tail** &amp;'
    const start = source.indexOf('text')
    const { actual, expected, previous } = fixture(source, { start, end: start + 4, insert: 'TEXTS' })
    expect(actual).toEqual(expected)
    expect(actual?.state[2]).toBe(previous.state[2])
  })

  it('retains both substitution arms in a real regional edit', () => {
    const source = 'head\n\nbefore {~~old~>new~~} after\n\ntail'
    const start = source.indexOf('new')
    const { actual, expected } = fixture(source, { start, end: start + 1, insert: 'N' })
    expect(actual).toEqual(expected)
    expect(actual?.decorations.map(decoration => decoration.mark.kind === 'substitution' && decoration.mark.arm)).toEqual(['old', 'new'])
  })

  it('retains and shifts comment anchors outside the changed paragraph', () => {
    const { change } = fixture('head\n\nsecond\n\ntail', { start: 8, end: 9, insert: 'HEAD' })
    const core = createDocumentCore()
    const before = core.open('head\n\nsecond\n\ntail{>>note<<}')
    const next = core.open('head\n\nseHEADond\n\ntail{>>note<<}')
    const previous = createMuyaMarkupView(core.project(before, 'markup'), before.annotations)
    const expected = createMuyaMarkupView(core.project(next, 'markup'), next.annotations)
    const actual = applyMuyaMarkupChanges(previous, change)
    expect(actual).toEqual(expected)
    expect(actual?.comments[0].annotationRange.start).toBe(21)
  })

  it('consumes the real first-paragraph reply in a dense document with all five annotation forms', () => {
    const source = 'first target\n\n' + Array.from({ length: 20 }, (_, index) =>
      `Block ${index}: {++added++} {--removed--} {~~old~>new~~} {==marked==}{>>note<<}.\n\n`
    ).join('')
    const { actual, expected, previous } = fixture(source, { start: 8, end: 8, insert: 'more' })
    expect(actual).toEqual(expected)
    expect(actual?.comments).toHaveLength(20)
    expect(actual?.state[1]).toBe(previous.state[1])
  })

  it('updates paragraph ordinals without rebuilding untouched native states', () => {
    const core = createDocumentCore()
    const oldRevision = core.open('head\n\nsecond\n\ntail')
    const nextRevision = core.open('head\n\nsec\n\nond\n\ntail')
    const previous = createMuyaMarkupView(core.project(oldRevision, 'markup'))
    const projection = core.project(nextRevision, 'markup')
    // Exercise the portable contract with Core-produced AST/events. Current
    // Core admission falls back for Enter; this also covers future region admission.
    const change: MarkupRegionProjectionChange = {
      name: 'markup',
      scope: 'regions',
      replacements: [{
        previous: { source: { start: 6, end: 14 }, syntax: { start: 6, end: 14 }, events: { start: 1, end: 2 } },
        next: { source: { start: 6, end: 16 }, syntax: { start: 6, end: 16 }, events: { start: 1, end: 3 } },
        events: [{ kind: 'text', sourceRange: { start: 6, end: 16 }, text: 'sec\n\nond\n\n' }],
        syntaxBlocks: projection.syntax.ast.root.children.slice(1, 3),
        coordinates: [{ source: { start: 6, end: 16 }, projected: { start: 6, end: 16 } }]
      }]
    }
    const actual = applyMuyaMarkupChanges(previous, change)
    expect(actual).toEqual(createMuyaMarkupView(projection))
    expect(actual?.state[3]).toBe(previous.state[2])
    expect(actual?.bindings[3].path).toEqual([3, 'text'])

    const mixedBefore = core.open('# H\n\n\nsecond\n\n- tail\n- retained')
    const mixedNext = core.open('# H\n\n\nsec\n\nond\n\n- tail\n- retained')
    const mixedPrevious = createMuyaMarkupView(core.project(mixedBefore, 'markup'), mixedBefore.annotations)
    const mixedActual = applyMuyaMarkupChanges(mixedPrevious, change)
    expect(mixedActual).toEqual(createMuyaMarkupView(core.project(mixedNext, 'markup'), mixedNext.annotations))
    expect(mixedActual?.state[3]).toBe(mixedPrevious.state[2])
    expect(mixedActual?.bindings.at(-1)?.path).toEqual([3, 'children', 1, 'children', 0, 'text'])
  })

  it('requests the full-view fallback for unsupported structure and missing comment inventory', () => {
    const { previous, change } = fixture('head\n\nsecond\n\ntail', { start: 6, end: 7, insert: 'S' })
    const core = createDocumentCore()
    const nested = core.open('> head\n\nsecond\n\ntail')
    expect(applyMuyaMarkupChanges(createMuyaMarkupView(core.project(nested, 'markup')), change)).toBeUndefined()
    const withComment = core.open('head{>>note<<}\n\nsecond\n\ntail')
    expect(applyMuyaMarkupChanges(createMuyaMarkupView(core.project(withComment, 'markup'), withComment.annotations), change)).toBeUndefined()
    const replacement = change.replacements[0]
    expect(applyMuyaMarkupChanges(previous, {
      ...change,
      replacements: [{
        ...replacement,
        next: { ...replacement.next, source: { ...replacement.next.source, end: replacement.next.source.end + 10 } }
      }]
    })).toBeUndefined()
  })
})

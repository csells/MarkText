import { describe, expect, it } from 'vitest'
import {
  createDocumentCore,
  type CriticMarkupAnnotation,
  type DocumentCore,
  type DocumentProjectionName,
  type DocumentRevision
} from '../src/index.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'

// Plan 0012 G35: a revision reached by regional edits answers what the
// Review overview reads of its suggestions and Comments from the blocks
// around them, exactly as a fresh open of its source does, without parsing
// the whole document again.

const dense =
  'Review {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, ' +
  'and {==a *claim*==}{>>Check **this** {++source++}.<<}.'
const others = [
  '{=={--only deleted--}==}{>>nothing kept<<} and {====}{>>empty<<}.',
  '- item {==listed==}{>>in a list<<}\n- item {--two--}',
  '> quoted {~~a~>b~~} and {>>a *note*<<}',
  '# Heading {++added++}'
]

const allAnnotations = (roots: readonly CriticMarkupAnnotation[]): CriticMarkupAnnotation[] => {
  const all: CriticMarkupAnnotation[] = []
  const pending = [...roots].reverse()
  while (pending.length > 0) {
    const annotation = pending.pop()!
    all.push(annotation)
    for (const arm of [...annotation.arms].reverse()) pending.push(...[...arm.annotations].reverse())
  }
  return all
}

const reads = (core: DocumentCore, revision: DocumentRevision, annotations: readonly CriticMarkupAnnotation[]) =>
  annotations.map((annotation) => ({
    range: annotation.range,
    arms: annotation.arms.map((arm) => (['original', 'revised', 'markup'] as DocumentProjectionName[])
      .map((name) => core.intersectsProjection(revision, name, arm.range))),
    ...(annotation.kind === 'comment'
      ? (() => {
        const { annotationRange, syntax } = core.projectComment(revision, annotation, 'markup')
        const payload = annotation.arms[0]!.range
        return {
          annotationRange,
          ast: syntax.ast,
          projected: [payload.start, payload.end].flatMap((position) => [
            syntax.coordinates.toProjected(position, 'previous'),
            syntax.coordinates.toProjected(position, 'next')
          ]),
          source: syntax.coordinates.sourceSegments
        }
      })()
      : {})
  }))

describe('Regional review reads', () => {
  it('read suggestions and Comments around an edit as a fresh open does, without a document parse', () => {
    const source = ['Opening paragraph.', ...Array.from({ length: 120 }, (_, index) =>
      index % 5 === 4 ? others[Math.floor(index / 5) % others.length]! : dense)].join('\n\n') + '\n'
    const core = createDocumentCore()
    let revision = core.open(source)
    core.project(revision, 'markup')
    const edits: ReadonlyArray<readonly [(text: string) => number, string]> = [
      [() => 5, 'x'],
      [(text) => text.indexOf('alongside', 2000), 'y'],
      [(text) => text.lastIndexOf('alongside'), 'z']
    ]
    for (const [find, insert] of edits) {
      const at = find(revision.source)
      const commit = core.apply(revision, [{ start: at, end: at, insert }], { projections: ['markup'] })
      expect(commit.change.projections[0]).toMatchObject({ name: 'markup', scope: 'regions' })
      revision = commit.revision
    }
    const middle = revision.source.lastIndexOf('nothing')
    const near = allAnnotations(revision.annotations).filter((annotation) =>
      annotation.range.start > middle - 2000 && annotation.range.end < middle + 2000)
    expect(near.length).toBeGreaterThan(40)
    const before = inspectDocumentCore(core).documentParses
    const regional = reads(core, revision, near)
    expect(inspectDocumentCore(core).documentParses).toBe(before)

    const fresh = createDocumentCore()
    const opened = fresh.open(revision.source)
    const freshNear = allAnnotations(opened.annotations).filter((annotation) =>
      annotation.range.start > middle - 2000 && annotation.range.end < middle + 2000)
    expect(regional).toEqual(reads(fresh, opened, freshNear))
  })

  it('project a Comment that a regional reply describes', () => {
    const core = createDocumentCore()
    const opened = core.open('Plain.\n\nText {==here==}{>>note<<}.\n')
    const commit = core.apply(opened, [{ start: 3, end: 3, insert: 'x' }], { projections: ['markup'] })
    const change = commit.change.projections.find((projection) => projection.name === 'markup')
    expect(change?.scope).toBe('regions')
    // The revision holds its document parse once projected; the reply's
    // Comment is found in it by its range.
    core.project(commit.revision, 'markup')
    const [comment] = allAnnotations(commit.revision.annotations).filter((annotation) => annotation.kind === 'comment')
    const described = { ...comment!, arms: comment!.arms.map((arm) => ({ ...arm })) }
    expect(core.projectComment(commit.revision, described, 'markup').syntax.ast)
      .toEqual(core.projectComment(commit.revision, comment!, 'markup').syntax.ast)
  })
})

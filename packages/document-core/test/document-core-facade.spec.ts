import { describe, expect, it } from 'vitest'

import {
  createDocumentCore,
  DocumentCoreError,
  type DocumentCore,
  type DocumentRevision
} from '../src/index.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'

function observableRevision(
  core: DocumentCore,
  revision: DocumentRevision
): unknown {
  return {
    source: revision.source,
    annotations: revision.annotations,
    diagnostics: revision.diagnostics,
    original: core.project(revision, 'original').markdown,
    revised: core.project(revision, 'revised').markdown
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

    expect(core.project(revision, 'original').markdown).toBe('keep  drop old mark ')
    expect(core.project(revision, 'revised').markdown).toBe('keep add  new mark ')
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
    const before = inspectDocumentCore(incrementalCore).intrinsicSourceUnits
    const reopened = incrementalCore.reopen(opened, nextSource, edits)
    const spent =
      inspectDocumentCore(incrementalCore).intrinsicSourceUnits - before
    const fullCore = createDocumentCore()
    const full = fullCore.open(nextSource)
    const fullSpent = inspectDocumentCore(fullCore).intrinsicSourceUnits

    expect(observableRevision(incrementalCore, reopened))
      .toEqual(observableRevision(fullCore, full))
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

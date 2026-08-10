import { describe, expect, it } from 'vitest'

import { createDocumentCore } from '../src/index.js'

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

    expect(() => createDocumentCore().open(source))
      .toThrow('CM_RESOURCE_CM_DEPTH_EXCEEDED')
  })
})

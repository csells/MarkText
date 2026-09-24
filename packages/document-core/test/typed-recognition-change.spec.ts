import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

const typeAt = (source: string, at: number, typed: string, tracked = false) => {
  const core = createDocumentCore()
  let revision: DocumentRevision = core.open(source)
  let caret = at
  for (const data of typed) {
    const action: DocumentInputAction = {
      selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
      range: { start: caret, end: caret },
      inputType: 'insertText',
      data,
      options
    }
    const plan = core.planInput(revision, action)
    const edits = core.inputEdits(revision, action, plan, tracked)
    if (edits === undefined) throw new Error(`Typing ${JSON.stringify(data)} was refused`)
    const commit = core.apply(revision, edits)
    const selection = core.reconcileInput(revision, plan, commit, action).selection
    if (selection === undefined || !('ranges' in selection)) throw new Error('Expected a text selection')
    caret = selection.ranges[selection.primary]!.focus
    revision = commit.revision
  }
  return { core, revision, caret }
}

// Upstream MarkText inserts these bytes; the language then gives them their
// ordinary meaning, which may make the adjacent annotation literal.
describe('typed Markdown that changes annotation recognition', () => {
  it.each([
    { source: '{++add++} tail\n', at: 0, typed: '```', expected: '```{++add++} tail\n', caret: 3 },
    { source: '{~~old~>new~~} tail\n', at: 0, typed: '```', expected: '```{~~old~>new~~} tail\n', caret: 3 },
    { source: '{==hi==} tail\n', at: 0, typed: '    ', expected: '    {==hi==} tail\n', caret: 4 },
    { source: '{--del--} tail\n', at: 0, typed: '<div>', expected: '<div>{--del--} tail\n', caret: 5 },
    { source: '{++add++} tail\n', at: 0, typed: '~~', expected: '~~~~{++add++} tail\n', caret: 2 },
    { source: 'lead {++add++} tail\n', at: 5, typed: '\\', expected: 'lead \\{++add++} tail\n', caret: 6 },
    { source: '{++add++} tail\n', at: 3, typed: '```', expected: '{++```add++} tail\n', caret: 6 }
  ])('admits $typed at $at of $source', ({ source, at, typed, expected, caret }) => {
    const typedResult = typeAt(source, at, typed)
    expect(typedResult.revision.source).toBe(expected)
    expect(typedResult.caret).toBe(caret)
    expect(createDocumentCore().open(expected).source).toBe(expected)
  })

  it('keeps refusing the same recognition change outside direct typing', () => {
    const core = createDocumentCore()
    const revision = core.open('{++add++} tail\n')
    expect(core.markupEdits(revision, [{ start: 0, end: 0, insert: '```' }])).toBeUndefined()
  })

  it('forms CriticMarkup typed key by key, as typed emphasis forms', () => {
    const { revision } = typeAt('lead tail\n', 5, '{++x++}')
    expect(revision.source).toBe('lead {++x++}tail\n')
    expect(revision.annotations).toMatchObject([{ kind: 'addition', range: { start: 5, end: 12 } }])
  })
})

describe('tracked typing of a brace before the addition closer', () => {
  it.each([
    { source: 'plain tail\n', at: 0, expected: '{++{++}plain tail\n', original: 'plain tail\n', revised: '{plain tail\n' },
    { source: '{==hi==} tail\n', at: 0, expected: '{++{++}{==hi==} tail\n', original: 'hi tail\n', revised: '{hi tail\n' }
  ])('suggests the brace at $at of $source', ({ source, at, expected, original, revised }) => {
    const { core, revision } = typeAt(source, at, '{', true)
    expect(revision.source).toBe(expected)
    expect(revision.diagnostics).toEqual([])
    expect(core.project(revision, 'original').markdown).toBe(original)
    expect(core.project(revision, 'revised').markdown).toBe(revised)
  })

  it('does not report the payload brace as an unclosed opener', () => {
    const revision = createDocumentCore().open('{++{++}\n')
    expect(revision.annotations).toMatchObject([{ kind: 'addition', range: { start: 0, end: 7 } }])
    expect(revision.diagnostics).toEqual([])
    expect(createDocumentCore().open('a {++} b\n').diagnostics.map(diagnostic => diagnostic.code))
      .toEqual(['CM_UNTERMINATED_OPENER', 'CM_UNMATCHED_CLOSER'])
  })
})

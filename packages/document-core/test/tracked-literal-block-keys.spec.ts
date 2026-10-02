import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'

// A tracked key in a code, math or HTML block suggests replacing the whole
// block, as its text reads literally. The keys after it edit that
// Substitution: typing in its struck old block edits the proposed block at
// the same place, Enter keeps the block's own indentation, and each key
// reparses only the Substitution's region, never the document.

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

interface Session {
  readonly core: DocumentCore
  revision: DocumentRevision
  caret: number
}

type Key = Readonly<{ inputType: 'insertText', data: string } | { inputType: 'insertParagraph' | 'deleteContentBackward' }>

const press = (session: Session, key: Key): Readonly<{ parses: number, regionUnits: number, scope: string | undefined }> => {
  const { core, revision, caret } = session
  const action = {
    range: key.inputType === 'deleteContentBackward' ? { start: caret - 1, end: caret } : { start: caret, end: caret },
    selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
    inputType: key.inputType,
    data: 'data' in key ? key.data : null,
    options
  } as DocumentInputAction
  const before = inspectDocumentCore(core)
  const plan = core.planInput(revision, action, { tracked: true })
  const edits = core.inputEdits(revision, action, plan, true)
  if (edits === undefined) throw new Error(`${key.inputType} was refused`)
  const commit = core.apply(revision, edits, { projections: ['markup'] })
  const result = core.reconcileInput(revision, plan, commit, action)
  const after = inspectDocumentCore(core)
  const fresh = createDocumentCore().open(commit.revision.source)
  expect(commit.revision.annotations).toEqual(fresh.annotations)
  session.revision = commit.revision
  const selection = result.selection
  if (selection === undefined || !('ranges' in selection)) throw new Error('Expected a text selection')
  session.caret = selection.ranges[selection.primary]?.focus ?? session.caret
  return {
    parses: after.documentParses - before.documentParses,
    regionUnits: after.regionalIntrinsicSourceUnits - before.regionalIntrinsicSourceUnits,
    scope: commit.change.projections[0]?.scope
  }
}

const blocks = {
  fence: (lines: readonly string[]) => ['```js', ...lines, '```'].join('\n'),
  math: (lines: readonly string[]) => ['$$', ...lines, '$$'].join('\n'),
  html: (lines: readonly string[]) => ['<div>', ...lines, '</div>'].join('\n'),
  indented: (lines: readonly string[]) => lines.map(line => `    ${line}`).join('\n')
}

const documentWith = (block: string): string => `Opening paragraph.\n\n${block}\n\nClosing paragraph.\n`

describe('tracked keys in a literal block', () => {
  it.each(Object.entries(blocks))('types in the struck old %s into its proposed block', (_name, block) => {
    const source = documentWith(block(['const a = 1', 'const b = 2', 'const c = 3']))
    const core = createDocumentCore()
    const session: Session = { core, revision: core.open(source), caret: source.indexOf('b = 2') }
    press(session, { inputType: 'insertText', data: 'x' })
    const substitution = session.revision.annotations[0]
    const old = substitution?.arms.find(arm => arm.name === 'old')
    if (substitution?.kind !== 'substitution' || old === undefined) throw new Error('Expected a Substitution')
    // Place the caret in the struck block, at the typed line's `b`.
    session.caret = session.revision.source.indexOf('b = 2', old.range.start)
    expect(session.caret).toBeLessThan(old.range.end)
    press(session, { inputType: 'insertText', data: 'y' })
    press(session, { inputType: 'insertText', data: 'z' })
    const next = session.revision.annotations[0]?.arms.find(arm => arm.name === 'new')
    if (next === undefined) throw new Error('Expected the proposed block')
    const proposed = session.revision.source.slice(next.range.start, next.range.end)
    expect(proposed).toContain('const yzxb = 2')
    // The caret follows the typed text into the proposed block.
    expect(session.revision.source.slice(session.caret - 2, session.caret + 2)).toBe('yzxb')
    const struck = session.revision.source.slice(old.range.start, old.range.end)
    expect(struck).toContain('const b = 2')
  })

  it('continues a line of a proposed fence without the separator before it', () => {
    const source = documentWith(blocks.fence(['const a = 1', 'const b = 2']))
    const core = createDocumentCore()
    const session: Session = { core, revision: core.open(source), caret: source.indexOf('b = 2') }
    press(session, { inputType: 'insertText', data: 'x' })
    press(session, { inputType: 'insertParagraph' })
    const next = session.revision.annotations[0]?.arms.find(arm => arm.name === 'new')
    if (next === undefined) throw new Error('Expected the proposed block')
    expect(session.revision.source.slice(next.range.start, next.range.end)).toBe('```js\nconst a = 1\nconst x\nb = 2\n```\n')
  })

  it.each(Object.entries(blocks))('suggests replacing a long %s without a document parse', (_name, block) => {
    const lines = Array.from({ length: 400 }, (_, index) => `const value${index} = compute(${index})`)
    const opening = 'Opening paragraph.\n\n' + Array.from({ length: 200 }, (_, index) => `Paragraph ${index} of the long document.`).join('\n\n')
    const source = `${opening}\n\n${block(lines)}\n\nClosing paragraph.\n`
    const core = createDocumentCore()
    const session: Session = { core, revision: core.open(source), caret: source.indexOf('value200 =') }
    const first = press(session, { inputType: 'insertText', data: 'x' })
    expect(first.parses).toBe(0)
    expect(first.scope).toBe('regions')
    const substitution = session.revision.annotations[0]
    if (substitution?.kind !== 'substitution') throw new Error('Expected a Substitution')
    // The Substitution's two blocks, and none of the paragraphs before them.
    expect(first.regionUnits).toBeLessThanOrEqual(4 * (substitution.range.end - substitution.range.start))
  })

  it.each(Object.entries(blocks))('reads each later key in a 2,000-line %s from the lines around it', (_name, block) => {
    const lines = Array.from({ length: 2000 }, (_, index) => `const value${index} = compute(${index})`)
    const source = documentWith(block(lines))
    const core = createDocumentCore()
    const session: Session = { core, revision: core.open(source), caret: source.indexOf('value1000 =') }
    press(session, { inputType: 'insertText', data: 'x' })
    const keys: Key[] = [
      { inputType: 'insertText', data: 'y' },
      { inputType: 'insertText', data: 'z' },
      { inputType: 'insertParagraph' },
      { inputType: 'insertText', data: 'w' },
      { inputType: 'deleteContentBackward' },
      { inputType: 'insertText', data: 'v' }
    ]
    for (const key of keys) {
      const cost = press(session, key)
      expect(cost.parses).toBe(0)
      expect(cost.scope).toBe('regions')
      // A few lines of the block, not the Substitution's 4,000.
      expect(cost.regionUnits).toBeLessThan(1000)
    }
  }, 60_000)

  it.each(Object.entries(blocks))('reparses only the Substitution of a long %s for each later key', (_name, block) => {
    const lines = Array.from({ length: 400 }, (_, index) => `const value${index} = compute(${index})`)
    const opening = 'Opening paragraph.\n\n' + Array.from({ length: 200 }, (_, index) => `Paragraph ${index} of the long document.`).join('\n\n')
    const source = `${opening}\n\n${block(lines)}\n\nClosing paragraph.\n`
    const core = createDocumentCore()
    const session: Session = { core, revision: core.open(source), caret: source.indexOf('value200 =') }
    press(session, { inputType: 'insertText', data: 'x' })
    const keys: Key[] = [
      { inputType: 'insertText', data: 'y' },
      { inputType: 'insertText', data: 'z' },
      { inputType: 'insertParagraph' },
      { inputType: 'insertText', data: 'w' },
      { inputType: 'deleteContentBackward' }
    ]
    for (const key of keys) {
      const substitution = session.revision.annotations[0]
      if (substitution === undefined) throw new Error('Expected the Substitution')
      const cost = press(session, key)
      expect(cost.parses).toBe(0)
      expect(cost.scope).toBe('regions')
      // One parse of the Substitution's blocks, and of none of the paragraphs before it.
      expect(cost.regionUnits).toBeLessThanOrEqual(2 * (substitution.range.end - substitution.range.start) + 200)
    }
  })
})

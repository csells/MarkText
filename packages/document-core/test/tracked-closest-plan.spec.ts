import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'
import { resolvedSuggestions } from '../src/trackedExtent.js'

// Vision principle 7: any edit that can be made untracked can be made
// tracked. A `$$` typed in an Addition that pairs with the `$$` opening the
// document reads as no edit of the markup, and no narrower suggestion spells
// it: the document's own compile spells it with its closest suggestion, the
// whole math block, which Accept All and Reject All resolve exactly, and
// leaves the caret after the typed text (B17). Each arm reads its `$$` alone
// on its line as display math, as the document does, and holds the math's
// text byte for byte, its marker spellings unescaped.
const source = '$$\n\n{++x\n\nw++}\n\n\ny\n$$~~}\n'
const typed = source.slice(0, 8) + '$$' + source.slice(8)
// The text around the key it suggests replacing, whole, by the text typed.
const closest = { start: 0, end: 21 }
const old = source.slice(closest.start, closest.end)
const proposed = typed.slice(closest.start, closest.end + 2)
const spelled = `{~~${old}~>${proposed}~~}`

describe('a tracked key no narrower suggestion spells', () => {
  it('is planned by the document with its closest spelling', () => {
    const core = createDocumentCore()
    const opened = core.open(source)
    expect(core.trackedEdit(opened, { start: 8, end: 8, insert: '$$' })).toEqual({ ...closest, insert: spelled })
  })

  it('resolves exactly under Accept All and Reject All', () => {
    // Accept All keeps the new arm and Reject All the old one, byte for byte.
    expect(source.slice(0, closest.start) + proposed + source.slice(closest.end)).toBe(typed)
    expect(source.slice(0, closest.start) + old + source.slice(closest.end)).toBe(source)
  })

  it('is typed with the caret after the typed text', () => {
    const core = createDocumentCore()
    const opened = core.open(source)
    const action = {
      range: { start: 8, end: 8 },
      selection: { ranges: [{ anchor: 8, focus: 8 }], primary: 0 },
      inputType: 'insertText',
      data: '$$',
      options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
    } as const
    const plan = core.planInput(opened, action, { tracked: true })
    const edits = core.inputEdits(opened, action, plan, true)
    const [edit] = edits ?? []
    if (edit === undefined) throw new Error('Expected a tracked plan')
    // The text around the key, suggested replaced by the text as typed.
    const around = source.slice(edit.start, edit.end)
    const deletion = edit.insert.startsWith('{~~') ? `{~~${around}~>` : `{--${around}--}{++`
    expect(edit.insert).toBe(`${deletion}${typed.slice(edit.start, edit.end + 2)}${edit.insert.startsWith('{~~') ? '~~}' : '++}'}`)
    const commit = core.apply(opened, [edit])
    const result = core.reconcileInput(opened, plan, commit, action)
    const caret = result.selection !== undefined && 'ranges' in result.selection ? result.selection.ranges[0] : undefined
    // After `$$` in the proposed text.
    const after = edit.start + deletion.length + (8 - edit.start) + 2
    expect(caret).toEqual({ anchor: after, focus: after })
  })
})

// Backspace after the line break below a lone `$$` changes no text: the plan
// only moves the caret. Tracked, as untracked, that is no edit (B17), not an
// operation Core leaves unplanned.
describe('a tracked key that changes no text', () => {
  it('is planned as no edit, as it is untracked', () => {
    const backspace = {
      range: { start: 2, end: 3 },
      selection: { ranges: [{ anchor: 3, focus: 3 }], primary: 0 },
      inputType: 'deleteContentBackward',
      data: null,
      options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
    } as const
    const document = '$$\n\n{++x\n\n\n++}\n\n\ny\n$$~~}\n'
    for (const tracked of [false, true]) {
      const core = createDocumentCore()
      const opened = core.open(document)
      const plan = core.planInput(opened, backspace, { tracked })
      expect(plan.edits.every(edit => document.slice(edit.start, edit.end) === edit.insert)).toBe(true)
      expect(core.inputEdits(opened, backspace, plan, tracked)).toEqual([])
    }
  })
})

// Literal content is its text byte for byte: a spelling that escapes a marker
// spelling inside math or code changes that text, though the views may read
// the two alike, so it is no spelling of the key. Each key here is recorded
// with the literal as typed, and Accept All gives the typed text exactly.
describe('a tracked key in literal content holding marker spellings', () => {
  const accepted = (text: string): string => {
    const core = createDocumentCore()
    const revision = core.open(text)
    return resolvedSuggestions(revision.source, revision.annotations, 'accept')
  }
  it.each([
    ['$$\n\n{++x\n\nw++}\n\n\ny\n$$~~}\n', 4, '$$'],
    ['$$\n\n{++x\n\nw++}\n\n\ny\n$$~~}\n', 8, '$$'],
    ['$$\n\n{++x\n\n\n++}\n\n\ny\n$$~~}\n', 5, '$$'],
    ['$$\n\n{++x\n\n\n++}\n\n\ny\n$$~~}\n', 6, '$$'],
    ['Text `a {++ b` here {++x++}.\n', 8, 'z'],
    ['Para {++x++}.\n\n```\ncode {-- here\n```\n', 24, 'z']
  ])('keeps the literal as typed in %j at %i', (source, at, insert) => {
    const core = createDocumentCore()
    const opened = core.open(source)
    const planned = core.trackedEdit(opened, { start: at, end: at, insert })
    if (planned === undefined) throw new Error('Expected a tracked plan')
    const next = core.apply(opened, [planned]).revision
    expect(accepted(next.source)).toBe(accepted(source.slice(0, at) + insert + source.slice(at)))
    expect(resolvedSuggestions(next.source, next.annotations, 'reject')).toBe(resolvedSuggestions(opened.source, opened.annotations, 'reject'))
  })
})

// Deleting the escape that keeps `{--` literal inside an Addition makes that
// `{--` an unfinished opener: no record of the deletion leaves the Addition
// whole, so it is applied as typed, and the parser reports the opener (owner
// decision, 9 October 2026: always apply). Profile 1 V3 governs render-safe
// materialization of views, not the user's keystrokes.
describe('a tracked keystroke no record can hold', () => {
  it('is applied as typed', () => {
    const document = 'a{++\\{--x++}b\n'
    const core = createDocumentCore()
    const opened = core.open(document)
    const action = {
      range: { start: 4, end: 5 },
      selection: { ranges: [{ anchor: 5, focus: 5 }], primary: 0 },
      inputType: 'deleteContentBackward',
      data: null,
      options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
    } as const
    const plan = core.planInput(opened, action, { tracked: true })
    const edits = core.inputEdits(opened, action, plan, true)
    expect(edits).toEqual([{ start: 4, end: 5, insert: '' }])
    expect(core.apply(opened, edits ?? []).revision.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['CM_UNTERMINATED_OPENER'])
  })
})

import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

// Vision principle 7: any edit that can be made untracked can be made
// tracked. A `$$` typed in an Addition that pairs with the `$$` opening the
// document reads as no edit of the markup, and no narrower suggestion spells
// it: the document's own compile spells it with its closest suggestion, the
// whole math block, which Accept All and Reject All resolve exactly, and
// leaves the caret after the typed text (B17). Each arm opens with the `$$`
// alone on its line, so each reads the block as display math, as the
// document does.
const source = '$$\n\n{++x\n\nw++}\n\n\ny\n$$~~}\n'
const typed = source.slice(0, 8) + '$$' + source.slice(8)
// The text around the key it suggests replacing, whole, by the text typed.
const closest = { start: 0, end: 21 }
const old = source.slice(closest.start, closest.end)
const proposed = typed.slice(closest.start, closest.end + 2)
// The typed text reads the Addition's marker spellings as text, which the
// proposed arm escapes.
const escapeMarkers = (text: string): string => text.replace('{++', '\\{++').replace('++}', '\\++}')
const spelled = `{~~${old}~>${escapeMarkers(proposed)}~~}`

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
    expect(edit.insert).toBe(`${deletion}${escapeMarkers(typed.slice(edit.start, edit.end + 2))}${edit.insert.startsWith('{~~') ? '~~}' : '++}'}`)
    const commit = core.apply(opened, [edit])
    const result = core.reconcileInput(opened, plan, commit, action)
    const caret = result.selection !== undefined && 'ranges' in result.selection ? result.selection.ranges[0] : undefined
    // After `$$` in the proposed text, past the escape before it.
    const after = edit.start + deletion.length + escapeMarkers(typed.slice(edit.start, 8)).length + 2
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

import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

// Every keystroke is applied, with Track Changes on or off (owner decision,
// 9 October 2026: always apply). A keystroke the markup compile cannot read
// as an edit of the markup is applied as typed: a suggestion's markers it
// breaks read as plain text, and the parser reports what it reads. Profile 1
// V3 governs render-safe materialization of views, not the user's keystrokes.
const backspace = (caret: number): DocumentInputAction => ({
  range: { start: caret - 1, end: caret },
  selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
  inputType: 'deleteContentBackward',
  data: null,
  options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
})

describe('a keystroke that breaks a suggestion\'s markers', () => {
  it.each([
    { name: 'the escape keeping `{--` literal in an Addition', source: 'a{++\\{--x++}b\n', caret: 5, code: 'CM_UNTERMINATED_OPENER' },
    { name: 'a Substitution\'s closer', source: 'Text {~~old~>new~~} end.\n', caret: 19, code: 'CM_UNTERMINATED_OPENER' }
  ])('is applied as typed untracked: $name', ({ source, caret, code }) => {
    const core = createDocumentCore()
    const opened = core.open(source)
    const action = backspace(caret)
    const plan = core.planInput(opened, action, { tracked: false })
    const edits = core.inputEdits(opened, action, plan, false)
    expect(edits).toEqual(plan.edits)
    const next = core.apply(opened, edits ?? []).revision
    expect(next.source).toBe(source.slice(0, caret - 1) + source.slice(caret))
    expect(next.diagnostics.map(diagnostic => diagnostic.code)).toContain(code)
  })
})

import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

// Plan 0012, 5 October (key 117/9 of the input sweep): a fenced block whose
// projected content is empty beside elided markers mapped its content's
// start forward and its end back across them, past each other, and Enter
// or Tab there threw slicing the inverted range. A planner never throws on
// a valid document.

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

describe('a literal block whose content is empty beside elided markers', () => {
  // Minimized from key 117/9; Enter at 19 threw.
  const source = '{~~\n```\n~~}\n{--```\n--}{++++}{--```\n--}'

  it.each(['insertParagraph', 'insertLineBreak', 'insertTab'] as const)('plans %s at every caret, tracked or not', inputType => {
    for (let caret = 0; caret <= source.length; caret += 1) {
      for (const tracked of [false, true]) {
        const core = createDocumentCore()
        const revision = core.open(source)
        const input = {
          range: { start: caret, end: caret },
          selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
          inputType,
          data: null,
          options
        } as DocumentInputAction
        const label = `${inputType} at ${String(caret)}${tracked ? ', tracked' : ''}`
        const edits = core.inputEdits(revision, input, core.planInput(revision, input, { tracked }), tracked)
        for (const edit of edits ?? []) {
          expect(edit.start, label).toBeGreaterThanOrEqual(0)
          expect(edit.end, label).toBeLessThanOrEqual(source.length)
          expect(edit.start, label).toBeLessThanOrEqual(edit.end)
        }
      }
    }
  })
})

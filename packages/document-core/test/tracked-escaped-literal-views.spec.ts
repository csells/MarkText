import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentInputAction } from '../src/index.js'
import { planFromDocumentParse } from '../src/internal/documentCoreInspection.js'
import { regionalRevision } from './support/inputDriver.js'

// A tracked candidate whose views differ in their bytes from the untracked
// result's is still taken where its projections read alike. The Revised
// projection is compared with the untracked result's projection, not with a
// parse of the Revised Markdown: that Markdown escapes delimiters a literal
// block holds, which a parse then reads as part of the literal.

describe('a tracked key beside a literal block whose Revised text is escaped', () => {
  it('is read alike in a window and the document', () => {
    const source = '{~~$$\nx\ny\n$$~>$$\nx\nzy\n$$~~}\n\nA paragraph of ordinary words.\n\nText with {++added++} inside.\n\n' +
      '{~~<div>\nh\n</div>~><div>\nhz\n</div>~~}\n\n$$\nx_{0} + y\nx_{1} + y\nx_{2} + y\nx_{3} + y\nx_{4} + y\n$$\n'
    // Typing `q` into the first opener leaves its closer a stray `~~}`.
    const plan = (core: DocumentCore) => {
      const revision = regionalRevision(core, source)
      const caret = revision.source.indexOf('~~}') + 1
      const input = {
        range: { start: caret, end: caret },
        selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
        inputType: 'insertText',
        data: 'x',
        options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
      } as DocumentInputAction
      return { caret, edits: core.inputEdits(revision, input, core.planInput(revision, input, { tracked: true }), true) }
    }
    const control = createDocumentCore()
    planFromDocumentParse(control)
    const windowed = plan(createDocumentCore())
    expect(windowed).toEqual(plan(control))
    expect(windowed.edits).toEqual([{ start: windowed.caret, end: windowed.caret, insert: '{++x++}' }])
  })
})

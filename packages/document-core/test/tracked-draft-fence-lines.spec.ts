import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'
import { planFromDocumentParse } from '../src/internal/documentCoreInspection.js'

// A tracked edit spells only whole suggestions, so it never adds a
// diagnostic, and an edit inside one's own suggestion is that edit in the arm
// where accepting the suggestion alone would read its fence line otherwise.

describe('tracked edits in a suggestion whose arm opens a fence', () => {
  it('takes Enter in a proposed fenced block as typed when text before the Substitution joins its fence line', () => {
    const source = 'x{~~```\nold\n```\n~>```\nnq\n\nqqw\n```\n~~}\n\nReview {++n\n\nqew evidence++} alongside {--obsolet details--}, ' +
      '{~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.\n\n{~~```\nold\n```\n~>```q\nnqew\n`\n``\n~~}\n'
    const core = createDocumentCore()
    const revision = core.open(source)
    const at = source.indexOf('nq\n') + 2
    const edit = core.trackedEdit(revision, { start: at, end: at, insert: '\n' })
    expect(edit).toEqual({ start: at, end: at, insert: '\n' })
    expect(core.apply(revision, [edit!]).revision.diagnostics).toEqual(revision.diagnostics)
  })

  // A plan of several edits is spelled from the literals its suggestions
  // reach, so Enter writes the same suggestions whatever literal blocks the
  // document holds elsewhere.
  it('plans Enter beside a fence alike before and without a later Substitution of indented code', () => {
    const head = '{q--```\ngone 0\ngone 1\ngone 2\ngone 3\ngon{--e--} 4\n```\n--}\n\n{--```\ngone 0\ngone 1\ngone 2\ngone 3\ngone 4\n```\n--}\n\n$$\nz_0\nz_1\nz_2\nz_3\n$$\n\n    plain indented 0\n    plain indented 1\n    plain indented 2\n    plain indented 3\n    plain indented 4\n\n'
    const tail = '{~~    old indented 0\n    old indented 1\n    old indented 2\n    old indented 3\n    old indented 4\n~>    new indented 0\n    new indented 1\n    new indented 2\n    new indented 3\n    new indented 4\n~~}\n'
    const plan = (source: string, documentParse: boolean) => {
      const core = createDocumentCore()
      if (documentParse) planFromDocumentParse(core)
      const revision = core.apply(core.open(source), [{ start: 0, end: 0, insert: '' }], { projections: ['markup'] }).revision
      const input = {
        range: { start: 46, end: 46 },
        selection: { ranges: [{ anchor: 46, focus: 46 }], primary: 0 },
        inputType: 'insertParagraph',
        data: null,
        options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
      } as DocumentInputAction
      return core.inputEdits(revision, input, core.planInput(revision, input, { tracked: true }), true)
    }
    const local = plan(head, true)
    expect(plan(head + tail, true)).toEqual(local)
    expect(plan(head + tail, false)).toEqual(local)
  })
})

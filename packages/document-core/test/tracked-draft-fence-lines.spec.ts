import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

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
})

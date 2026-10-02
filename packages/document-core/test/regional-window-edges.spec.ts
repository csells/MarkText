import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'
import { planFromDocumentParse } from '../src/internal/documentCoreInspection.js'

// A tracked key compiled in a window of the document is taken from the window
// only where blank lines part the window from the blocks around it: a block
// the document runs straight into after the window can take in what the key
// writes at its edge, so the window's untracked result is not the document's.

/** A revision reached by a regional edit, so it holds no document parse. */
function regional(core: DocumentCore, source: string): DocumentRevision {
  return core.apply(core.open(source), [{ start: 1, end: 1, insert: 'q' }], { projections: ['markup'] }).revision
}

function cores(): readonly [DocumentCore, DocumentCore] {
  const control = createDocumentCore()
  planFromDocumentParse(control)
  return [createDocumentCore(), control]
}

describe('tracked keys at a window edge without a blank line', () => {
  it('reads typing after a Substitution of an HTML block that a block follows directly', () => {
    const source = '| a | b |\n| --- | --- |\n| {++c++} | d {--e--} |\n\n| a | b |\n| --- | --- |\n| {++c++} | d {--e--} |\n\n' +
      '{~~<div>\nhtml {++x++} block\n</div>\n~><div>\nhtm {++x++} block\n</div>\n~~}\n<div>\nhtml {++x++} block\n</div>\n'
    const [core, control] = cores()
    const revision = regional(core, source)
    const controlRevision = regional(control, source)
    const start = revision.source.indexOf('~~}\n<div>') + 3
    const edit = { start, end: start, insert: 'x' }
    expect(core.trackedEdit(revision, edit)).toEqual(control.trackedEdit(controlRevision, edit))
  })

  it('reads Enter in an HTML block a Substitution proposes, before a block it runs into', () => {
    const source = '{q~~<div>\no{~~{--l--}d html 0\nold html 1\nold html 2\nold html 3\nold html 4~>\n\n{--l--}d html 0\n' +
      'old html 1\nold html 2\nold html 3\nold html 4\n~~}\n</div>\n~><div>\nnew html 0\nnew html 1\nnew html 2\n' +
      'new html 3\nnew html 4\n</div>\n~~}\n\n{~~    old indented 0\n    old indented 1\n    old indented 2\n' +
      '    old indented 3\n    old indented 4\n~>    new indented 0\n    new indented 1\n    new indented 2\n' +
      '    new indented 3\n    new indented 4\n~~}\n\n$$\nz_0\nz_1\nz_2\nz_3\n$$\n\n$$\nz_0\nz_1\nz_2\nz_3\n$$\n\n' +
      '{~~$$\nx_0\nx_1\nx_2\nx_3\nx_4\n$$\n~>$$\ny_0 + 1\ny_1 + 1\ny_2 + 1\ny_3 + 1\ny_4 + 1\ny_5 + 1\n$$\n~~}\n'
    const [core, control] = cores()
    // The regional edit types the `q` the source already spells.
    const unspelled = source.slice(0, 1) + source.slice(2)
    const revision = regional(core, unspelled)
    const controlRevision = regional(control, unspelled)
    expect(revision.source).toBe(source)
    const input = {
      range: { start: 77, end: 77 },
      selection: { ranges: [{ anchor: 77, focus: 77 }], primary: 0 },
      inputType: 'insertParagraph',
      data: null,
      options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
    } as DocumentInputAction
    const plan = (target: DocumentCore, at: DocumentRevision) => {
      const planned = target.planInput(at, input, { tracked: true })
      return { planned, edits: target.inputEdits(at, input, planned, true) }
    }
    expect(plan(core, revision)).toEqual(plan(control, controlRevision))
  })
})

// A suggestion never ends between a CR and its LF, so a key in a long
// literal block of a CRLF document is spelled alike from the regional core
// and from the document parse.
describe('tracked keys in a CRLF document', () => {
  it('spells typing in a math block the way the document parse does', () => {
    const source = '{q~~<div>\r\nh\r\n</div>~><div>\r\nhz\r\n</div>~~}\r\n\r\n    indented 0\r\n    indented 1\r\n    indented 2\r\n    indented 3\r\n    indented 4\r\n    indented 5\r\n    indented 6\r\n    indented 7\r\n\r\n- item {--one--}\r\n- item two\r\n\r\n<div>\r\nhtml 0\r\nhtml 1\r\nhtml 2\r\nhtml 3\r\nhtml 4\r\n</div>\r\n\r\n$$\r\nx_{0} + y\r\nx_{1} + y\r\nx_{2} + y\r\nx_{3} + y\r\nx_{4} + y\r\n$$\r\n'
    const [core, control] = cores()
    const revision = core.apply(core.open(source), [{ start: 0, end: 0, insert: '' }], { projections: ['markup'] }).revision
    const controlRevision = control.apply(control.open(source), [{ start: 0, end: 0, insert: '' }], { projections: ['markup'] }).revision
    const input = {
      range: { start: 312, end: 312 },
      selection: { ranges: [{ anchor: 312, focus: 312 }], primary: 0 },
      inputType: 'insertText',
      data: 'x',
      options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
    } as DocumentInputAction
    const plan = (target: DocumentCore, at: DocumentRevision) => target.inputEdits(at, input, target.planInput(at, input, { tracked: true }), true)
    expect(plan(core, revision)).toEqual(plan(control, controlRevision))
  })
})

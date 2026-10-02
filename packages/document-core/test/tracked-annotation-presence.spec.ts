import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'
import { planFromDocumentParse } from '../src/internal/documentCoreInspection.js'

// Whether an unfinished opener is escaped in the views depends on whether
// the document holds any annotation at all, which no edit means. A tracked
// key that gives a document with an unfinished opener its first annotation
// is weighed as if that presence were unchanged, so it compiles, and the
// regional core and the document parse spell it alike.

const keys: readonly Readonly<{ label: string, source: string, caret: number }>[] = [
  { label: 'a math block after a stray divider', source: '{q~~$$\nx\ny\n$$~>$$\nx\nzy\n$$~~}\n\n<div>\nhtml 0\nhtml 1\nhtml 2\nhtml 3\nhtml 4\n</div>\n\n$$\nx_{0} + y\nx_{1} + y\nx_{2} + y\nx_{3} + y\nx_{4} + y\n$$\n\n{~~<div>\nh\n</div>~><div>\nhz\n</div>~~}\n', caret: 16 },
  { label: 'a math block after an unfinished opener', source: ' q   indented 0\n    indented 1\n    indented 2\n    indented 3\n    indented 4\n    indented 5\n    indented 6\n    indented 7\n\n$$\nx_{0} + y\nx_{1} + y\nx_{2} + y\nx_{3} + y\nx_{4} + y\n$$\n\n<div>\nhtml 0\nhtml 1\nhtml 2\nhtml 3\nhtml 4\n</div>\n\n```js\nconst value0 = compute(0)\nconst value1 = compute(1)\nconst value2 = compute(2)\nconst value3 = compute(3)\nconst value4 = compute(4)\nconst value5 = compute(5)\nconst value6 = compute(6)\nconst value7 = compute(7)\nconst value8 = compute(8)\nconst value9 = compute(9)\nconst value10 = compute(10)\nconst value11 = compute(11)\n```\n\n{~~<div>\nh\n</div>~><div>\nhz\n</div>~~}\n', caret: 153 }
]

describe('tracked typing in a document with an unfinished opener and no annotation', () => {
  it.each(keys)('compiles typing in $label', ({ source, caret }) => {
    const input = {
      range: { start: caret, end: caret },
      selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
      inputType: 'insertText',
      data: 'x',
      options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
    } as DocumentInputAction
    const plan = (documentParse: boolean) => {
      const core: DocumentCore = createDocumentCore()
      if (documentParse) planFromDocumentParse(core)
      const revision: DocumentRevision = core.apply(core.open(source), [{ start: 0, end: 0, insert: '' }], { projections: ['markup'] }).revision
      return core.inputEdits(revision, input, core.planInput(revision, input, { tracked: true }), true)
    }
    const fromDocument = plan(true)
    expect(fromDocument).toBeDefined()
    expect(plan(false)).toEqual(fromDocument)
  }, 30_000)
})

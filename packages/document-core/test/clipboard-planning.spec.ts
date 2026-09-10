import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

describe('owned clipboard actions', () => {
  it.each([
    { kind: 'cut' as const, markdown: '', expected: 'a\n', caret: 0 },
    { kind: 'paste' as const, markdown: 'a', expected: 'aa\n', caret: 1 },
    { kind: 'paste' as const, markdown: '{++new++}', expected: '{++new++}a\n', caret: 9 }
  ])('$kind replaces the selected repeated text and its consumed annotation', ({ kind, markdown, expected, caret }) => {
    const core = createDocumentCore()
    const revision = core.open('a{++a++}a\n')
    const selection = { ranges: [{ anchor: 0, focus: 5 }], primary: 0 }
    const action = kind === 'cut' ? { kind, selection, tracked: false } : { kind, selection, markdown, tracked: false }
    const plan = core.planClipboard(revision, action)
    expect(core.apply(revision, plan.edits).revision.source).toBe(expected)
    expect(plan.selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
  })

  it('preserves a hidden comment while replacing its visible neighbors', () => {
    const core = createDocumentCore()
    const revision = core.open('a{>>note<<}b\n')
    const plan = core.planClipboard(revision, { kind: 'paste', selection: { ranges: [{ anchor: 0, focus: 12 }], primary: 0 }, markdown: 'hello', tracked: false })
    expect(core.apply(revision, plan.edits).revision.source).toBe('hello{>>note<<}\n')
    expect(plan.selection).toEqual({ ranges: [{ anchor: 5, focus: 5 }], primary: 0 })
  })

  it.each([
    { kind: 'paste' as const, markdown: '**new**', expected: '{~~word~>**new**~~}\n', caret: 16 },
    { kind: 'cut' as const, markdown: '', expected: '{--word--}\n', caret: 10 }
  ])('tracks $kind using the same owned review arms', ({ kind, markdown, expected, caret }) => {
    const core = createDocumentCore()
    const revision = core.open('word\n')
    const selection = { ranges: [{ anchor: 0, focus: 4 }], primary: 0 }
    const action = kind === 'cut' ? { kind, selection, tracked: true } : { kind, selection, markdown, tracked: true }
    const plan = core.planClipboard(revision, action)
    const next = core.apply(revision, plan.edits).revision
    expect(next.source).toBe(expected)
    expect(core.project(next, 'original').markdown).toBe('word\n')
    expect(plan.selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
  })
})

it.each([
  { markdown: '# pasted', expected: 'before pastedafter\n', caret: 13 },
  { markdown: '- pasted', expected: 'before \n\n- pastedafter\n', caret: 17 },
  { markdown: '| a | b |\n| - | - |\n| c | d |', expected: 'before \n\n| a   | b      |\n| --- | ------ |\n| c   | dafter |\n', caret: 52 }
])('retains native imported $markdown merge behavior', ({ markdown, expected, caret }) => {
  const core = createDocumentCore()
  const revision = core.open('before after\n')
  const plan = core.planClipboard(revision, { kind: 'paste', selection: { ranges: [{ anchor: 7, focus: 7 }], primary: 0 }, markdown, tracked: false })
  expect(core.apply(revision, plan.edits).revision.source).toBe(expected)
  expect(plan.selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
})

it.each([
  { source: 'AB\n', caret: 1, expected: 'A[http://example.test/page](http://example.test/page)B\n' },
  { source: 'A  B\n', caret: 2, expected: 'A http://example.test/page B\n' },
  { source: 'A .\n', caret: 2, expected: 'A http://example.test/page.\n' }
])('uses current owned autolink context for imported bare URL in $source', ({ source, caret, expected }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const bareUrl = 'http://example.test/page'
  const plan = core.planClipboard(revision, { kind: 'paste', selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 }, markdown: `[${bareUrl}](${bareUrl})`, plainText: bareUrl, bareUrl, tracked: false })
  expect(core.apply(revision, plan.edits).revision.source).toBe(expected)
})

it('preserves the actual later caret when a prepared clipboard insertion completes', () => {
  const core = createDocumentCore()
  const revision = core.open('aXb\n')
  const plan = core.planClipboard(revision, { kind: 'paste', selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 }, currentSelection: { ranges: [{ anchor: 2, focus: 2 }], primary: 0 }, markdown: '![](/final.png)', tracked: false })
  expect(core.apply(revision, plan.edits).revision.source).toBe('a![](/final.png)Xb\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: 'a![](/final.png)X'.length, focus: 'a![](/final.png)X'.length }], primary: 0 })
})

it('preserves a later expanded selection through annotated prepared insertion', () => {
  const core = createDocumentCore()
  const revision = core.open('aXY{>>keep<<}b\n')
  const plan = core.planClipboard(revision, { kind: 'paste', selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 }, currentSelection: { ranges: [{ anchor: 1, focus: 3 }], primary: 0 }, markdown: '{++P++}', tracked: false })
  expect(core.apply(revision, plan.edits).revision.source).toBe('a{++P++}XY{>>keep<<}b\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: 'a{++P++}'.length, focus: 'a{++P++}XY'.length }], primary: 0 })
})

it.each([
  { name: 'heading soft lines', source: '# before after\n', at: 9, markdown: 'first\nsecond', expected: '# before first\n\nsecondafter\n' },
  { name: 'quote paragraphs', source: '> before after\n', at: 9, markdown: 'first\n\nsecond', expected: '> before first\n>\n> secondafter\n' },
  { name: 'list paragraphs', source: '- before after\n', at: 9, markdown: 'first\n\nsecond', expected: '- before first\n\n  secondafter\n' },
  { name: 'table multiline', source: '| before after |\n| --- |\n| b |\n', at: 9, markdown: 'first\nsecond', expected: '| before first<br/>secondafter |\n| --- |\n| b |\n' }
])('preserves the existing $name paste meaning and untouched source', ({ source, at, markdown, expected }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const plan = core.planClipboard(revision, { kind: 'paste', selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, markdown, tracked: false })
  expect(core.apply(revision, plan.edits).revision.source).toBe(expected)
  expect(plan.selection).toEqual({ ranges: [{ anchor: expected.indexOf('after'), focus: expected.indexOf('after') }], primary: 0 })
})

it('does not copy a leading annotation opener as a quote continuation prefix', () => {
  const core = createDocumentCore()
  const revision = core.open('> {++before++} after\n')
  const plan = core.planClipboard(revision, { kind: 'paste', selection: { ranges: [{ anchor: 15, focus: 15 }], primary: 0 }, markdown: 'first\n\nsecond', tracked: false })
  expect(core.apply(revision, plan.edits).revision.source).toBe('> {++before++} first\n>\n> secondafter\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: '> {++before++} first\n>\n> second'.length, focus: '> {++before++} first\n>\n> second'.length }], primary: 0 })
})

it.each([
  { markdown: '<ul><li>a</li></ul>', expected: 'f{++o++}o<ul><li>a</li></ul>\n', caret: 'f{++o++}o<ul><li>a</li></ul>'.length },
  { markdown: '<ul>\n<li>a</li>\n</ul>', expected: 'f{++o++}o<ul>\n\n<li>a</li>\n</ul>\n', caret: 'f{++o++}o<ul>'.length }
])('retains native plain block-HTML spelling for $markdown', ({ markdown, expected, caret }) => {
  const core = createDocumentCore()
  const revision = core.open('f{++o++}o\n')
  const action = { kind: 'paste' as const, selection: { ranges: [{ anchor: 9, focus: 9 }], primary: 0 }, markdown, plainText: markdown, pasteAsPlainText: true, tracked: false }
  const plan = core.planClipboard(revision, action)
  expect(core.apply(revision, plan.edits).revision.source).toBe(expected)
  expect(plan.selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
})

it('keeps unselected annotation and comment source outside a multiline plain-HTML replacement', () => {
  const core = createDocumentCore()
  const source = 'fooTAIL{++kept++}{>>note<<}\n'
  const revision = core.open(source)
  const markdown = '<ul>\n<li>a</li>\n</ul>'
  const action = { kind: 'paste' as const, selection: { ranges: [{ anchor: 3, focus: 3 }], primary: 0 }, markdown, plainText: markdown, pasteAsPlainText: true, tracked: false }
  const plan = core.planClipboard(revision, action)
  expect(core.apply(revision, plan.edits).revision.source).toBe('foo<ul>TAIL{++kept++}{>>note<<}\n\n<li>a</li>\n</ul>\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: 7, focus: 7 }], primary: 0 })
  expect(plan.edits.every(edit => edit.start === edit.end)).toBe(true)
})

it('retains literal precedence when a tracked HTML closer is inside its block', () => {
  // Profile 1 R3a/L1: this source does not enclose a whole literal range.
  // The closing marker is HTML data, so it cannot represent the native paste.
  const invalid = createDocumentCore().open('foo{++<ul>++}TAIL{>>note<<}{++\n\n<li>a</li>\n</ul>++}\n')
  expect(invalid.diagnostics).toContainEqual(expect.objectContaining({ code: 'CM_UNTERMINATED_OPENER' }))
})

it('tracks a complete plain HTML block with its required separator and retains the original bytes', () => {
  const core = createDocumentCore()
  const source = 'fooTAIL{>>note<<}\n'
  const revision = core.open(source)
  const markdown = '<ul>\n<li>a</li>\n</ul>'
  const plan = core.planClipboard(revision, { kind: 'paste', selection: { ranges: [{ anchor: 3, focus: 3 }], primary: 0 }, markdown, plainText: markdown, pasteAsPlainText: true, tracked: true })
  const next = core.apply(revision, plan.edits).revision
  const expected = 'foo{++<ul>++}TAIL{>>note<<}{~~\n~>\n\n<li>a</li>\n</ul>\n\n~~}'
  expect(next.source).toBe(expected)
  expect(next.diagnostics).toEqual([])
  expect(core.project(next, 'original').markdown).toBe('fooTAIL\n')
  // The blank line belongs to the authored block, outside its literal body.
  expect(core.project(next, 'revised').markdown).toBe('foo<ul>TAIL\n\n<li>a</li>\n</ul>\n\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: 10, focus: 10 }], primary: 0 })
  const typed = core.track(next, { start: 10, end: 10, insert: 'x' }).revision
  expect(typed.source).toBe('foo{++<ul>x++}TAIL{>>note<<}{~~\n~>\n\n<li>a</li>\n</ul>\n\n~~}')
  expect(createDocumentCore().open(typed.source).diagnostics).toEqual([])
  let rejected = typed
  for (const kind of ['substitution', 'addition']) {
    const annotation = rejected.annotations.find(item => item.kind === kind)
    expect(annotation).toBeDefined()
    if (annotation === undefined) throw new Error(`Missing ${kind} suggestion`)
    rejected = core.resolve(rejected, annotation, 'reject').revision
  }
  expect(rejected.source).toBe(source)
})

it('terminates the authored block before an untouched following heading and its annotation', () => {
  const core = createDocumentCore()
  const source = 'fooTAIL{>>note<<}\n# UNRELATED{++kept++}\n'
  const revision = core.open(source)
  const markdown = '<ul>\n<li>a</li>\n</ul>'
  const plan = core.planClipboard(revision, { kind: 'paste', selection: { ranges: [{ anchor: 3, focus: 3 }], primary: 0 }, markdown, plainText: markdown, pasteAsPlainText: true, tracked: true })
  const next = core.apply(revision, plan.edits).revision
  expect(next.source).toBe('foo{++<ul>++}TAIL{>>note<<}{~~\n~>\n\n<li>a</li>\n</ul>\n\n~~}# UNRELATED{++kept++}\n')
  expect(next.diagnostics).toEqual([])
  expect(core.project(next, 'original').markdown).toBe('fooTAIL\n# UNRELATED\n')
  expect(core.project(next, 'revised').markdown).toBe('foo<ul>TAIL\n\n<li>a</li>\n</ul>\n\n# UNRELATEDkept\n')
  expect(core.project(next, 'markup').syntax.ast.root.children.map(node => node.kind)).toEqual(['paragraph', 'html-block', 'heading'])
  expect(plan.selection).toEqual({ ranges: [{ anchor: 10, focus: 10 }], primary: 0 })
  expect(createDocumentCore().open(next.source).diagnostics).toEqual([])
  let rejected = next
  for (const kind of ['substitution', 'addition']) {
    const annotation = rejected.annotations.find(item => item.kind === kind && (kind !== 'addition' || item.range.start === 3))
    if (annotation === undefined) throw new Error(`Missing ${kind} suggestion`)
    rejected = core.resolve(rejected, annotation, 'reject').revision
  }
  expect(rejected.source).toBe(source)
})

it('retains the original CRLF when enclosing a tracked HTML remainder', () => {
  const core = createDocumentCore()
  const revision = core.open('fooTAIL{>>note<<}\r\n')
  const markdown = '<ul>\n<li>a</li>\n</ul>'
  const plan = core.planClipboard(revision, { kind: 'paste', selection: { ranges: [{ anchor: 3, focus: 3 }], primary: 0 }, markdown, pasteAsPlainText: true, tracked: true })
  const next = core.apply(revision, plan.edits).revision
  expect(next.source).toBe('foo{++<ul>++}TAIL{>>note<<}{~~\r\n~>\n\n<li>a</li>\n</ul>\r\n\r\n~~}')
  expect(next.diagnostics).toEqual([])
  expect(core.project(next, 'original').markdown).toBe('fooTAIL\r\n')
  expect(core.project(next, 'revised').markdown).toBe('foo<ul>TAIL\n\n<li>a</li>\n</ul>\r\n\r\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: 10, focus: 10 }], primary: 0 })
})

it('does not add a blank terminator to an explicitly terminated HTML block', () => {
  const core = createDocumentCore()
  const revision = core.open('foo\n')
  const plan = core.planClipboard(revision, { kind: 'paste', selection: { ranges: [{ anchor: 3, focus: 3 }], primary: 0 }, markdown: '<script>\na\n</script>', tracked: true })
  const next = core.apply(revision, plan.edits).revision
  expect(next.source).toBe('foo{++\n\n<script>\na\n</script>++}\n')
  expect(next.diagnostics).toEqual([])
  expect(core.project(next, 'original').markdown).toBe('foo\n')
})

it('refuses an unclosed explicit HTML literal rather than inventing its closing tag', () => {
  const core = createDocumentCore()
  const revision = core.open('foo\n')
  expect(() => core.planClipboard(revision, { kind: 'paste', selection: { ranges: [{ anchor: 3, focus: 3 }], primary: 0 }, markdown: '<script>\nmissing', tracked: true })).toThrow('Clipboard action has no safe source edit')
  expect(revision.source).toBe('foo\n')
})

it('preserves selected old blocks when extending a tracked replacement through their final EOL', () => {
  const core = createDocumentCore()
  const source = 'foo\n\n# old\n'
  const revision = core.open(source)
  const plan = core.planClipboard(revision, { kind: 'paste', selection: { ranges: [{ anchor: 3, focus: 10 }], primary: 0 }, markdown: '\n\n<ul>\n<li>a</li>\n</ul>', tracked: true })
  const next = core.apply(revision, plan.edits).revision
  expect(next.source).toBe('foo{~~\n\n# old\n~>\n\n<ul>\n<li>a</li>\n</ul>\n\n~~}')
  expect(next.diagnostics).toEqual([])
  expect(core.project(next, 'original').markdown).toBe(source)
  expect(core.project(next, 'revised').markdown).toBe('foo\n\n<ul>\n<li>a</li>\n</ul>\n\n')
})

it('tracks representable plain-HTML insertions as one action while retaining the unselected tail', () => {
  const core = createDocumentCore()
  const revision = core.open('fooTAIL{>>note<<}\n')
  const markdown = '<div>a</div>\ntext'
  const plan = core.planClipboard(revision, { kind: 'paste', selection: { ranges: [{ anchor: 3, focus: 3 }], primary: 0 }, markdown, plainText: markdown, pasteAsPlainText: true, tracked: true })
  const next = core.apply(revision, plan.edits).revision
  expect(next.source).toBe('foo{++<div>a</div>++}TAIL{>>note<<}{++\n\ntext++}\n')
  expect(core.project(next, 'original').markdown).toBe('fooTAIL\n')
  expect(core.project(next, 'revised').markdown).toBe('foo<div>a</div>TAIL\n\ntext\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: 18, focus: 18 }], primary: 0 })
})

it.each([false, true])('replaces the actual backward clipboard range and returns its exact caret (tracked=%s)', tracked => {
  const core = createDocumentCore()
  const previous = core.open('abc\n')
  const plan = core.planClipboard(previous, { kind: 'paste', selection: { ranges: [{ anchor: 3, focus: 1 }], primary: 0 }, markdown: 'X', tracked })
  expect(core.apply(previous, plan.edits).revision.source).toBe(tracked ? 'a{~~bc~>X~~}\n' : 'aX\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: tracked ? 9 : 2, focus: tracked ? 9 : 2 }], primary: 0 })
})

it.each([false, true])('preserves the actual later backward selection during prepared paste (tracked=%s)', tracked => {
  const core = createDocumentCore()
  const previous = core.open('aXY{>>keep<<}b\n')
  const plan = core.planClipboard(previous, {
    kind: 'paste',
    selection: { ranges: [{ anchor: 1, focus: 1 }], primary: 0 },
    currentSelection: { ranges: [{ anchor: 3, focus: 1 }], primary: 0 },
    markdown: tracked ? 'P' : '{++P++}',
    tracked
  })
  expect(core.apply(previous, plan.edits).revision.source).toBe('a{++P++}XY{>>keep<<}b\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: 10, focus: 8 }], primary: 0 })
})

import { expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

it('keeps the following paragraph typing context outside the adjacent literal', () => {
  const core = createDocumentCore()
  const source = '```\na\n```\nb\n'
  const revision = core.open(source)
  const at = source.indexOf('b\n')
  const action = { selection: { ranges: [{ anchor: at, focus: at + 1 }], primary: 0 }, range: { start: at, end: at + 1 }, inputType: 'insertText', data: '*', options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  expect(commit.revision.source).toBe('```\na\n```\n*b*\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: at + 1, focus: at + 2 }], primary: 0 })
})

it('joins the paragraph whose start coincides with the preceding code end', () => {
  const core = createDocumentCore()
  const source = '```\na\n```\nb\n\noutside{>>keep<<}\n'
  const revision = core.open(source)
  const at = source.indexOf('b\n')
  const action = { kind: 'command' as const, command: 'joinParagraphBackward' as const, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  expect(commit.revision.source).toBe('```\nab\n```\n\noutside{>>keep<<}\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 5, focus: 5 }], primary: 0 })
})

it('joins a paragraph into the preceding literal body before accepting the next key', () => {
  const core = createDocumentCore()
  const source = '```\ncode\n```\n\nnext\n\noutside{>>keep<<}\n'
  const revision = core.open(source)
  const at = source.indexOf('next')
  const action = { kind: 'command' as const, command: 'joinParagraphBackward' as const, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  expect(commit.revision.source).toBe('```\ncodenext\n```\n\noutside{>>keep<<}\n')
  const selection = core.reconcileInput(revision, plan, commit, action).selection
  expect(selection).toEqual({ ranges: [{ anchor: 8, focus: 8 }], primary: 0 })
  if (selection === undefined) throw new Error('Missing joined body selection')
  const typing = { selection, range: { start: 8, end: 8 }, inputType: 'insertText', data: 'x', options }
  const input = core.planInput(commit.revision, typing)
  const nextEdits = core.inputEdits(commit.revision, typing, input, false)
  expect(nextEdits).toBeDefined()
  const next = core.apply(commit.revision, nextEdits ?? [])
  expect(next.revision.source).toBe('```\ncodexnext\n```\n\noutside{>>keep<<}\n')
  expect(revision.source).toBe(source)
  expect(createDocumentCore().open(next.revision.source).source).toBe(next.revision.source)
})

for (const ending of ['\n', '\r\n', '\r']) {
  it.each([false, true])(`preserves raw CM paragraph spelling and outside marks when joining (${JSON.stringify(ending)}, tracked=%s)`, tracked => {
    const eol = (text: string) => text.replaceAll('\n', ending)
    const core = createDocumentCore()
    const source = eol('```\ncode\n```\n\na{++b++}c{>>note<<}\n\noutside{>>keep<<}\n')
    const revision = core.open(source)
    const at = source.indexOf('a{++')
    const action = { kind: 'command' as const, command: 'joinParagraphBackward' as const, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options }
    const plan = core.planInput(revision, action)
    const edits = core.inputEdits(revision, action, plan, tracked)
    expect(edits).toBeDefined()
    const commit = core.apply(revision, edits ?? [])
    const expected = eol('```\ncodea{++b++}c{>>note<<}\n```\n\noutside{>>keep<<}\n')
    if (!tracked) expect(commit.revision.source).toBe(expected)
    else {
      expect(core.project(commit.revision, 'original').markdown).toBe(eol('```\ncode\n```\n\nac\n\noutside\n'))
      expect(core.project(commit.revision, 'revised').markdown).toBe(eol('```\ncodea{++b++}c{>>note<<}\n```\n\noutside\n'))
    }
    expect(commit.revision.source.endsWith(eol('outside{>>keep<<}\n'))).toBe(true)
    expect(revision.source).toBe(source)
    const selected = core.reconcileInput(revision, plan, commit, action).selection
    const revised = core.project(commit.revision, 'revised')
    const caret = revised.coordinates.toSource(eol('```\ncode').length, 'next')
    expect(selected).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
  })
}

it.each([
  { name: 'empty fenced body', source: '```\n```\n\nb\n\noutside{>>keep<<}\n', expected: '```\nb\n```\n\noutside{>>keep<<}\n', caret: 4 },
  { name: 'normalized tab at body end', source: '  ```\n\t\n  ```\n\nb\n\noutside{>>keep<<}\n', expected: '  ```\n\tb\n  ```\n\noutside{>>keep<<}\n', caret: 7 },
  { name: 'indented multiline body', source: '    a\n\nb\nc\n\noutside{>>keep<<}\n', expected: '    ab\n    c\n\noutside{>>keep<<}\n', caret: 5 },
  { name: 'quoted multiline body', source: '> ```\n> a\n> ```\n>\n> b\n> c\n\noutside{>>keep<<}\n', expected: '> ```\n> ab\n> c\n> ```\n\noutside{>>keep<<}\n', caret: 9 },
  { name: 'listed multiline body', source: '- ```\n  a\n  ```\n\n  b\n  c\n- outside{>>keep<<}\n', expected: '- ```\n  ab\n  c\n  ```\n- outside{>>keep<<}\n', caret: 9 }
])('joins $name using owned literal and physical line facts', example => {
  const core = createDocumentCore()
  const revision = core.open(example.source)
  const at = example.source.indexOf('b\n')
  const action = { kind: 'command' as const, command: 'joinParagraphBackward' as const, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  expect(commit.revision.source).toBe(example.expected)
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: example.caret, focus: example.caret }], primary: 0 })
})

it.each([false, true])('joins the existing lone-image paragraph convention into literal code (tracked=%s)', tracked => {
  const core = createDocumentCore()
  const source = '```\na{++literal++}\n```\n\n<img src="x">\n\noutside{>>keep<<}\n'
  const revision = core.open(source)
  const at = source.indexOf('<img')
  const action = { kind: 'command' as const, command: 'joinParagraphBackward' as const, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, tracked)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  const expected = '```\na{++literal++}<img src="x">\n```\n\noutside{>>keep<<}\n'
  if (!tracked) expect(commit.revision.source).toBe(expected)
  expect(core.project(commit.revision, 'revised').markdown).toBe(expected.replace('{>>keep<<}', ''))
  const caret = core.project(commit.revision, 'revised').coordinates.toSource(18, 'next')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
})

import { expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

it('wraps the selected outmost blocks as exact literal source before the next input', () => {
  const core = createDocumentCore()
  const source = '# T\n\na{++b++}c{>>note<<}\n\noutside{>>keep<<}\n'
  const revision = core.open(source)
  const action = { kind: 'command' as const, command: 'wrapCodeBlocks' as const, selection: { ranges: [{ anchor: 2, focus: source.indexOf('\n\noutside') }], primary: 0 }, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  expect(commit.revision.source).toBe('```\n# T\n\na{++b++}c{>>note<<}\n```\n\noutside{>>keep<<}\n')
  const selection = core.reconcileInput(revision, plan, commit, action).selection
  expect(selection).toEqual({ ranges: [{ anchor: 4, focus: 4 }], primary: 0 })
  const syntax = core.project(commit.revision, 'markup').syntax
  expect(syntax.ast.root.children[0]?.attributes.content).toBe('# T\n\na{++b++}c{>>note<<}\n')
  if (selection === undefined || !('ranges' in selection) || selection.ranges[0] === undefined) throw new Error('Expected wrapped body selection')
  const caret = selection.ranges[0]
  const typing = { selection, range: { start: caret.anchor, end: caret.focus }, inputType: 'insertText', data: 'x', options }
  const input = core.planInput(commit.revision, typing)
  const nextEdits = core.inputEdits(commit.revision, typing, input, false)
  expect(nextEdits).toBeDefined()
  const next = core.apply(commit.revision, nextEdits ?? [])
  expect(next.revision.source).toBe('```\nx# T\n\na{++b++}c{>>note<<}\n```\n\noutside{>>keep<<}\n')
  expect(revision.source).toBe(source)
})

it('tracks wrapping as one source-owned operation while preserving reader meanings', () => {
  const core = createDocumentCore()
  const source = '# T\n\na{++b++}c{>>note<<}\n\noutside{>>keep<<}\n'
  const revision = core.open(source)
  const action = { kind: 'command' as const, command: 'wrapCodeBlocks' as const, selection: { ranges: [{ anchor: 2, focus: source.indexOf('\n\noutside') }], primary: 0 }, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, true)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  expect(core.project(commit.revision, 'original').markdown).toBe('# T\n\nac\n\noutside\n')
  const revised = core.project(commit.revision, 'revised')
  expect(revised.markdown).toBe('```\n# T\n\na{++b++}c{>>note<<}\n```\n\noutside\n')
  const selection = core.reconcileInput(revision, plan, commit, action).selection
  expect(selection).toEqual({ ranges: [{ anchor: revised.coordinates.toSource(4, 'next'), focus: revised.coordinates.toSource(4, 'next') }], primary: 0 })
  expect(revision.source).toBe(source)
})

for (const ending of ['\n', '\r\n', '\r']) {
  it.each([
    { name: 'list outmost owner', source: '- one\n- two{++x++}\n\noutside{>>keep<<}\n', anchor: 2, focus: 10, wrapped: '```\n- one\n- two{++x++}\n```\n\noutside{>>keep<<}\n', caret: 4 },
    { name: 'quote outmost owner', source: '> one\n>\n> two\n\noutside{>>keep<<}\n', anchor: 2, focus: 12, wrapped: '```\n> one\n>\n> two\n```\n\noutside{>>keep<<}\n', caret: 4 },
    { name: 'existing fence collision', source: '```\none\n```\n\ntwo\n\noutside{>>keep<<}\n', anchor: 4, focus: 16, wrapped: '````\n```\none\n```\n\ntwo\n````\n\noutside{>>keep<<}\n', caret: 5 }
  ])(`wraps and unwraps $name without changing its source (${JSON.stringify(ending)})`, example => {
    const eol = (value: string) => value.replaceAll('\n', ending)
    const core = createDocumentCore()
    const source = eol(example.source)
    const revision = core.open(source)
    const action = { kind: 'command' as const, command: 'wrapCodeBlocks' as const, selection: { ranges: [{ anchor: eol(example.source.slice(0, example.anchor)).length, focus: eol(example.source.slice(0, example.focus)).length }], primary: 0 }, options }
    const plan = core.planInput(revision, action)
    const edits = core.inputEdits(revision, action, plan, false)
    expect(edits).toBeDefined()
    const commit = core.apply(revision, edits ?? [])
    expect(commit.revision.source).toBe(eol(example.wrapped))
    const caret = eol(example.wrapped.slice(0, example.caret)).length
    expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
    const reopened = createDocumentCore()
    const opened = reopened.open(commit.revision.source)
    const reset = { kind: 'command' as const, command: 'resetCodeBlock' as const, selectionMode: 'end' as const, selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 }, options }
    const resetPlan = reopened.planInput(opened, reset)
    const resetEdits = reopened.inputEdits(opened, reset, resetPlan, false)
    expect(resetEdits).toBeDefined()
    expect(reopened.apply(opened, resetEdits ?? []).revision.source).toBe(source)
  })
}

it('preserves mixed source endings and a final missing newline through wrapping and reset', () => {
  const core = createDocumentCore()
  const source = '# A\r\n\r\nB\rC'
  const revision = core.open(source)
  const action = { kind: 'command' as const, command: 'wrapCodeBlocks' as const, selection: { ranges: [{ anchor: 2, focus: source.length }], primary: 0 }, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  const wrapped = core.apply(revision, edits ?? [])
  expect(wrapped.revision.source).toBe('```\r\n# A\r\n\r\nB\rC\r\n```')
  expect(core.reconcileInput(revision, plan, wrapped, action).selection).toEqual({ ranges: [{ anchor: 5, focus: 5 }], primary: 0 })
  const reset = { kind: 'command' as const, command: 'resetCodeBlock' as const, selectionMode: 'end' as const, selection: { ranges: [{ anchor: 5, focus: 5 }], primary: 0 }, options }
  const resetPlan = core.planInput(wrapped.revision, reset)
  const resetEdits = core.inputEdits(wrapped.revision, reset, resetPlan, false)
  expect(resetEdits).toBeDefined()
  expect(core.apply(wrapped.revision, resetEdits ?? []).revision.source).toBe(source)
})

it.each(['# preceding\n', '```\npreceding\n```\n'])('keeps an adjacent preceding block outside the selected wrap: %j', preceding => {
  const core = createDocumentCore()
  const source = preceding + '# first\n\nsecond\n\noutside\n'
  const revision = core.open(source)
  const action = { kind: 'command' as const, command: 'wrapCodeBlocks' as const, selection: { ranges: [{ anchor: preceding.length, focus: source.indexOf('\n\noutside') }], primary: 0 }, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  expect(core.apply(revision, edits ?? []).revision.source).toBe(preceding + '```\n# first\n\nsecond\n```\n\noutside\n')
})

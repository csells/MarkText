import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'

// Upstream MarkText #5600: Enter on a code fence's opening line turns the
// whole line into a fenced code block that keeps its fence character, as
// upstream's paragraph Enter conversion and serializer write it.

const paired = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

const input = (at: number, inputType: string, data: string | null): DocumentInputAction => ({
  selection: { ranges: [{ anchor: at, focus: at }], primary: 0 },
  range: { start: at, end: at },
  inputType,
  data,
  options: paired
})

const perform = (core: ReturnType<typeof createDocumentCore>, previous: DocumentRevision, action: DocumentInputAction) => {
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  if (edits === undefined) throw new Error('Input was refused')
  const commit = core.apply(previous, edits)
  const selection = core.reconcileInput(previous, plan, commit, action).selection
  if (selection === undefined || !('ranges' in selection)) throw new Error('Expected a text selection')
  const range = selection.ranges[selection.primary]
  if (range === undefined || range.anchor !== range.focus) throw new Error('Expected a caret')
  return { revision: commit.revision, caret: range.anchor }
}

const typed = (keys: string) => {
  const core = createDocumentCore()
  let state = { revision: core.open(''), caret: 0 }
  for (const key of keys) {
    state = perform(core, state.revision, key === '\n'
      ? input(state.caret, 'insertParagraph', null)
      : input(state.caret, 'insertText', key))
  }
  return { source: state.revision.source, caret: state.caret }
}

const enter = (source: string, at: number) => {
  const core = createDocumentCore()
  const state = perform(core, core.open(source), input(at, 'insertParagraph', null))
  return { source: state.revision.source, caret: state.caret }
}

describe('Enter on a code fence opener (upstream #5600)', () => {
  it.each([
    { keys: '~~~\n', source: '~~~\n\n~~~', caret: 4 },
    { keys: '```\n', source: '```\n\n```', caret: 4 }
  ])('typing $keys makes a fenced block with that fence character', ({ keys, source, caret }) => {
    expect(typed(keys)).toEqual({ source, caret })
  })

  it.each([
    { source: '~~~~~~\n', at: 3, expected: '~~~\n\n~~~\n', caret: 4 },
    { source: '~~~js~~~\n', at: 5, expected: '~~~js~~~\n\n~~~\n', caret: 9 },
    { source: '~~~js\n', at: 5, expected: '~~~js\n\n~~~\n', caret: 6 },
    { source: '~~~ js\n', at: 6, expected: '~~~js\n\n~~~\n', caret: 6 },
    { source: '~~~\n', at: 3, expected: '~~~\n\n~~~\n', caret: 4 },
    { source: '```\n', at: 3, expected: '```\n\n```\n', caret: 4 },
    { source: '```js\n', at: 5, expected: '```js\n\n```\n', caret: 6 },
    // The caret's place on the line does not split the opener.
    { source: '```js\n', at: 4, expected: '```js\n\n```\n', caret: 6 },
    { source: '```` js extra\n', at: 13, expected: '```js\n\n```\n', caret: 6 },
    { source: 'para\n\n~~~\n', at: 9, expected: 'para\n\n~~~\n\n~~~\n', caret: 10 },
    { source: '> ~~~js\n', at: 7, expected: '> ~~~js\n> \n> ~~~\n', caret: 10 },
    { source: '- ~~~\n', at: 5, expected: '- ~~~\n  \n  ~~~\n', caret: 8 },
    { source: '~~~\r\n', at: 3, expected: '~~~\r\n\r\n~~~\r\n', caret: 5 }
  ])('Enter in $source at $at', ({ source, at, expected, caret }) => {
    expect(enter(source, at)).toEqual({ source: expected, caret })
  })
})

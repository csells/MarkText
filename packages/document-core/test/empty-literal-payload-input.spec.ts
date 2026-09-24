import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

/** An empty payload has no text span, so the editor addresses it by its source point. */
function typeIntoEmptyPayload(source: string, data: string) {
  const core = createDocumentCore()
  const previous = core.open(source)
  const literal = core.project(previous, 'markup').syntax.ast.root.children.flatMap(function walk(node): typeof node[] {
    return node.kind === 'text' && node.attributes.semanticText === '' ? [node] : node.children.flatMap(walk)
  })[0]
  if (literal === undefined) throw new Error('fixture has no empty payload')
  const at = literal.range.start
  const selection = { ranges: [{ anchor: at, focus: at }], primary: 0 }
  const action: DocumentInputAction = { selection, range: { start: at, end: at }, inputType: 'insertText', data, options }
  const policy = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, policy, false)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits ?? [])
  const reconciled = core.reconcileInput(previous, policy, commit, action).selection
  return { source: commit.revision.source, selection: reconciled }
}

describe('typing into an empty fenced literal payload', () => {
  const cases = [
    ['fenced code', '~~~ts\n~~~\n', '~~~ts\n!\n~~~\n', 7],
    ['CRLF fenced code', '~~~ts\r\n~~~\r\n', '~~~ts\r\n!\r\n~~~\r\n', 8],
    ['backtick fenced code', '```\n```\n', '```\n!\n```\n', 5],
    ['math block', '$$\n$$\n', '$$\n!\n$$\n', 4],
    ['front matter', '---\n---\n', '---\n!\n---\n', 5],
    ['quoted fenced code', '> ~~~\n> ~~~\n', '> ~~~\n> !\n> ~~~\n', 9],
    ['list fenced code', '- ~~~\n  ~~~\n', '- ~~~\n  !\n  ~~~\n', 9],
    ['already-lined math block', '$$\n\n$$\n', '$$\n!\n$$\n', 4],
    ['unclosed fenced code', '~~~\n', '~~~\n!', 5]
  ] as const
  it.each(cases)('keeps the payload line ending for %s', (_name, source, expected, caret) => {
    const result = typeIntoEmptyPayload(source, '!')
    expect(result.source).toBe(expected)
    expect(result.selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
  })

  it('continues containers for a multi-line value inserted into an empty quoted fence', () => {
    expect(typeIntoEmptyPayload('> ~~~\n> ~~~\n', 'a\nb').source).toBe('> ~~~\n> a\n> b\n> ~~~\n')
  })

  it.each([false, true])('addresses the empty payload as intrinsic text for model-text carets (tracked=%s)', tracked => {
    const core = createDocumentCore()
    const previous = core.open('~~~ts\n~~~\n')
    const selection = { kind: 'model-text' as const, anchor: 6, focus: 6 }
    const action: DocumentInputAction = { selection, range: selection, inputType: 'insertText', data: '!', options }
    const policy = core.planInput(previous, action)
    const commit = core.apply(previous, core.inputEdits(previous, action, policy, tracked) ?? [])
    expect(core.project(commit.revision, 'revised').markdown).toBe('~~~ts\n!\n~~~\n')
    if (tracked) expect(core.project(commit.revision, 'original').markdown).toBe(previous.source)
  })
})

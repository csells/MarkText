import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction, type DocumentRevision, type DocumentSourceEdit } from '../src/index.js'

// Upstream's trimUnnecessaryCodeBlockEmptyLines, edit-scoped: only the code
// block an untracked input edits loses its edge empty lines, in that input's
// own operation.

const options = (trim: boolean) => ({ autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true, trimUnnecessaryCodeBlockEmptyLines: trim })

const typing = (at: number, data: string, trim = true): DocumentInputAction =>
  ({ selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, range: { start: at, end: at }, inputType: 'insertText', data, options: options(trim) })

const enter = (at: number, trim = true): DocumentInputAction =>
  ({ selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, range: { start: at, end: at }, inputType: 'insertParagraph', data: null, options: options(trim) })

const run = (source: string, action: DocumentInputAction, tracked = false) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const plan = core.planInput(revision, action, { tracked })
  const edits = core.inputEdits(revision, action, plan, tracked)
  if (edits === undefined) throw new Error('Input was refused')
  const commit = core.apply(revision, edits)
  const result = core.reconcileInput(revision, plan, commit, action)
  return { core, revision, commit, selection: result.selection ?? plan.selection }
}

/** The edits that turn the committed source back into the previous one. */
const inverse = (previous: string, applied: readonly DocumentSourceEdit[]): DocumentSourceEdit[] => {
  let delta = 0
  return applied.map(edit => {
    const start = edit.start + delta
    delta += edit.insert.length - (edit.end - edit.start)
    return { start, end: start + edit.insert.length, insert: previous.slice(edit.start, edit.end) }
  })
}

const caret = (selection: unknown) => (selection as { ranges: { anchor: number }[] }).ranges[0]?.anchor

describe('edit-scoped code block edge trimming', () => {
  it('trims the edited block\'s leading and trailing empty lines when on', () => {
    const source = '```js\n\n\nx\n\n```\n'
    const at = source.indexOf('x') + 1
    const { commit, selection } = run(source, typing(at, 'y'))
    expect(commit.revision.source).toBe('```js\nxy\n```\n')
    expect(caret(selection)).toBe('```js\nxy'.length)
  })

  it('writes only the typed text when off', () => {
    const source = '```js\n\n\nx\n\n```\n'
    const at = source.indexOf('x') + 1
    expect(run(source, typing(at, 'y', false)).commit.revision.source).toBe('```js\n\n\nxy\n\n```\n')
  })

  it('leaves code blocks the input does not edit byte for byte', () => {
    const source = '```\n\nkeep\n\n```\n\npara\n\n~~~\n\nedit\n\n~~~\n'
    const at = source.indexOf('edit') + 4
    expect(run(source, typing(at, '!')).commit.revision.source)
      .toBe('```\n\nkeep\n\n```\n\npara\n\n~~~\nedit!\n~~~\n')
    const outside = source.indexOf('para') + 4
    expect(run(source, typing(outside, '!')).commit.revision.source)
      .toBe('```\n\nkeep\n\n```\n\npara!\n\n~~~\n\nedit\n\n~~~\n')
  })

  it('keeps the empty line Enter just opened, with its caret', () => {
    const source = '```\nx\n```\n'
    const at = source.indexOf('x') + 1
    const { commit, selection } = run(source, enter(at))
    expect(commit.revision.source).toBe('```\nx\n\n```\n')
    expect(caret(selection)).toBe('```\nx\n'.length)
  })

  it('trims inside a container and keeps the container prefix of kept lines', () => {
    const source = '> ```\n>\n> x\n>\n> ```\n'
    const at = source.indexOf('x') + 1
    expect(run(source, typing(at, 'y')).commit.revision.source).toBe('> ```\n> xy\n> ```\n')
  })

  it('leaves whitespace-only lines, which upstream keeps as code', () => {
    const source = '```\n  \nx\n```\n'
    const at = source.indexOf('x') + 1
    expect(run(source, typing(at, 'y')).commit.revision.source).toBe('```\n  \nxy\n```\n')
  })

  it('does not trim for a tracked input', () => {
    const source = '```\n\nx\n\n```\n'
    const at = source.indexOf('x') + 1
    const { commit } = run(source, typing(at, 'y'), true)
    expect(commit.revision.source).not.toContain('```\nxy\n```')
  })

  it('is one operation that a single inverse restores', () => {
    const source = 'intro\n\n```\n\n\nx\n\n```\n'
    const at = source.indexOf('x') + 1
    const { core, commit } = run(source, typing(at, 'y'))
    expect(commit.revision.source).toBe('intro\n\n```\nxy\n```\n')
    const undone = core.apply(commit.revision, inverse(source, commit.change.appliedEdits))
    expect(undone.revision.source).toBe(source)
  })

  it('reads a long block\'s edges beyond the window around a regional edit', () => {
    const filler = 'Lorem ipsum *dolor* sit amet.\n\n'.repeat(4000)
    const body = Array.from({ length: 400 }, (_, index) => `line ${index}`).join('\n')
    const source = `${filler}\`\`\`\n\n\n${body}\n\n\n\`\`\`\n\n${filler}`
    const core = createDocumentCore()
    let revision = core.open(source)
    // A first edit leaves a revision planned from windows.
    const warm = typing(source.length - 3, '!')
    const warmPlan = core.planInput(revision, warm, { tracked: false })
    revision = core.apply(revision, core.inputEdits(revision, warm, warmPlan, false) ?? []).revision
    const at = revision.source.indexOf('line 200') + 8
    const action = typing(at, 'y')
    const plan = core.planInput(revision, action, { tracked: false })
    const next = core.apply(revision, core.inputEdits(revision, action, plan, false) ?? []).revision
    expect(next.source).toBe(revision.source.replace('```\n\n\nline 0', '```\nline 0').replace('line 200', 'line 200y').replace('line 399\n\n\n```', 'line 399\n```'))
  })

  it('opens and leaves an unedited document byte for byte', () => {
    const source = '```\n\n\nx\n\n```\n'
    const core = createDocumentCore()
    const revision: DocumentRevision = core.open(source)
    expect(revision.source).toBe(source)
  })
})

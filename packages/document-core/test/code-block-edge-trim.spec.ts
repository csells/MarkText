import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction, type DocumentRevision, type DocumentSourceEdit } from '../src/index.js'

// Upstream's trimUnnecessaryCodeBlockEmptyLines, edit-scoped: only the code
// block an edit changes loses its edge empty lines, in that edit's own
// operation; a tracked edit suggests the trim with it.

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

  it.each([
    { name: 'typing', source: '```js\n\n\nx\n\n```\n\nafter\n', act: (source: string) => typing(source.indexOf('x') + 1, 'y') },
    { name: 'Enter', source: '```\n\nx\n\n```\n', act: (source: string) => enter(source.indexOf('x') + 1) },
    {
      name: 'deletion',
      source: '```\n\nalpha\n\n```\n',
      act: (source: string) => {
        const at = source.indexOf('alpha') + 5
        return { selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, range: { start: at - 1, end: at }, inputType: 'deleteContentBackward', data: null, options: options(true) } as DocumentInputAction
      }
    }
  ])('suggests the trim with tracked $name, so Accept All equals the untracked edit', ({ source, act }) => {
    const untracked = run(source, act(source)).commit.revision.source
    const { core, commit } = run(source, act(source), true)
    expect(commit.revision.source).not.toBe(untracked)
    expect(core.project(commit.revision, 'revised').markdown).toBe(untracked)
    expect(core.project(commit.revision, 'original').markdown).toBe(source)
    const undone = core.apply(commit.revision, inverse(source, commit.change.appliedEdits))
    expect(undone.revision.source).toBe(source)
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

  it.each([
    { kind: 'paste' as const, select: 'pha', markdown: 'zz', expected: '```\nalzz\n```\n\n```\n\nkeep\n\n```\n' },
    { kind: 'cut' as const, select: 'pha', markdown: '', expected: '```\nal\n```\n\n```\n\nkeep\n\n```\n' }
  ])('trims the code block a $kind changes, and only that one', ({ kind, select, markdown, expected }) => {
    const source = '```\n\nalpha\n\n```\n\n```\n\nkeep\n\n```\n'
    const start = source.indexOf(select)
    const selection = { ranges: [{ anchor: start, focus: start + select.length }], primary: 0 }
    for (const trim of [true, false]) {
      const core = createDocumentCore()
      const revision = core.open(source)
      const action = kind === 'cut'
        ? { kind, selection, tracked: false, trimUnnecessaryCodeBlockEmptyLines: trim }
        : { kind, selection, markdown, tracked: false, trimUnnecessaryCodeBlockEmptyLines: trim }
      const plan = core.planClipboard(revision, action)
      const result = core.apply(revision, plan.edits).revision.source
      const typed = source.slice(0, start) + markdown + source.slice(start + select.length)
      expect(result).toBe(trim ? expected : typed)
      const caret = (trim ? expected : typed).indexOf('al') + 2 + markdown.length
      expect(plan.selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
    }
  })

  it.each([
    { kind: 'paste' as const, markdown: 'zz' },
    { kind: 'cut' as const, markdown: '' }
  ])('suggests the trim with a tracked $kind, so Accept All equals the untracked $kind', ({ kind, markdown }) => {
    const source = '```\n\nalpha\n\n```\n\nafter\n'
    const start = source.indexOf('pha')
    const selection = { ranges: [{ anchor: start, focus: start + 3 }], primary: 0 }
    const plan = (core: ReturnType<typeof createDocumentCore>, revision: DocumentRevision, tracked: boolean) => core.planClipboard(revision, kind === 'cut'
      ? { kind, selection, tracked, trimUnnecessaryCodeBlockEmptyLines: true }
      : { kind, selection, markdown, tracked, trimUnnecessaryCodeBlockEmptyLines: true })
    const plain = createDocumentCore()
    const plainRevision = plain.open(source)
    const untracked = plain.apply(plainRevision, plan(plain, plainRevision, false).edits).revision.source
    const core = createDocumentCore()
    const revision = core.open(source)
    const commit = core.apply(revision, plan(core, revision, true).edits)
    expect(core.project(commit.revision, 'revised').markdown).toBe(untracked)
    expect(core.project(commit.revision, 'original').markdown).toBe(source)
    expect(core.apply(commit.revision, inverse(source, commit.change.appliedEdits)).revision.source).toBe(source)
  })

  it('trims every code block an edit set such as a Find replacement changes', () => {
    const source = '```\n\nfoo\n\n```\n\nfoo outside\n\n~~~\n\nfoo\n~~~\n\n```\n\nbar\n\n```\n'
    const core = createDocumentCore()
    const revision = core.open(source)
    const edits = [...source.matchAll(/foo/gu)].map(match => ({ start: match.index, end: match.index + 3, insert: 'baz' }))
    const trim = { trimUnnecessaryCodeBlockEmptyLines: true }
    expect(core.normalizeEdits(revision, [], trim)).toEqual([])
    expect(core.normalizeEdits(revision, edits, {})).toEqual(edits)
    const trimmed = core.normalizeEdits(revision, edits, trim)
    expect(core.apply(revision, trimmed).revision.source)
      .toBe('```\nbaz\n```\n\nbaz outside\n\n~~~\nbaz\n~~~\n\n```\n\nbar\n\n```\n')
  })

  it('opens and leaves an unedited document byte for byte', () => {
    const source = '```\n\n\nx\n\n```\n'
    const core = createDocumentCore()
    const revision: DocumentRevision = core.open(source)
    expect(revision.source).toBe(source)
  })
})

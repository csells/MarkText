import { describe, expect, it } from 'vitest'
import { createDocumentCore, type CriticMarkupAnnotation, type DocumentInputAction, type DocumentRevision, type DocumentSourceEdit } from '../src/index.js'
import { positionAfter } from '../src/sourcePosition.js'
import { projectionSignature } from '../src/trackedExtent.js'

// Owner requirement: with Track Changes on, every edit available untracked is
// available tracked. Accept-all reproduces the untracked result, Reject-all the
// previous source. A rendering-identical spelling is admitted only where byte
// identity is impossible (a final escape, a block literal whose closer must
// start its own line); those rows say so.

const splice = (source: string, edit: DocumentSourceEdit): string =>
  source.slice(0, edit.start) + edit.insert + source.slice(edit.end)

/** Accept All / Reject All: every top-level annotation resolves in one transaction. */
function resolveAll(source: string, decision: 'accept' | 'reject'): string {
  const core = createDocumentCore()
  let revision: DocumentRevision = core.open(source)
  while (revision.annotations.length > 0) {
    const current = revision
    const arm = (annotation: CriticMarkupAnnotation, name: string): string => {
      const range = annotation.arms.find(item => item.name === name)?.range
      return range === undefined ? '' : current.source.slice(range.start, range.end)
    }
    const kept: Record<CriticMarkupAnnotation['kind'], string> = { addition: decision === 'accept' ? 'content' : '', deletion: decision === 'accept' ? '' : 'content', substitution: decision === 'accept' ? 'new' : 'old', highlight: 'content', comment: '' }
    revision = core.apply(current, current.annotations.map(annotation => ({ ...annotation.range, insert: arm(annotation, kept[annotation.kind]) }))).revision
  }
  return revision.source
}

/** Rendering identity of materialized Markdown, read from an isolated parse. */
function rendering(markdown: string): string {
  const core = createDocumentCore()
  return projectionSignature(core.project(core.open(markdown), 'revised').ast.root)
}

const keptArm: Record<CriticMarkupAnnotation['kind'], Record<'accept' | 'reject', string>> = {
  addition: { accept: 'content', reject: '' },
  deletion: { accept: '', reject: 'content' },
  substitution: { accept: 'new', reject: 'old' },
  highlight: { accept: 'content', reject: 'content' },
  comment: { accept: '', reject: '' }
}

type Equivalence = 'exact' | 'rendering'

interface Row {
  readonly name: string
  readonly source: string
  readonly at: number | readonly [number, number]
  readonly insert: string
  /** Expected tracked source; omitted where a concurrent parser rule may change the spelling. */
  readonly tracked?: string
  /** Accept-all target when it is not the untracked splice (typing inside a draft). */
  readonly accepted?: string
  readonly equivalence?: Equivalence
}

const rows: readonly Row[] = [
  // A closer after the opener on its line is info string (L2c needs it to
  // begin a line), so the arm must end with the opener's line break.
  { name: '``` typed at the end of an addition', source: 'a\n\n{++b\n++}', at: 8, insert: '```', tracked: 'a\n\n{++b\n```\n++}', accepted: 'a\n\nb\n```', equivalence: 'rendering' },
  { name: '``` typed at the end of an addition before more text', source: 'a\n\n{++b\n++}\n\nc\n', at: 8, insert: '```', tracked: 'a\n\n{~~{++b\n++}\n\nc\n~>b\n```\n\nc\n~~}', accepted: 'a\n\nb\n```\n\nc\n' },
  { name: '``` typed at a line start mid-document', source: 'a\n\nb\n\nc\n', at: 3, insert: '```\n', tracked: 'a\n\n{~~b\n\nc\n~>```\nb\n\nc\n~~}' },
  { name: '``` typed before text on a new line', source: 'a\nb\n', at: 2, insert: '```', tracked: 'a\n{~~b\n~>```b\n~~}' },
  { name: '~~~ typed at the end of an addition', source: 'a\n\n{++b\n++}', at: 8, insert: '~~~', tracked: 'a\n\n{++b\n~~~\n++}', accepted: 'a\n\nb\n~~~', equivalence: 'rendering' },
  { name: '~~~ typed at a line start mid-document', source: 'a\n\nb\n\nc\n', at: 3, insert: '~~~', tracked: 'a\n\n{~~b\n\nc\n~>~~~b\n\nc\n~~}' },
  { name: 'four spaces typed at the end of an addition', source: 'a\n\n{++b\n++}', at: 8, insert: '    x', tracked: 'a\n\n{++b\n    x++}', accepted: 'a\n\nb\n    x' },
  { name: 'four spaces typed at a line start mid-document', source: 'a\n\nb\n\nc\n', at: 3, insert: '    ', tracked: 'a\n\n{~~b\n~>    b\n~~}\nc\n' },
  { name: '<div> typed at the end of an addition', source: 'a\n\n{++b\n++}', at: 8, insert: '<div>', tracked: 'a\n\n{++b\n<div>\n++}', accepted: 'a\n\nb\n<div>', equivalence: 'rendering' },
  { name: '<div> typed at a line start mid-document', source: 'a\n\nb\n\nc\n', at: 3, insert: '<div>', tracked: 'a\n\n{~~b\n~><div>b\n~~}\nc\n' },
  { name: '<!-- typed at the end of an addition', source: 'a\n\n{++b\n++}', at: 8, insert: '<!--', tracked: 'a\n\n{++b\n<!--\n++}', accepted: 'a\n\nb\n<!--', equivalence: 'rendering' },
  { name: '<!-- typed at a line start mid-document', source: 'a\n\nb\n\nc\n', at: 3, insert: '<!--', tracked: 'a\n\n{~~b\n~><!--b\n~~}\nc\n' },
  { name: 'trailing backslash mid-line', source: 'abc def\n', at: 3, insert: '\\', tracked: 'abc{~~ ~>\\ ~~}def\n' },
  { name: 'trailing backslash at a line start', source: 'a\n\nbc\n', at: 3, insert: '\\', tracked: 'a\n\n{~~b~>\\b~~}c\n' },
  { name: 'trailing backslash before an EOL', source: 'abc\n', at: 3, insert: '\\', tracked: 'abc{~~\n~>\\\n~~}' },
  { name: 'trailing backslash at EOF', source: 'abc', at: 3, insert: '\\', tracked: 'abc{++\\\\++}', equivalence: 'rendering' },
  { name: 'reference definition typed at a line start', source: 'x [a]\n\ny\n', at: 7, insert: '[a]: ' },
  { name: 'HTML after a paragraph', source: 'hello', at: 5, insert: '\n\n<p>x</p>', tracked: 'hello{++\n\n<p>x</p>\n++}', equivalence: 'rendering' },
  { name: 'HTML in a list', source: '- a\n- b\n', at: 3, insert: '\n  <div>x</div>', tracked: '- a\n{++  <div>x</div>\n++}- b\n' },
  { name: 'HTML in a blockquote', source: '> a\n\nb\n', at: 3, insert: '\n> <div>x</div>' },
  { name: 'insertion inside an HTML block', source: '<div>\nword\n</div>\n\nafter\n', at: 8, insert: 'X', tracked: '{~~<div>\nword\n</div>\n~><div>\nwoXrd\n</div>\n~~}\nafter\n' },
  { name: 'insertion inside an EOF-terminated HTML block', source: '<div>word</div>\n', at: 7, insert: 'X', tracked: '{~~<div>word</div>\n~><div>woXrd</div>\n~~}' },
  { name: 'deletion inside an HTML block', source: '<div>\nword\n</div>\n\nafter\n', at: [7, 9], insert: '', tracked: '{~~<div>\nword\n</div>\n~><div>\nwd\n</div>\n~~}\nafter\n' },
  { name: 'insertion inside a code block', source: '```\nword\n```\n', at: 6, insert: 'X', tracked: '{~~```\nword\n```\n~>```\nwoXrd\n```\n~~}' },
  { name: 'deletion inside a code block', source: '```\nword\n```\n', at: [5, 7], insert: '', tracked: '{~~```\nword\n```\n~>```\nwd\n```\n~~}' },
  { name: 'deleting a fence opener', source: 'a\n\n```\nword\n```\n', at: [3, 7], insert: '', tracked: 'a\n\n{~~```\nword\n```\n~>word\n```\n~~}' },
  { name: 'deleting an HTML block with its following blank line', source: 'a\n\n<div>x</div>\n\nb\n', at: [3, 17], insert: '', tracked: 'a\n\n{--<div>x</div>\n\n--}b\n' },
  { name: 'a backtick that pairs with a later code span', source: 'a `b` c', at: 2, insert: '`', tracked: 'a {++`++}`b` c' },
  { name: 'a backtick that completes a code span', source: 'a b` c', at: 2, insert: '`', tracked: 'a {++`b`++}{--b`--} c' }
]

describe('tracked edits reproduce untracked editing', () => {
  it.each(rows)('$name', row => {
    const [start, end] = typeof row.at === 'number' ? [row.at, row.at] : row.at
    const input = { start, end, insert: row.insert }
    const core = createDocumentCore()
    const previous = core.open(row.source)
    const planned = core.trackedEdit(previous, input)
    expect(planned, 'a tracked edit must never be refused').toBeDefined()
    const commit = core.apply(previous, [planned!])
    const tracked = commit.revision.source
    if (row.tracked !== undefined) expect(tracked).toBe(row.tracked)

    const untracked = row.accepted ?? splice(row.source, input)
    const accepted = resolveAll(tracked, 'accept')
    const rejected = resolveAll(tracked, 'reject')
    const previousOriginal = resolveAll(row.source, 'reject')
    const equivalence: Equivalence = row.equivalence ?? 'exact'
    if (equivalence === 'exact') {
      expect(accepted).toBe(untracked)
      expect(rejected).toBe(previousOriginal)
    } else {
      expect(rendering(accepted)).toBe(rendering(untracked))
      expect(rendering(rejected)).toBe(rendering(previousOriginal))
    }
    // The Revised view reads as the untracked result; its projection closes a
    // fence that an arm boundary ended (L2c).
    if (row.accepted === undefined && equivalence === 'exact') {
      const untrackedCore = createDocumentCore()
      const untrackedRevision = untrackedCore.apply(untrackedCore.open(row.source), [input]).revision
      const revised = core.project(commit.revision, 'revised')
      expect(projectionSignature(revised.ast.root)).toBe(rendering(untrackedRevision.source))
      expect(rendering(revised.markdown)).toBe(rendering(untrackedRevision.source))
      expect(core.project(commit.revision, 'original').markdown).toBe(core.project(previous, 'original').markdown)
    }

    // Each suggestion is reviewed on its own: resolving one leaves the rest formed.
    commit.revision.annotations.forEach((annotation, index) => {
      for (const decision of ['accept', 'reject'] as const) {
        const review = createDocumentCore()
        const opened = review.open(tracked)
        const alone = review.resolve(opened, opened.annotations[index]!, decision).revision
        const kept = annotation.arms.find(arm => arm.name === keptArm[annotation.kind][decision])
        expect(alone.annotations.length).toBe(opened.annotations.length - 1 + (kept?.annotations.length ?? 0))
        expect(alone.diagnostics.length).toBe(opened.diagnostics.length)
      }
    })

    // The caret follows the typed text into the suggestion.
    const map = core.editingReconciliation(previous, input, commit)
    expect(map).toBeDefined()
    const caret = positionAfter(map!, start + row.insert.length, false)
    expect(caret).toBeGreaterThanOrEqual(planned!.start)
    expect(caret).toBeLessThanOrEqual(planned!.start + planned!.insert.length)

    // Undo restores the exact previous source; redo the same suggestion.
    const undo = { start: planned!.start, end: planned!.start + planned!.insert.length, insert: row.source.slice(planned!.start, planned!.end) }
    const undone = core.apply(commit.revision, [undo]).revision
    expect(undone.source).toBe(row.source)
    expect(core.apply(undone, [planned!]).revision.source).toBe(tracked)
  })
})

describe('typing inside one\'s own Addition keeps untracked inline pairing', () => {
  // Accepting the draft removes its arm boundary, so a delimiter typed inside
  // can pair with text outside it. The Revised view must already show that.
  it.each([
    { name: 'an asterisk opening emphasis with later text', source: 'a *b {++cd++} e* f', at: 8, insert: '*' },
    { name: 'a double asterisk inside emphasis', source: 'a *b {++cd++} e* f', at: 9, insert: '**' },
    { name: 'an asterisk closing emphasis', source: '*a {++cd++} e', at: 8, insert: '*' },
    { name: 'a backtick pairing with a later backtick', source: 'a {++cd++} e` f', at: 6, insert: '`' },
    { name: 'a backtick before a following backtick', source: 'a {++c d++}`', at: 5, insert: '`' },
    { name: 'a dollar pairing with later math', source: 'a {++cd++}$ e', at: 5, insert: '$' },
    { name: 'an underscore closing emphasis', source: 'a _b {++cd++} e_ f', at: 10, insert: '_' },
    { name: 'a tilde pair inside strikethrough', source: 'a ~~b {++cd++} e~~ f', at: 10, insert: '~~' },
    { name: 'a bracket inside link text', source: 'a [b {++cd++} e](u) f', at: 9, insert: ']' }
  ])('$name', ({ source, at, insert }) => {
    const core = createDocumentCore()
    const previous = core.open(source)
    expect(previous.annotations).toHaveLength(1)
    const planned = core.trackedEdit(previous, { start: at, end: at, insert })
    expect(planned).toBeDefined()
    const commit = core.apply(previous, [planned!])
    const open = source.indexOf('{++')
    const close = source.indexOf('++}')
    const untracked = source.slice(0, open) + source.slice(open + 3, at) + insert + source.slice(at, close) + source.slice(close + 3)
    expect(resolveAll(commit.revision.source, 'accept')).toBe(untracked)
    expect(resolveAll(commit.revision.source, 'reject')).toBe(resolveAll(source, 'reject'))
    expect(projectionSignature(core.project(commit.revision, 'revised').ast.root)).toBe(rendering(untracked))
  })

  it('keeps a plain word as a direct extension', () => {
    const core = createDocumentCore()
    const previous = core.open('a *b {++cd++} e* f')
    expect(core.trackedEdit(previous, { start: 9, end: 9, insert: 'xy z' })).toEqual({ start: 9, end: 9, insert: 'xy z' })
  })
})

describe('typing inside tracked history splits it at the caret', () => {
  it.each([
    { name: 'a deletion', source: 'x {--abcd--} y', at: 6, split: 'x {--a--}{++X++}{--bcd--} y', extended: 'x {--a--}{++XY++}{--bcd--} y', revised: 'x X y' },
    { name: 'an old arm', source: 'x {~~abcd~>new~~} y', at: 6, split: 'x {--a--}{++X++}{~~bcd~>new~~} y', extended: 'x {--a--}{++XY++}{~~bcd~>new~~} y', revised: 'x Xnew y' },
    { name: 'a deletion at a self-contained boundary', source: 'x {--a*b*c--} y', at: 7, split: 'x {--a--}{++X++}{--*b*c--} y', extended: 'x {--a--}{++XY++}{--*b*c--} y', revised: 'x X y' }
  ])('in $name', ({ source, at, split, extended, revised }) => {
    const core = createDocumentCore()
    const previous = core.open(source)
    const input = { start: at, end: at, insert: 'X' }
    const first = core.trackedEdit(previous, input)
    expect(first).toBeDefined()
    const commit = core.apply(previous, [first!])
    expect(commit.revision.source).toBe(split)
    expect(core.project(commit.revision, 'original').markdown).toBe(core.project(previous, 'original').markdown)
    expect(core.project(commit.revision, 'revised').markdown).toBe(revised)
    const map = core.editingReconciliation(previous, input, commit)
    expect(map).toBeDefined()
    const caret = positionAfter(map!, at + 1, false)
    expect(split.slice(caret - 1, caret)).toBe('X')

    // Further typing extends the Addition; Backspace removes it and the
    // retained history on both sides rejoins its single annotation.
    const second = core.apply(commit.revision, [core.trackedEdit(commit.revision, { start: caret, end: caret, insert: 'Y' })!])
    expect(second.revision.source).toBe(extended)
    const third = core.apply(second.revision, [core.trackedEdit(second.revision, { start: caret, end: caret + 1, insert: '' })!])
    expect(third.revision.source).toBe(split)
    const removal = core.trackedEdit(third.revision, { start: caret - 1, end: caret, insert: '' })
    expect(removal).toBeDefined()
    expect(core.apply(third.revision, [removal!]).revision.source).toBe(source)
  })
})

describe('a final escape completion re-trims when typing continues', () => {
  it('keeps the author\'s single backslash', () => {
    const core = createDocumentCore()
    const previous = core.open('abc')
    const first = { start: 3, end: 3, insert: '\\' }
    const commit = core.apply(previous, [core.trackedEdit(previous, first)!])
    expect(commit.revision.source).toBe('abc{++\\\\++}')
    const caret = positionAfter(core.editingReconciliation(previous, first, commit)!, 4, false)
    expect(caret).toBe(8)
    const second = { start: caret, end: caret, insert: 'd' }
    const next = core.apply(commit.revision, [core.trackedEdit(commit.revision, second)!])
    expect(next.revision.source).toBe('abc{++\\d++}')
    expect(core.project(next.revision, 'revised').markdown).toBe('abc\\d')
    expect(positionAfter(core.editingReconciliation(commit.revision, second, next)!, caret + 1, false)).toBe(8)
  })
})

describe('structural commands compile through the tracked path', () => {
  const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
  const listOptions = { bulletListMarker: '-', orderListDelimiter: '.' }
  const sources = ['hello\n', 'a\n\nhello\n\nb\n', '- a\n- hello\n', '> hello\n', '# hello\n', 'hello', '<div>\nhello\n</div>\n', '```\nhello\n```\n']
  const commands = [
    { command: 'createCodeBlock', replace: false }, { command: 'createCodeBlock', replace: true },
    { command: 'createMathBlock', replace: false }, { command: 'createMathBlock', replace: true },
    { command: 'createHtmlBlock', replace: false, selectionMode: 'content' }, { command: 'createHtmlBlock', replace: true, selectionMode: 'end' },
    { command: 'createTable', rows: 2, columns: 2, replace: false },
    { command: 'changeHeading', change: { type: 'set', level: 1 } }, { command: 'changeHeading', change: { type: 'toggle', level: 2 } },
    { command: 'changeBlockquote', change: { type: 'toggle' } },
    { command: 'changeList', change: { type: 'toggle', kind: 'ordered' }, listOptions },
    { command: 'changeList', change: { type: 'toggle', kind: 'bullet' }, listOptions },
    { command: 'changeList', change: { type: 'toggle', kind: 'task' }, listOptions },
    { command: 'changeThematicBreak', change: { type: 'insert' } },
    { command: 'changeBlock', change: { type: 'new', scope: 'leaf', selectionMode: 'start', placement: 'after' } },
    { command: 'changeBlock', change: { type: 'duplicate', scope: 'leaf', selectionMode: 'start' } },
    { command: 'changeBlock', change: { type: 'delete', scope: 'leaf', selectionMode: 'start' } },
    { command: 'changeBlock', change: { type: 'reset', scope: 'leaf', selectionMode: 'start' } },
    { command: 'resetCodeBlock', selectionMode: 'preserve' }
  ]
  const cases = sources.flatMap(source => commands.map(command => ({ source, command, label: `${JSON.stringify(source)} ${JSON.stringify(command)}` })))
  it.each(cases)('$label', ({ source, command }) => {
    const at = Math.max(0, source.indexOf('hello') + 2)
    const action = { kind: 'command', ...command, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options } as DocumentInputAction
    const untrackedCore = createDocumentCore()
    const untrackedPrevious = untrackedCore.open(source)
    const core = createDocumentCore()
    const previous = core.open(source)
    let untrackedEdits: readonly DocumentSourceEdit[] | undefined
    let unavailable: Error | undefined
    try {
      untrackedEdits = untrackedCore.inputEdits(untrackedPrevious, action, untrackedCore.planInput(untrackedPrevious, action), false)
    } catch (error) {
      unavailable = error as Error
    }
    // A command unavailable here untracked (reset outside code, a heading
    // command outside a paragraph) is unavailable tracked for the same reason.
    if (unavailable !== undefined) {
      expect(() => core.inputEdits(previous, action, core.planInput(previous, action), true)).toThrow(unavailable.message)
      return
    }
    expect(untrackedEdits, 'the untracked command is available').toBeDefined()
    if (untrackedEdits!.length === 0) {
      // A command with nothing to change untracked changes nothing tracked.
      expect(core.inputEdits(previous, action, core.planInput(previous, action), true)).toEqual([])
      return
    }
    const untracked = untrackedCore.apply(untrackedPrevious, untrackedEdits!).revision.source

    const edits = core.inputEdits(previous, action, core.planInput(previous, action), true)
    expect(edits, 'a tracked command must never be refused').toBeDefined()
    const tracked = core.apply(previous, edits!).revision.source
    const accepted = resolveAll(tracked, 'accept')
    const rejected = resolveAll(tracked, 'reject')
    if (accepted === untracked) expect(rejected).toBe(source)
    else {
      // Only a literal block ending at EOF without a newline needs its
      // closer on its own line.
      expect(source.endsWith('\n')).toBe(false)
      expect(rendering(accepted)).toBe(rendering(untracked))
      expect(rendering(rejected)).toBe(rendering(source))
    }
  })
})

describe('edits over existing suggestions follow Google Docs (plan 0012 G34)', () => {
  // Deleted text and annotation syntax are not editable: an edit over them
  // changes only the rest, so Accept All is the untracked edit of the
  // visible text (`accepted`) and Reject All the previous Original.
  const rows: ReadonlyArray<{ name: string, source: string, at: number | readonly [number, number], insert: string, tracked: string, accepted: string }> = [
    { name: 'Backspace before a deletion extends it leftward', source: 'hell{--o--} world\n', at: [3, 4], insert: '', tracked: 'hel{--lo--} world\n', accepted: 'hel world\n' },
    { name: 'Delete after a deletion extends it rightward', source: '{--h--}ello\n', at: [7, 8], insert: '', tracked: '{--he--}llo\n', accepted: 'llo\n' },
    { name: 'a deletion between two deletions joins them', source: 'a{--b--}c{--d--}e\n', at: [8, 9], insert: '', tracked: 'a{--bcd--}e\n', accepted: 'ae\n' },
    { name: 'a deletion before a Substitution extends its old text', source: 'ab{~~c~>d~~}e\n', at: [1, 2], insert: '', tracked: 'a{~~bc~>d~~}e\n', accepted: 'ade\n' },
    { name: 'deleting deleted text is a no-op', source: 'the {--slow --}fox\n', at: [8, 10], insert: '', tracked: 'the {--slow --}fox\n', accepted: 'the fox\n' },
    { name: 'deleting old text is a no-op', source: 'the {~~slow~>fast~~} fox\n', at: [8, 10], insert: '', tracked: 'the {~~slow~>fast~~} fox\n', accepted: 'the fast fox\n' },
    { name: 'deleting only a delimiter is a no-op', source: 'a{++x++}b\n', at: [6, 7], insert: '', tracked: 'a{++x++}b\n', accepted: 'axb\n' },
    { name: 'typing before a deletion merges into one Substitution', source: 'he{--llo--} world\n', at: 2, insert: 'Z', tracked: 'he{~~llo~>Z~~} world\n', accepted: 'heZ world\n' },
    { name: 'typing at a deletion\'s first character merges too', source: 'he{--llo--} world\n', at: 5, insert: 'Z', tracked: 'he{~~llo~>Z~~} world\n', accepted: 'heZ world\n' },
    { name: 'typing before a deleted block stays its own Addition', source: 'a\n\n{--b\n\nc--}\n', at: 3, insert: 'Z', tracked: 'a\n\n{++Z++}{--b\n\nc--}\n', accepted: 'a\n\nZ\n' },
    { name: 'typing inside a deletion splits it', source: 'x {--abcd--} y', at: 6, insert: 'X', tracked: 'x {--a--}{++X++}{--bcd--} y', accepted: 'x X y' },
    { name: 'typing at an old arm\'s end types into the proposed text', source: 'the {~~slow~>fast~~} fox\n', at: 11, insert: 'X', tracked: 'the {~~slow~>Xfast~~} fox\n', accepted: 'the Xfast fox\n' },
    { name: 'typing at an old arm\'s start types into the proposed text', source: 'the {~~slow~>fast~~} fox\n', at: 7, insert: 'X', tracked: 'the {~~slow~>Xfast~~} fox\n', accepted: 'the Xfast fox\n' },
    { name: 'typing inside a comment types after it', source: 'a{>>note<<}b\n', at: 5, insert: 'X', tracked: 'a{>>note<<}{++X++}b\n', accepted: 'aXb\n' },
    { name: 'replacing a selection containing a deletion keeps it inside one replacement', source: 'ab {--cd--} ef\n', at: [1, 13], insert: 'X', tracked: 'a{~~b {--cd--} e~>X~~}f\n', accepted: 'aXf\n' },
    { name: 'replacing from inside a deletion proposes the rest', source: 'the {--slow --}fox\n', at: [9, 17], insert: 'X', tracked: 'the {--slow --}{~~fo~>X~~}x\n', accepted: 'the Xx\n' },
    { name: 'replacing to inside a deletion proposes the rest', source: 'the {--slow --}fox\n', at: [1, 9], insert: 'X', tracked: 't{~~he ~>X~~}{--slow --}fox\n', accepted: 'tXfox\n' },
    { name: 'typing over deleted text only types at the selection start', source: 'the {--slow --}fox\n', at: [8, 10], insert: 'X', tracked: 'the {--s--}{++X++}{--low --}fox\n', accepted: 'the Xfox\n' },
    { name: 'replacing across a Substitution\'s arms edits the proposed text', source: 'the {~~slow~>fast~~} fox\n', at: [9, 15], insert: 'X', tracked: 'the {~~slow~>Xst~~} fox\n', accepted: 'the Xst fox\n' },
    { name: 'deleting across one\'s own Addition removes it and strikes the rest', source: 'a {++xy++}cd\n', at: [6, 11], insert: '', tracked: 'a {++x++}{--c--}d\n', accepted: 'a xd\n' },
    { name: 'deleting across a deletion strikes only the rest', source: 'ab{--cd--}ef\n', at: [1, 11], insert: '', tracked: 'a{--b--}{--cd--}{--e--}f\n', accepted: 'af\n' }
  ]
  it.each(rows)('$name', row => {
    const [start, end] = typeof row.at === 'number' ? [row.at, row.at] : row.at
    const core = createDocumentCore()
    const previous = core.open(row.source)
    const planned = core.trackedEdit(previous, { start, end, insert: row.insert })
    expect(planned, 'a tracked edit must never be refused').toBeDefined()
    const unchanged = planned!.start === planned!.end && planned!.insert === ''
    const next = unchanged ? previous : core.apply(previous, [planned!]).revision
    expect(next.source).toBe(row.tracked)
    expect(resolveAll(next.source, 'accept')).toBe(row.accepted)
    expect(resolveAll(next.source, 'reject')).toBe(resolveAll(row.source, 'reject'))
    expect(core.project(next, 'original').markdown).toBe(core.project(previous, 'original').markdown)
    // Each suggestion is reviewed on its own: resolving one leaves the rest formed.
    for (const [index] of next.annotations.entries()) {
      for (const decision of ['accept', 'reject'] as const) {
        const review = createDocumentCore()
        const opened = review.open(next.source)
        expect(review.resolve(opened, opened.annotations[index]!, decision).revision.diagnostics).toHaveLength(0)
      }
    }
    if (unchanged) return
    // Undo restores the exact previous source.
    const undo = { start: planned!.start, end: planned!.start + planned!.insert.length, insert: row.source.slice(planned!.start, planned!.end) }
    expect(core.apply(next, [undo]).revision.source).toBe(row.source)
  })
})

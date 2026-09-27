import { describe, expect, it } from 'vitest'
import { createDocumentCore, type CriticMarkupAnnotation, type DocumentCore, type DocumentInputAction, type DocumentRevision, type SourceRange } from '../src/index.js'

// Unicode inside and beside annotations through the production input path
// (planInput, inputEdits, apply, reconcileInput). The editing view targets
// Delete at one whole grapheme of the visible text, and Backspace inside a
// line at what Chromium's Backspace removes: the whole of an emoji, flag or
// astral character, but only the last code point of a combining sequence
// (Muya's `backspaceLength`). The model must keep exactly that target, never
// split a surrogate pair, and keep every other grapheme whole.

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

// Each sample with what Backspace after it leaves of it.
const samples = [
  ['ASCII baseline', 'x', ''],
  ['ZWJ family', '👩\u200D👩\u200D👧', ''],
  ['regional-indicator flag', '🇯🇵', ''],
  ['combining acute', 'e\u0301', 'e'],
  ['decomposed Hangul syllable', '\u1100\u1161\u11A8', '\u1100\u1161'],
  ['astral letter', '𝒳', ''],
  ['astral emoji', '😀', '']
] as const

/**
 * The code units of `grapheme` that Chromium's Backspace removes, for the
 * samples here: the last code point after a combining mark or Hangul jamo,
 * otherwise the whole grapheme.
 */
function backspaceUnit(grapheme: string): number {
  const last = [...grapheme].at(-1)!
  return grapheme !== last && /^[\p{M}\u1160-\u11FF]$/u.test(last) && !/\p{Extended_Pictographic}/u.test(grapheme)
    ? last.length
    : grapheme.length
}

/** The source range the view targets for Backspace or Delete beside a caret. */
function neighbor(core: DocumentCore, revision: DocumentRevision, caret: number, backward: boolean): SourceRange {
  const { coordinates, ast } = core.project(revision, 'markup').syntax
  let visible = ''
  for (let offset = 0; offset < ast.root.range.end; offset += 1) {
    const origin = coordinates.originAt(offset)
    visible += origin.kind === 'source' ? revision.source[origin.sourceOffset] : '￼'
  }
  const projected = coordinates.toProjected(caret, backward ? 'previous' : 'next')
  let start = 0
  for (const { segment } of graphemes.segment(visible)) {
    const end = start + segment.length
    if (backward ? end === projected : start === projected) {
      if (backward) start = end - backspaceUnit(segment)
      const first = coordinates.originAt(start)
      const last = coordinates.originAt(end - 1)
      if (first.kind !== 'source' || last.kind !== 'source') break
      return { start: first.sourceOffset, end: last.sourceOffset + 1 }
    }
    start = end
  }
  throw new Error('No visible grapheme beside the caret')
}

/** Every UTF-16 surrogate in `text` belongs to a complete pair. */
function pairedSurrogates(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index)
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = text.charCodeAt(index + 1)
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return false
      index += 1
    } else if (unit >= 0xDC00 && unit <= 0xDFFF) return false
  }
  return true
}

class Session {
  readonly core = createDocumentCore()
  revision: DocumentRevision
  anchor: number
  focus: number

  /** `marked` is source with `|` at the caret or `[`…`]` around a selection. */
  constructor(marked: string, readonly tracked: boolean) {
    const caret = marked.indexOf('|')
    const source = caret >= 0 ? marked.replace('|', '') : marked.replace('[', '').replace(']', '')
    this.revision = this.core.open(source)
    this.anchor = caret >= 0 ? caret : marked.indexOf('[')
    this.focus = caret >= 0 ? caret : marked.indexOf(']') - 1
  }

  input(inputType: string, data: string | null): this {
    const target = this.anchor !== this.focus
      ? { start: Math.min(this.anchor, this.focus), end: Math.max(this.anchor, this.focus) }
      : inputType === 'deleteContentBackward' || inputType === 'deleteContentForward'
        ? neighbor(this.core, this.revision, this.anchor, inputType === 'deleteContentBackward')
        : { start: this.anchor, end: this.anchor }
    const action: DocumentInputAction = { range: target, selection: { ranges: [{ anchor: this.anchor, focus: this.focus }], primary: 0 }, inputType, data, options }
    const plan = this.core.planInput(this.revision, action, { tracked: this.tracked })
    const edits = this.core.inputEdits(this.revision, action, plan, this.tracked)
    expect(edits, 'the input is admitted').toBeDefined()
    const commit = edits!.length === 0 ? null : this.core.apply(this.revision, edits!)
    const result = this.core.reconcileInput(this.revision, plan, commit, action)
    const selection = result.selection
    if (selection === undefined || !('ranges' in selection)) throw new Error('Input has no resulting caret')
    this.revision = commit?.revision ?? this.revision
    this.anchor = selection.ranges[selection.primary]!.anchor
    this.focus = selection.ranges[selection.primary]!.focus
    return this
  }

  backspace(): this { return this.input('deleteContentBackward', null) }
  delete(): this { return this.input('deleteContentForward', null) }
  type(text: string): this { return this.input('insertText', text) }

  /** Source with `|` at a caret, which never falls inside a grapheme. */
  get shown(): string {
    const source = this.revision.source
    expect(pairedSurrogates(source)).toBe(true)
    expect(this.anchor).toBe(this.focus)
    return source.slice(0, this.anchor) + '|' + source.slice(this.anchor)
  }
}

function resolveAll(core: DocumentCore, revision: DocumentRevision, decision: 'accept' | 'reject'): string {
  let current = revision
  while (current.annotations.length > 0) {
    current = core.resolve(current, current.annotations[0]!, decision).revision
  }
  return current.source
}

// `X` is the sample grapheme; the expected source substitutes it the same way.
// When Backspace leaves part of it, `K` is that kept part, `D` the removed code
// point, and the `kept` expectations apply.
type DeletionCase = {
  name: string
  start: string
  act: (s: Session, grapheme: string) => Session
  plain: string
  suggested: string
  kept?: { plain: string, suggested: string }
}
const deletionCases: readonly DeletionCase[] = [
  { name: 'Backspace ends an Addition payload', start: 'a{++bX|++}c', act: (s: Session, _grapheme: string) => s.backspace(), plain: 'a{++b|++}c', suggested: 'a{++b|++}c', kept: { plain: 'a{++bK|++}c', suggested: 'a{++bK|++}c' } },
  { name: 'Delete starts an Addition payload', start: 'a{++|Xb++}c', act: (s: Session, _grapheme: string) => s.delete(), plain: 'a{++|b++}c', suggested: 'a{++|b++}c' },
  { name: 'Backspace empties an Addition', start: 'a{++X|++}c', act: (s: Session, _grapheme: string) => s.backspace(), plain: 'a|c', suggested: 'a|c', kept: { plain: 'a{++K|++}c', suggested: 'a{++K|++}c' } },
  { name: 'Backspace after plain text', start: 'aX|c', act: (s: Session, _grapheme: string) => s.backspace(), plain: 'a|c', suggested: 'a|{--X--}c', kept: { plain: 'aK|c', suggested: 'aK|{--D--}c' } },
  { name: 'Delete before plain text', start: 'a|Xc', act: (s: Session, _grapheme: string) => s.delete(), plain: 'a|c', suggested: 'a{--X--}|c' },
  { name: 'Backspace after an Addition', start: '{++a++}X|c', act: (s: Session, _grapheme: string) => s.backspace(), plain: '{++a++}|c', suggested: '{++a++}|{--X--}c', kept: { plain: '{++a++}K|c', suggested: '{++a++}K|{--D--}c' } },
  { name: 'Backspace over a Deletion', start: 'a{--X|--}c', act: (s: Session, _grapheme: string) => s.backspace(), plain: 'a|c', suggested: 'a{--|X--}c', kept: { plain: 'a{--K|--}c', suggested: 'a{--K|D--}c' } },
  { name: 'Backspace in a commented Highlight', start: 'a{==X|==}{>>n<<}c', act: (s: Session, _grapheme: string) => s.backspace(), plain: 'a|{>>n<<}c', suggested: 'a{==|{--X--}==}{>>n<<}c', kept: { plain: 'a{==K|==}{>>n<<}c', suggested: 'a{==K|{--D--}==}{>>n<<}c' } },
  { name: 'Backspace in a Substitution’s new arm', start: 'a{~~o~>X|~~}c', act: (s: Session, _grapheme: string) => s.backspace(), plain: 'a{~~o~>|~~}c', suggested: 'a|{--o--}c', kept: { plain: 'a{~~o~>K|~~}c', suggested: 'a{~~o~>K|~~}c' } },
  { name: 'typing after the grapheme', start: 'aX|', act: (s: Session, _grapheme: string) => s.type('Z'), plain: 'aXZ|', suggested: 'aX{++Z|++}' },
  { name: 'typing the grapheme in an Addition', start: 'a{++X|++}c', act: (s: Session, grapheme: string) => s.type(grapheme), plain: 'a{++XX|++}c', suggested: 'a{++XX|++}c' },
  { name: 'typing the grapheme into plain text', start: 'a|c', act: (s: Session, grapheme: string) => s.type(grapheme), plain: 'aX|c', suggested: 'a{++X|++}c' }
]

describe('graphemes inside and beside annotations', () => {
  for (const [label, grapheme, kept] of samples) {
    describe(label, () => {
      const spell = (template: string) => template.replaceAll('X', grapheme).replaceAll('K', kept).replaceAll('D', grapheme.slice(kept.length))
      it.each(deletionCases.flatMap(testCase => [false, true].map(tracked => ({ ...testCase, tracked }))))('$name (tracked: $tracked)', ({ start, act, plain, suggested, kept: partial, tracked }) => {
        const session = new Session(spell(start), tracked)
        act(session, grapheme)
        const expected = kept !== '' && partial !== undefined ? partial : { plain, suggested }
        expect(session.shown).toBe(spell(tracked ? expected.suggested : expected.plain))
      })
    })
  }

  it('deletes one RTL letter at a time without reordering the stored source', () => {
    for (const word of ['שלום', 'سلام']) {
      const last = word.at(-1)!
      const first = word[0]!
      expect(new Session(`a{++${word}|++}c`, false).backspace().shown).toBe(`a{++${word.slice(0, -1)}|++}c`)
      expect(new Session(`a${word}|c`, true).backspace().shown).toBe(`a${word.slice(0, -1)}|{--${last}--}c`)
      expect(new Session(`a|${word}c`, true).delete().shown).toBe(`a{--${first}--}|${word.slice(1)}c`)
      expect(new Session(`a{--${word}|--}c`, true).backspace().shown).toBe(`a{--${word.slice(0, -1)}|${last}--}c`)
    }
  })

  it('tracks deletion of a selection that spans graphemes and an annotation', () => {
    const session = new Session('[👩\u200D👩\u200D👧{++🇯🇵++}e\u0301]!', true).input('deleteContentBackward', null)
    expect(session.revision.source).toBe('{--👩\u200D👩\u200D👧--}{--e\u0301--}!')
    const decided = (decision: 'accept' | 'reject') => {
      const core = createDocumentCore()
      return resolveAll(core, core.open(session.revision.source), decision)
    }
    expect(decided('reject')).toBe('👩\u200D👩\u200D👧e\u0301!')
    expect(decided('accept')).toBe('!')
  })
})

describe('Markup coordinates over astral and combining text', () => {
  it('maps every code-point boundary of visible arms back to itself', () => {
    const core = createDocumentCore()
    const source = 'a{++👩\u200D👩\u200D👧++}{--🇯🇵--}{~~e\u0301~>𝒳~~}{==שלום==}{>>😀<<}z'
    const revision = core.open(source)
    const markup = core.project(revision, 'markup')
    for (const event of markup.events) {
      if (event.kind !== 'text') continue
      expect(pairedSurrogates(event.text)).toBe(true)
      expect(source.slice(event.sourceRange.start, event.sourceRange.end)).toBe(event.text)
    }
    const { coordinates } = markup.syntax
    for (const annotation of revision.annotations) {
      for (const arm of annotation.arms) {
        if (arm.name === 'comment') continue
        for (let offset = arm.range.start; offset <= arm.range.end; offset += 1) {
          if (offset < arm.range.end && pairedSurrogates(source.slice(arm.range.start, offset)) === false) continue
          const affinity = offset === arm.range.end ? 'previous' : 'next'
          expect(coordinates.toSource(coordinates.toProjected(offset, affinity), affinity)).toBe(offset)
        }
      }
    }
  })
})

describe('authoring Review forms over Unicode selections', () => {
  const cases = [
    { form: 'highlight' as const, selected: '👩\u200D👩\u200D👧', text: '', expected: 'a{==👩\u200D👩\u200D👧==}c' },
    { form: 'comment' as const, selected: 'שלום', text: 'הערה 😀', expected: 'a{==שלום==}{>>הערה 😀<<}c' },
    { form: 'substitution' as const, selected: 'e\u0301', text: '🇯🇵', expected: 'a{~~e\u0301~>🇯🇵~~}c' },
    { form: 'addition' as const, selected: 'سلام', text: '', expected: 'a{++سلام++}c' },
    { form: 'highlight' as const, selected: '\u1100\u1161\u11A8𝒳', text: '', expected: 'a{==\u1100\u1161\u11A8𝒳==}c' }
  ]

  it.each(cases)('$form over $selected', ({ form, selected, text, expected }) => {
    const core = createDocumentCore()
    const revision = core.open(`a${selected}c`)
    const planned = core.planAuthor(revision, { form, range: { start: 1, end: 1 + selected.length }, text })
    if (planned === undefined) throw new Error('Missing author operation')
    const result = core.apply(revision, [planned.edit]).revision
    expect(result.source).toBe(expected)
    const annotation = result.annotations[0]!
    const selectedArm = annotation.arms.find(arm => arm.name === (form === 'substitution' ? 'new' : 'content'))!
    expect(result.source.slice(planned.selection.start, planned.selection.end)).toBe(result.source.slice(selectedArm.range.start, selectedArm.range.end))
  })

  it('edits a Comment payload to emoji and RTL text without escaping it', () => {
    const core = createDocumentCore()
    const revision = core.open('a{==b==}{>>old<<}c')
    const comment = revision.annotations.find(annotation => annotation.kind === 'comment')!
    const planned = core.planCommentEdit(revision, { range: comment.range, text: '👩\u200D👩\u200D👧 שלום 🇯🇵' })
    if (planned === undefined) throw new Error('Missing comment edit')
    expect(planned.escaped).toBe(false)
    const result = core.apply(revision, [planned.edit]).revision
    expect(result.source).toBe('a{==b==}{>>👩\u200D👩\u200D👧 שלום 🇯🇵<<}c')
    expect(core.projectComment(result, result.annotations.find(annotation => annotation.kind === 'comment')!).markdown).toBe('👩\u200D👩\u200D👧 שלום 🇯🇵')
  })
})

describe('resolving annotations with Unicode payloads', () => {
  const source = 'a{++👩\u200D👩\u200D👧++}b{--🇯🇵--}c{~~e\u0301~>\u1100\u1161\u11A8~~}d{==𝒳==}{>>😀<<}e{>>שלום<<}f'
  const kinds: readonly CriticMarkupAnnotation['kind'][] = ['addition', 'deletion', 'substitution', 'highlight', 'comment']

  it.each([
    ['accept', 'a👩\u200D👩\u200D👧bc\u1100\u1161\u11A8d𝒳ef'],
    ['reject', 'abe\u0301🇯🇵c'.replace('e\u0301🇯🇵c', '🇯🇵ce\u0301') + 'd𝒳ef']
  ] as const)('%s all keeps each grapheme whole', (decision, expected) => {
    const core = createDocumentCore()
    expect(resolveAll(core, core.open(source), decision)).toBe(expected)
  })

  it.each(kinds)('accepts and rejects one %s at a time', (kind) => {
    for (const decision of ['accept', 'reject'] as const) {
      const core = createDocumentCore()
      const revision = core.open(source)
      const annotation = revision.annotations.find(candidate => candidate.kind === kind)!
      const result = core.resolve(revision, annotation, decision).revision.source
      expect(pairedSurrogates(result)).toBe(true)
      const kept = kind === 'addition'
        ? (decision === 'accept' ? '👩\u200D👩\u200D👧' : '')
        : kind === 'deletion'
          ? (decision === 'accept' ? '' : '🇯🇵')
          : kind === 'substitution'
            ? (decision === 'accept' ? '\u1100\u1161\u11A8' : 'e\u0301')
            : kind === 'highlight'
              ? '𝒳'
              : ''
      expect(result).toBe(source.slice(0, annotation.range.start) + kept + source.slice(annotation.range.end))
    }
  })
})

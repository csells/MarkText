import { describe, expect, it } from 'vitest'
import { createDocumentCore, type CriticMarkupAnnotation, type DocumentCore, type DocumentInputAction, type DocumentRevision, type SourceRange } from '../src/index.js'

// Owner decision (27 Sep): with Track Changes on, editing
// over existing suggestions follows Google Docs, observed hands-on. Each case
// runs the production input path (planInput, inputEdits, apply,
// reconcileInput) with the caret and target range the editing view sends,
// and checks the source, the resulting caret, and that Accept All gives the
// untracked result while Reject All gives the Original.

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }

function resolveAll(source: string, decision: 'accept' | 'reject'): string {
  const core = createDocumentCore()
  let revision = core.open(source)
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

/** The visible character beside a caret, as the editing view targets Backspace and Delete. */
function neighbor(core: DocumentCore, revision: DocumentRevision, caret: number, backward: boolean): SourceRange {
  const { coordinates } = core.project(revision, 'markup').syntax
  const projected = coordinates.toProjected(caret, backward ? 'previous' : 'next')
  const origin = coordinates.originAt(backward ? projected - 1 : projected)
  if (origin.kind !== 'source') throw new Error('No visible character beside the caret')
  return { start: origin.sourceOffset, end: origin.sourceOffset + 1 }
}

class Session {
  readonly core = createDocumentCore()
  revision: DocumentRevision
  anchor: number
  focus: number

  constructor(source: string, caret: number, focus = caret) {
    this.revision = this.core.open(source)
    this.anchor = caret
    this.focus = focus
  }

  input(inputType: string, data: string | null, range?: SourceRange): this {
    const target = range ?? (this.anchor !== this.focus
      ? { start: Math.min(this.anchor, this.focus), end: Math.max(this.anchor, this.focus) }
      : inputType === 'deleteContentBackward' || inputType === 'deleteContentForward'
        ? neighbor(this.core, this.revision, this.anchor, inputType === 'deleteContentBackward')
        : { start: this.anchor, end: this.anchor })
    const action: DocumentInputAction = { range: target, selection: { ranges: [{ anchor: this.anchor, focus: this.focus }], primary: 0 }, inputType, data, options }
    const plan = this.core.planInput(this.revision, action, { tracked: true })
    const edits = this.core.inputEdits(this.revision, action, plan, true)
    expect(edits, 'a tracked edit is never refused').toBeDefined()
    const commit = edits!.length === 0 ? null : this.core.apply(this.revision, edits!)
    const result = this.core.reconcileInput(this.revision, plan, commit, action)
    const selection = result.selection
    if (selection === undefined || !('ranges' in selection)) throw new Error('Tracked input has no resulting caret')
    this.revision = commit?.revision ?? this.revision
    this.anchor = selection.ranges[selection.primary]!.anchor
    this.focus = selection.ranges[selection.primary]!.focus
    return this
  }

  backspace(): this { return this.input('deleteContentBackward', null) }
  delete(): this { return this.input('deleteContentForward', null) }
  type(text: string): this { return this.input('insertText', text) }

  /** Source with `|` at the caret. */
  get shown(): string {
    const source = this.revision.source
    return this.anchor === this.focus ? source.slice(0, this.anchor) + '|' + source.slice(this.anchor) : source
  }
}

describe('Backspace and Delete over text', () => {
  it('strikes the previous character and keeps the caret before it; repeated Backspace extends the deletion', () => {
    const session = new Session('hello world\n', 5)
    expect(session.backspace().shown).toBe('hell|{--o--} world\n')
    expect(session.backspace().shown).toBe('hel|{--lo--} world\n')
    expect(session.backspace().shown).toBe('he|{--llo--} world\n')
    expect(resolveAll(session.revision.source, 'accept')).toBe('he world\n')
    expect(resolveAll(session.revision.source, 'reject')).toBe('hello world\n')
  })

  it('strikes the next character and moves after it; repeated Delete extends the deletion', () => {
    const session = new Session('hello world\n', 0)
    expect(session.delete().shown).toBe('{--h--}|ello world\n')
    expect(session.delete().shown).toBe('{--he--}|llo world\n')
    expect(session.delete().shown).toBe('{--hel--}|lo world\n')
    expect(resolveAll(session.revision.source, 'accept')).toBe('lo world\n')
  })

  it('extends a deletion across a line of repeated keys in either direction', () => {
    const session = new Session('ab{--cd--}ef\n', 10)
    expect(session.delete().shown).toBe('ab{--cde--}|f\n')
    const back = new Session('ab{--cd--}ef\n', 2)
    expect(back.backspace().shown).toBe('a|{--bcd--}ef\n')
  })
})

describe('Backspace and Delete over deleted text', () => {
  it('moves the caret left over one struck character per Backspace, changing nothing', () => {
    const session = new Session('the {--slow --}fox\n', 11)
    expect(session.backspace().shown).toBe('the {--slo|w --}fox\n')
    expect(session.backspace().shown).toBe('the {--sl|ow --}fox\n')
    session.backspace().backspace()
    expect(session.shown).toBe('the {--|slow --}fox\n')
    // Past the deletion, Backspace strikes again and extends it.
    expect(session.backspace().shown).toBe('the|{-- slow --}fox\n')
  })

  it('moves the caret right over one struck character per Delete, changing nothing', () => {
    const session = new Session('the {--slow --}fox\n', 7)
    expect(session.delete().shown).toBe('the {--s|low --}fox\n')
    session.delete().delete().delete().delete()
    expect(session.shown).toBe('the {--slow |--}fox\n')
    expect(session.delete().shown).toBe('the {--slow f--}|ox\n')
  })

  it('treats a Substitution\'s old text as deleted text', () => {
    const session = new Session('the {~~slow~>fast~~} fox\n', 11)
    expect(session.backspace().shown).toBe('the {~~slo|w~>fast~~} fox\n')
    expect(session.revision.source).toBe('the {~~slow~>fast~~} fox\n')
    const forward = new Session('the {~~slow~>fast~~} fox\n', 7)
    expect(forward.delete().shown).toBe('the {~~s|low~>fast~~} fox\n')
  })

  it('never faults: a second Backspace after a strike extends the deletion (the 27 Sep repro)', () => {
    const session = new Session('hello world\n', 5)
    session.backspace()
    // The caret is before the struck character, so the view targets 'l'.
    expect(session.backspace().revision.source).toBe('hel{--lo--} world\n')
  })
})

describe('typing beside and inside deleted text', () => {
  it('typing immediately before a deletion merges into one Substitution', () => {
    const session = new Session('hello world\n', 5)
    session.backspace().backspace().backspace()
    expect(session.type('Z').shown).toBe('he{~~llo~>Z|~~} world\n')
    expect(session.type('Y').shown).toBe('he{~~llo~>ZY|~~} world\n')
    // Backspace over one's own text removes it outright.
    expect(session.backspace().shown).toBe('he{~~llo~>Z|~~} world\n')
    expect(session.backspace().shown).toBe('he|{--llo--} world\n')
    expect(resolveAll(session.revision.source, 'reject')).toBe('hello world\n')
  })

  it('typing inside a deletion splits it at the caret', () => {
    const session = new Session('the {--slow --}fox\n', 9)
    expect(session.type('X').shown).toBe('the {--sl--}{++X|++}{--ow --}fox\n')
  })

  it('typing after a deletion stays a separate Addition', () => {
    const session = new Session('the {--slow --}fox\n', 15)
    expect(session.type('X').shown).toBe('the {--slow --}{++X|++}fox\n')
  })

  it('typing at an old arm\'s edges types into the proposed text', () => {
    expect(new Session('the {~~slow~>fast~~} fox\n', 11).type('X').shown).toBe('the {~~slow~>X|fast~~} fox\n')
    expect(new Session('the {~~slow~>fast~~} fox\n', 7).type('X').shown).toBe('the {~~slow~>X|fast~~} fox\n')
  })

  it('Backspace and Delete over one\'s own proposed text remove it outright', () => {
    const session = new Session('a {++xy++} b\n', 7)
    expect(session.backspace().shown).toBe('a {++x|++} b\n')
    expect(session.backspace().shown).toBe('a | b\n')
  })
})

describe('selections containing deleted text', () => {
  it('replacing a selection that contains a deletion is one replacement that keeps the deletion', () => {
    const session = new Session('ab {--cd--} ef\n', 1, 13)
    expect(session.type('X').shown).toBe('a{~~b {--cd--} e~>X|~~}f\n')
    expect(resolveAll(session.revision.source, 'accept')).toBe('aXf\n')
    expect(resolveAll(session.revision.source, 'reject')).toBe('ab cd ef\n')
  })

  it('replacing from inside deleted text proposes the text for the rest of the selection', () => {
    const session = new Session('the {--slow --}fox\n', 9, 17)
    expect(session.type('X').shown).toBe('the {--slow --}{~~fo~>X~~}|x\n')
    expect(resolveAll(session.revision.source, 'accept')).toBe('the Xx\n')
  })

  it('typing over deleted text only types at the selection\'s start', () => {
    expect(new Session('the {--slow --}fox\n', 8, 10).type('X').shown).toBe('the {--s--}{++X|++}{--low --}fox\n')
  })

  it('deleting a selection of deleted text changes nothing', () => {
    const session = new Session('the {--slow --}fox\n', 8, 10)
    session.backspace()
    expect(session.revision.source).toBe('the {--slow --}fox\n')
    expect([session.anchor, session.focus]).toEqual([8, 10])
  })

  it('deleting across deleted text strikes only the rest and removes one\'s own text', () => {
    const session = new Session('a {++xy++}cd\n', 6, 11)
    session.backspace()
    expect(session.revision.source).toBe('a {++x++}{--c--}d\n')
    const across = new Session('ab{--cd--}ef\n', 1, 11)
    across.backspace()
    expect(across.revision.source).toBe('a{--b--}{--cd--}{--e--}f\n')
    expect(resolveAll(across.revision.source, 'accept')).toBe('af\n')
    expect(resolveAll(across.revision.source, 'reject')).toBe('abcdef\n')
  })
})

describe('formatting and clipboard over deleted text', () => {
  const format = (source: string, anchor: number, focus: number, kind: 'strong' | 'em') => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const plan = core.planFormat(revision, { format: kind, selection: { ranges: [{ anchor, focus }], primary: 0 }, tracked: true })
    return core.apply(revision, plan.edits).revision.source
  }
  const clipboard = (source: string, anchor: number, focus: number, markdown?: string) => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const selection = { ranges: [{ anchor, focus }], primary: 0 }
    const plan = core.planClipboard(revision, markdown === undefined ? { kind: 'cut', selection, tracked: true } : { kind: 'paste', markdown, selection, tracked: true })
    return core.apply(revision, plan.edits).revision.source
  }

  it('bold over deleted text is a no-op there and formats the rest', () => {
    expect(format('the {--slow --}fox\n', 8, 10, 'strong')).toBe('the {--slow --}fox\n')
    expect(format('the {--slow --}fox\n', 9, 17, 'strong')).toBe('the {--slow --}{~~fo~>**fo**~~}x\n')
    expect(format('the {~~slow~>fast~~} fox\n', 4, 20, 'strong')).toBe('the {~~slow~>**fast**~~} fox\n')
  })

  it('paste over deleted text behaves like typing', () => {
    expect(clipboard('the {--slow --}fox\n', 4, 4, 'word')).toBe('the {~~slow ~>word~~}fox\n')
    expect(clipboard('the {--slow --}fox\n', 9, 17, 'word')).toBe('the {--slow --}{~~fo~>word~~}x\n')
    expect(clipboard('the {~~slow~>fast~~} fox\n', 11, 11, 'word')).toBe('the {~~slow~>wordfast~~} fox\n')
  })

  it('cutting deleted text leaves it deleted and strikes the rest', () => {
    expect(clipboard('the {--slow --}fox\n', 8, 10)).toBe('the {--slow --}fox\n')
    expect(clipboard('the {--slow --}fox\n', 9, 17)).toBe('the {--slow --}{--fo--}x\n')
  })
})

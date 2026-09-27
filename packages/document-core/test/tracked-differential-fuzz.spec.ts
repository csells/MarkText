import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentInputAction, type DocumentRevision, type MarkdownAstNode, type SourceRange } from '../src/index.js'

// Owner rule: with Track Changes on, every edit available untracked is
// available tracked, and it follows Google Docs over existing suggestions.
// This differential fuzz drives the production input path with carets and
// selections a reader can place. The oracle is the same action made
// untracked on the Accepted document, at the same visible places: accepting
// the tracked result must give that document, and the Original view must not
// change. Deleted text is not in the Accepted document, so an edit over it
// changes only the rest, and deleting deleted text again is a no-op.

const plainOptions = { autoPairBracket: false, autoPairQuote: false, autoPairMarkdownSyntax: false }
const pairingOptions = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
const characters = ['x', 'Y', ' ', 'zz', '*', '(', '_']

const corpus: Readonly<Record<string, string>> = {
  plain: 'alpha beta gamma\n\ndelta epsilon\n',
  addition: 'the {++quick ++}fox jumps\n',
  deletion: 'the {--slow --}fox jumps\n',
  substitution: 'the {~~slow~>fast~~} fox\n',
  adjacent: 'a {--bc--}{++de++} f {~~gh~>ij~~}{--kl--} m\n',
  comment: 'the fox{>>note<<} ran {==far==}{>>why<<} away\n',
  heading: '# Title {--old--}\n\nbody {++new++} text\n',
  list: '- {++one++}\n- t{--w--}o\n- three\n'
}

const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

/** Projected ranges of the editable inline blocks: markers and fences are not text a reader types into. */
function textBlocks(core: DocumentCore, revision: DocumentRevision): SourceRange[] {
  const blocks: SourceRange[] = []
  const visit = (node: MarkdownAstNode): void => {
    if (node.kind === 'paragraph' || node.kind === 'heading') blocks.push(node.range)
    else for (const child of node.children) visit(child)
  }
  visit(core.project(revision, 'markup').syntax.ast.root)
  return blocks
}

/** The source range of the visible character beside a caret, as the editing view deletes it. */
function neighbor(core: DocumentCore, revision: DocumentRevision, caret: number, backward: boolean): SourceRange | undefined {
  const { coordinates } = core.project(revision, 'markup').syntax
  const projected = coordinates.toProjected(caret, backward ? 'previous' : 'next')
  const at = backward ? projected - 1 : projected
  if (!textBlocks(core, revision).some(block => block.start <= at && at < block.end)) return undefined
  const origin = coordinates.originAt(at)
  if (origin.kind !== 'source' || /[\r\n]/u.test(core.sourceSlice(revision, { start: origin.sourceOffset, end: origin.sourceOffset + 1 }))) return undefined
  return { start: origin.sourceOffset, end: origin.sourceOffset + 1 }
}

/** A source position a reader can place the caret at: any position in a text block, at either affinity. */
function visiblePosition(core: DocumentCore, revision: DocumentRevision, random: () => number): number {
  const { coordinates } = core.project(revision, 'markup').syntax
  const blocks = textBlocks(core, revision)
  const block = blocks[Math.floor(random() * blocks.length)]!
  return coordinates.toSource(block.start + Math.floor(random() * (block.end - block.start + 1)), random() < 0.5 ? 'previous' : 'next')
}

type Operation = { kind: 'type', text: string } | { kind: 'backspace' } | { kind: 'delete' } | { kind: 'replace', text: string }

describe('tracked edits match untracked editing of the visible text', () => {
  it.each(Object.entries(corpus))('%s', { timeout: 60_000 }, (_name, source) => {
    const random = lcg(source.length * 7919 + Number(process.env.TRACKED_FUZZ_SEED ?? 0))
    for (let run = 0; run < Number(process.env.TRACKED_FUZZ_RUNS ?? 12); run += 1) {
      const core = createDocumentCore()
      let revision = core.open(source)
      let caret = visiblePosition(core, revision, random)
      const options = run % 2 === 0 ? plainOptions : pairingOptions
      for (let step = 0; step < 14; step += 1) {
        const roll = random()
        const operation: Operation = roll < 0.3
          ? { kind: 'backspace' }
          : roll < 0.5
            ? { kind: 'delete' }
            : roll < 0.8
              ? { kind: 'type', text: characters[Math.floor(random() * characters.length)]! }
              : { kind: 'replace', text: random() < 0.5 ? '' : 'Q' }
        let anchor = caret
        let focus = caret
        let range: SourceRange | undefined
        if (operation.kind === 'replace') {
          const other = visiblePosition(core, revision, random)
          anchor = Math.min(caret, other)
          focus = Math.max(caret, other)
          if (anchor === focus) continue
          range = { start: anchor, end: focus }
        } else if (operation.kind === 'type') {
          range = { start: caret, end: caret }
        } else {
          range = neighbor(core, revision, caret, operation.kind === 'backspace')
        }
        if (range === undefined) continue
        const inputType = operation.kind === 'backspace'
          ? 'deleteContentBackward'
          : operation.kind === 'delete'
            ? 'deleteContentForward'
            : operation.kind === 'replace' && operation.text === '' ? 'deleteContentBackward' : 'insertText'
        const text = operation.kind === 'type' || operation.kind === 'replace' ? operation.text : ''
        const action: DocumentInputAction & { range: SourceRange } = { range, selection: { ranges: [{ anchor, focus }], primary: 0 }, inputType, data: text === '' ? null : text, options }
        const label = `${JSON.stringify(revision.source)} ${inputType} ${JSON.stringify(text)} at ${anchor}-${focus} range ${range.start}-${range.end}`
        if (core.project(revision, 'revised').markdown !== accepted(revision.source)) break
        // A selection crossing a block boundary is structural; its tracked
        // spelling is covered by the structural suites.
        if (/[\r\n]/u.test(core.sourceSlice(revision, range))) continue

        const plan = core.planInput(revision, action, { tracked: true })
        const edits = core.inputEdits(revision, action, plan, true)
        // Known gap (plan 0012 G34): a selection that splits a comment or a
        // highlight held in a suggestion's arm can still be refused; the
        // session then leaves the document and caret unchanged.
        if (edits === undefined && selectsIntoReviewNote(revision, range)) break
        expect(edits, `refused: ${label}`).toBeDefined()
        const commit = edits!.length === 0 ? null : core.apply(revision, edits!)
        const next = commit?.revision ?? revision
        let result: ReturnType<DocumentCore['reconcileInput']>
        try {
          result = core.reconcileInput(revision, plan, commit, action)
        } catch (error) {
          throw new Error(`reconcile threw: ${label} ${JSON.stringify(edits)} ${(error as Error).message}`)
        }
        expect(result.selection, `no caret: ${label}`).toBeDefined()

        expect(core.project(next, 'original').markdown, `Original changed: ${label}`).toBe(core.project(revision, 'original').markdown)
        // Where the edit touches no suggestion, the untracked result is the
        // same action untracked in the same document. Over suggestions it is
        // the action on the Accepted document at the same visible places;
        // Markdown pairing reads the raw characters beside the caret, deleted
        // text included, so that comparison runs without pairing.
        const touching = touchesSuggestion(revision, range)
        const expected = !touching
          ? accepted(untrackedInPlace(revision.source, action))
          : options === plainOptions ? untrackedOnAccepted(core, revision, action) : undefined
        if (expected !== undefined) expect(accepted(next.source), `Accept differs from untracked editing: ${label}`).toBe(expected)

        revision = next
        const selected = result.selection!
        if (!('ranges' in selected)) break
        caret = selected.ranges[selected.primary]!.focus
      }
    }
  })
})

/** Accept All: every top-level annotation resolves in one transaction. */
function accepted(source: string): string {
  const core = createDocumentCore()
  let revision = core.open(source)
  while (revision.annotations.length > 0) {
    const current = revision
    revision = core.apply(current, current.annotations.map(annotation => {
      const kept = annotation.arms.find(arm => arm.name === (annotation.kind === 'substitution' ? 'new' : annotation.kind === 'deletion' || annotation.kind === 'comment' ? '' : 'content'))
      return { ...annotation.range, insert: kept === undefined ? '' : current.source.slice(kept.range.start, kept.range.end) }
    })).revision
  }
  return revision.source
}

/** Whether an edit's range meets a suggestion other than at its outer edges. */
function touchesSuggestion(revision: DocumentRevision, range: SourceRange): boolean {
  const pending = [...revision.annotations]
  while (pending.length > 0) {
    const annotation = pending.pop()!
    if (range.start === range.end
      ? annotation.range.start < range.start && range.start < annotation.range.end
      : annotation.range.start < range.end && range.start < annotation.range.end) return true
    for (const arm of annotation.arms) pending.push(...arm.annotations)
  }
  return false
}

/** Whether a selection meets a comment or highlight inside another suggestion. */
function selectsIntoReviewNote(revision: DocumentRevision, range: SourceRange): boolean {
  if (range.start === range.end) return false
  const visit = (annotations: DocumentRevision['annotations'], nested: boolean): boolean => annotations.some(annotation =>
    nested && (annotation.kind === 'comment' || annotation.kind === 'highlight') &&
      annotation.range.start < range.end && range.start < annotation.range.end ||
    annotation.arms.some(arm => visit(arm.annotations, true)))
  return visit(revision.annotations, false)
}

/** The same action, untracked, in the same document. */
function untrackedInPlace(source: string, action: DocumentInputAction): string {
  const core = createDocumentCore()
  const opened = core.open(source)
  const plan = core.planInput(opened, action, { tracked: false })
  const edits = core.inputEdits(opened, action, plan, false)
  if (edits === undefined) throw new Error('The untracked action is refused')
  return core.apply(opened, edits).revision.source
}

/** The same action, untracked, on the Accepted document at the same visible places. */
function untrackedOnAccepted(core: DocumentCore, revision: DocumentRevision, action: DocumentInputAction & { range: SourceRange }): string {
  const source = accepted(revision.source)
  const revised = core.project(revision, 'revised')
  if (revised.markdown !== source) throw new Error(`Revised view is not the Accepted source: ${JSON.stringify(revision.source)}`)
  const { coordinates } = revised
  const map = (position: number, affinity: 'previous' | 'next') => coordinates.toProjected(position, affinity)
  if (!('ranges' in action.selection) || 'kind' in action) throw new Error('Fuzz actions are text input')
  const caret = action.selection.ranges[0]!
  const collapsed = caret.anchor === caret.focus
  const anchor = map(caret.anchor, collapsed ? 'next' : 'next')
  const focus = collapsed ? anchor : map(caret.focus, 'previous')
  const range = { start: map(action.range.start, 'next'), end: Math.max(map(action.range.start, 'next'), map(action.range.end, 'previous')) }
  if (action.data === null && range.start === range.end) return source
  const untracked = createDocumentCore()
  const opened = untracked.open(source)
  const moved = { ...action, range, selection: { ranges: [{ anchor: Math.min(anchor, focus), focus: Math.max(anchor, focus) }], primary: 0 } }
  const plan = untracked.planInput(opened, moved, { tracked: false })
  const edits = untracked.inputEdits(opened, moved, plan, false)
  if (edits === undefined) throw new Error('The untracked action is refused')
  return untracked.apply(opened, edits).revision.source
}

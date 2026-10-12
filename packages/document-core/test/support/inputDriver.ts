import type { DocumentCore, DocumentInputAction, DocumentRevision } from '../../src/index.js'

/** Seeded generator in [0, 1): seeds name the cases, so their sequence must never change. */
export const lcg = (seed: number) => (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

/** One paragraph holding every kind of suggestion. */
export const denseSuggestionParagraph = 'Review {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.'

/** A revision reached by a regional edit, so it holds no document parse. */
export function regionalRevision(core: DocumentCore, source: string, at = 1): DocumentRevision {
  return core.apply(core.open(source), [{ start: at, end: at, insert: 'q' }], { projections: ['markup'] }).revision
}

export const autoPairOptions = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

export type Key = 'insertText' | 'insertParagraph' | 'insertLineBreak' | 'deleteContentBackward' | 'deleteContentForward'

/** The browser input for one key at a collapsed caret; typing writes `x`. */
export const keyInputAction = (caret: number, inputType: Key): DocumentInputAction => ({
  range: inputType === 'deleteContentBackward'
    ? { start: Math.max(0, caret - 1), end: caret }
    : inputType === 'deleteContentForward' ? { start: caret, end: caret + 1 } : { start: caret, end: caret },
  selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
  inputType,
  data: inputType === 'insertText' ? 'x' : null,
  options: autoPairOptions
}) as DocumentInputAction

export type Outcome = Readonly<{ plan?: unknown, edits?: unknown, selection?: unknown, source?: string, diagnostics?: unknown, error?: string }>

/** Plans, applies and reconciles one key, reading a refusal or a throw as its outcome. */
export function press(
  core: DocumentCore,
  revision: DocumentRevision,
  caret: number,
  key: Key,
  tracked: boolean,
  { diagnostics = false }: Readonly<{ diagnostics?: boolean }> = {}
): Outcome {
  try {
    const input = keyInputAction(caret, key)
    const plan = core.planInput(revision, input, { tracked })
    const edits = core.inputEdits(revision, input, plan, tracked)
    if (edits === undefined) return { plan }
    const commit = core.apply(revision, edits, { projections: ['markup'] })
    const result = core.reconcileInput(revision, plan, commit, input)
    return {
      plan,
      edits,
      selection: result.selection,
      source: commit.revision.source,
      ...(diagnostics ? { diagnostics: commit.revision.diagnostics } : {})
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

import type { CriticMarkupAnnotation, DocumentCore, DocumentCommit, DocumentRevision, DocumentSourceEdit } from './documentCore.js'
import { createMarkupCompoundSourceEdits } from './markupEditing.js'
import { markupReplacementRange } from './markupEditOwnership.js'
import { nativeCriticSpelling } from './trackedAuthoring.js'
import { positionAfter } from './sourcePosition.js'

function ordinaryCompilationMatches(
  core: DocumentCore, previous: DocumentRevision, inputs: readonly DocumentSourceEdit[],
  applied: readonly DocumentSourceEdit[], commitRevision: DocumentRevision, scope: 'visible' | 'structure'
): boolean {
  // Reuse the ordinary compiler's source ownership rules. Its validation uses
  // the already committed product only for exactly the same compiled operation;
  // this proof neither reparses source nor publishes a second revision.
  const mismatch = Symbol('different compilation')
  let planned: readonly DocumentSourceEdit[] | undefined
  try {
    planned = createMarkupCompoundSourceEdits(core, previous, inputs, candidate => {
      if (candidate.length !== applied.length || !candidate.every((edit, index) => {
        const actual = applied[index]
        return actual !== undefined && actual.start === edit.start && actual.end === edit.end && actual.insert === edit.insert
      })) throw mismatch
      return commitRevision
    }, false, scope)
  } catch (error) {
    if (error !== mismatch) throw error
    return false
  }
  if (planned === undefined || planned.length !== applied.length || !planned.every((edit, index) => {
    const actual = applied[index]
    return actual !== undefined && actual.start === edit.start && actual.end === edit.end && actual.insert === edit.insert
  })) return false
  return true
}

/** Map an ordinary compilation using its exact source intervals and spelling. */
function ordinaryReconciliation(
  core: DocumentCore, previous: DocumentRevision, input: DocumentSourceEdit,
  applied: readonly DocumentSourceEdit[], commitRevision: DocumentRevision, scope: 'visible' | 'structure'
): readonly DocumentSourceEdit[] | undefined {
  if (!ordinaryCompilationMatches(core, previous, [input], applied, commitRevision, scope)) return undefined
  const spelling = nativeCriticSpelling(input.insert)
  const payload = applied.filter(edit => edit.insert.length > 0)
  if (input.insert.length > 0 && (payload.length !== 1 ||
    (payload[0]?.insert !== input.insert && payload[0]?.insert !== spelling.text))) return undefined
  if (input.insert.length === 0 && payload.length > 0) return undefined
  const result: DocumentSourceEdit[] = []
  const shift = input.insert.length - (input.end - input.start)
  let retained = ''
  let cursor = input.start
  for (const edit of applied) {
    if (edit.start < input.start) result.push({ start: edit.start, end: Math.min(edit.end, input.start), insert: '' })
    if (edit.end > input.end) result.push({ start: Math.max(edit.start, input.end) + shift, end: edit.end + shift, insert: '' })
    const gapEnd = Math.min(edit.start, input.end)
    if (cursor < gapEnd) retained += core.sourceSlice(previous, { start: cursor, end: gapEnd })
    cursor = Math.max(cursor, edit.end)
  }
  if (cursor < input.end) retained += core.sourceSlice(previous, { start: cursor, end: input.end })
  if (retained.length > 0) result.push({ start: input.start + input.insert.length, end: input.start + input.insert.length, insert: retained })
  if (payload[0]?.insert !== input.insert) {
    for (const offset of spelling.escapes) result.push({ start: input.start + offset, end: input.start + offset, insert: '\\' })
  }
  return Object.freeze(result.sort((left, right) => left.start - right.start || left.end - right.end).map(edit => Object.freeze(edit)))
}

/** Relate sparse deletions by retained source intervals, including hidden syntax. */
export function sparseDeletionReconciliation(
  core: DocumentCore, previous: DocumentRevision, inputs: readonly DocumentSourceEdit[], commit: DocumentCommit
): readonly DocumentSourceEdit[] | undefined {
  const applied = commit.change.appliedEdits
  if (inputs.length === 0 || inputs.some(edit => edit.insert.length > 0) || applied.some(edit => edit.insert.length > 0)) return undefined
  if (!ordinaryCompilationMatches(core, previous, inputs, applied, commit.revision, 'visible')) return undefined
  const boundaries = [...new Set([0, previous.sourceLength, ...[...inputs, ...applied].flatMap(edit => [edit.start, edit.end])])]
    .sort((left, right) => left - right)
  const result: DocumentSourceEdit[] = []
  let offset = 0
  let inputIndex = 0
  let appliedIndex = 0
  for (const [index, start] of boundaries.entries()) {
    const end = boundaries[index + 1]
    if (end === undefined) break
    while ((inputs[inputIndex]?.end ?? Infinity) <= start) inputIndex += 1
    while ((applied[appliedIndex]?.end ?? Infinity) <= start) appliedIndex += 1
    const input = inputs[inputIndex]
    const actual = applied[appliedIndex]
    const removedByInput = input !== undefined && input.start <= start && input.end >= end
    const removedByCompiler = actual !== undefined && actual.start <= start && actual.end >= end
    if (removedByInput !== removedByCompiler) {
      const edit = {
        start: offset,
        end: removedByInput ? offset : offset + end - start,
        insert: removedByInput ? core.sourceSlice(previous, { start, end }) : ''
      }
      const last = result.at(-1)
      if (last !== undefined && last.end === edit.start) {
        result[result.length - 1] = { start: last.start, end: edit.end, insert: last.insert + edit.insert }
      } else result.push(edit)
    }
    if (!removedByInput) offset += end - start
  }
  return Object.freeze(result.map(edit => Object.freeze(edit)))
}

/**
 * Relate the operation's exact replacement domain to its admitted source.
 * Payload provenance comes from the operation and owned annotation arms. Escape
 * locations come from the same spelling function used by the editing planner.
 * No text diff or renderer/native-operation recognition establishes meaning.
 */
export function editingReconciliation(
  core: DocumentCore,
  previous: DocumentRevision,
  input: DocumentSourceEdit,
  commit: DocumentCommit,
  scope: 'visible' | 'structure'
): readonly DocumentSourceEdit[] | undefined {
  return compiledEditReconciliation(core, previous, input, commit.change.appliedEdits, commit.revision, scope)
}

/** The same ownership proof also serves a planner's already-compiled products. */
export function compiledEditReconciliation(
  core: DocumentCore,
  previous: DocumentRevision,
  input: DocumentSourceEdit,
  edits: readonly DocumentSourceEdit[],
  revision: DocumentRevision,
  scope: 'visible' | 'structure'
): readonly DocumentSourceEdit[] | undefined {
  const ordinary = ordinaryReconciliation(core, previous, input, edits, revision, scope)
  if (ordinary !== undefined) return ordinary
  if (edits.length !== 1) return undefined
  const applied = edits[0]
  if (applied === undefined) return undefined
  if (input.start === input.end || input.insert.length === 0) {
    return compiledReplacementReconciliation(core, previous, input, applied, revision, 0)
  }
  const owned = markupReplacementRange(core, previous, input, scope)
  if (owned === undefined) return undefined
  const mapped = compiledReplacementReconciliation(core, previous, { ...input, ...owned }, applied, revision, 0)
  if (mapped === undefined) return undefined
  // The compiler may consume elided delimiters beyond the visible replacement.
  // Compose their removal with its exact arm spelling in the original input domain.
  const prefix = input.start - owned.start
  const suffix = owned.end - input.end
  const normalizedEnd = owned.start + input.insert.length
  const result: DocumentSourceEdit[] = mapped.map(edit => {
    const offset = edit.start < owned.start
      ? edit.start
      : edit.start <= normalizedEnd ? edit.start + prefix : edit.start + prefix + suffix
    return { start: offset, end: offset, insert: edit.insert }
  })
  if (prefix > 0) result.push({ start: owned.start, end: input.start, insert: '' })
  if (suffix > 0) result.push({ start: input.start + input.insert.length, end: input.start + input.insert.length + suffix, insert: '' })
  return Object.freeze(result.sort((left, right) => left.start - right.start || left.end - right.end).map(edit => Object.freeze(edit)))
}

function compiledReplacementReconciliation(
  core: DocumentCore, previous: DocumentRevision, input: DocumentSourceEdit,
  applied: DocumentSourceEdit, committed: DocumentRevision, compiledOffset: number
): readonly DocumentSourceEdit[] | undefined {
  if (input.start === input.end && applied.start === applied.end && input.insert === applied.insert && input.start !== applied.start) {
    // Tracked insertion at a suggestion's exterior may extend its existing
    // content/new arm. Relate those exact owned delimiters to the declared payload;
    // the unchanged surrounding text is never inferred by diffing projections.
    const pending = [...previous.annotations]
    while (pending.length > 0) {
      const annotation = pending.pop()
      if (annotation === undefined) break
      for (const arm of annotation.arms) pending.push(...arm.annotations)
      if (annotation.kind !== 'addition' && annotation.kind !== 'substitution') continue
      const arm = annotation.arms.find(arm => arm.name === (annotation.kind === 'addition' ? 'content' : 'new'))
      if (arm === undefined) continue
      if (input.start === annotation.range.start && applied.start === arm.range.start) {
        const delimiter = core.sourceSlice(previous, { start: annotation.range.start, end: arm.range.start })
        return Object.freeze([
          Object.freeze({ start: input.start, end: input.start, insert: delimiter }),
          Object.freeze({ start: input.start + input.insert.length, end: applied.start + input.insert.length, insert: '' })
        ])
      }
      if (input.start === annotation.range.end && applied.start === arm.range.end) {
        const delimiter = core.sourceSlice(previous, { start: arm.range.end, end: annotation.range.end })
        return Object.freeze([
          Object.freeze({ start: applied.start, end: input.start, insert: '' }),
          Object.freeze({ start: input.start + input.insert.length, end: input.start + input.insert.length, insert: delimiter })
        ])
      }
    }
  }
  if (input.start < applied.start || input.end > applied.end) return undefined
  const native = core.sourceSlice(previous, { start: applied.start, end: input.start }) + input.insert +
    core.sourceSlice(previous, { start: input.end, end: applied.end })
  const spelling = nativeCriticSpelling(native)
  const inserts = new Map<number, string>()
  const append = (offset: number, value: string): void => {
    if (value.length > 0) inserts.set(offset, (inserts.get(offset) ?? '') + value)
  }
  const payload = (value: string): boolean => {
    if (value === native) return true
    if (value !== spelling.text) return false
    for (const offset of spelling.escapes) append(applied.start + offset, '\\')
    return true
  }
  if (!payload(applied.insert)) {
    const pending: CriticMarkupAnnotation[] = [...committed.annotations]
    let owner: CriticMarkupAnnotation | undefined
    while (pending.length > 0) {
      const annotation = pending.pop()
      if (annotation === undefined) break
      const start = applied.start + compiledOffset
      if (annotation.range.start === start && annotation.range.end === start + applied.insert.length) {
        owner = annotation
        break
      }
      for (const arm of annotation.arms) pending.push(...arm.annotations)
    }
    if (owner?.kind === 'deletion' && native === '') {
      append(applied.start, applied.insert)
    } else {
      const arm = owner?.arms.find(item => item.name === (owner?.kind === 'substitution' ? 'new' : 'content'))
      if ((owner?.kind !== 'addition' && owner?.kind !== 'substitution') || arm === undefined) return undefined
      // This annotation owns exactly the declared compiled insertion. Reading
      // its spelling from that insertion also supports an uncommitted preview
      // without materializing or registering another source revision.
      const sourceStart = applied.start + compiledOffset
      append(applied.start, applied.insert.slice(owner.range.start - sourceStart, arm.range.start - sourceStart))
      if (!payload(applied.insert.slice(arm.range.start - sourceStart, arm.range.end - sourceStart))) return undefined
      append(applied.start + native.length, applied.insert.slice(arm.range.end - sourceStart, owner.range.end - sourceStart))
    }
  }
  return Object.freeze([...inserts].sort(([left], [right]) => left - right).map(([offset, insert]) =>
    Object.freeze({ start: offset, end: offset, insert })))
}

/** Compose proven per-operation maps when the compiler retains their exact intervals. */
export function sparseEditingReconciliation(
  core: DocumentCore, previous: DocumentRevision, inputs: readonly DocumentSourceEdit[], commit: DocumentCommit
): readonly DocumentSourceEdit[] | undefined {
  const deletion = sparseDeletionReconciliation(core, previous, inputs, commit)
  if (deletion !== undefined) return deletion
  // Adjacent declared edits have one exact replacement payload. The ordinary
  // compiler can combine their intervals (for example a paragraph separator
  // insertion at the start of a removed list marker). Coalesce that existing
  // operation provenance before comparing it with the compiled source edits.
  const applied = commit.change.appliedEdits
  const compiledStarts = new Set(applied.map(edit => edit.start))
  const contiguous: DocumentSourceEdit[] = []
  for (const input of inputs) {
    const last = contiguous.at(-1)
    if (last !== undefined && input.start < last.end) return undefined
    if (last !== undefined && input.start === last.end && (last.start === input.start || !compiledStarts.has(input.start))) {
      contiguous[contiguous.length - 1] = { start: last.start, end: input.end, insert: last.insert + input.insert }
    } else contiguous.push(input)
  }
  inputs = contiguous
  if (inputs.length >= 1 && applied.length === 1) {
    // A structural operation may compile its sparse edits as one suggestion.
    // Compose the declared edits in their existing source interval; the exact
    // compiler-owned arm must match this payload before it supplies a map.
    const first = inputs[0]!
    const last = inputs.at(-1)!
    if (inputs.some((input, index) => index > 0 && input.start < inputs[index - 1]!.end)) return undefined
    let insert = core.sourceSlice(previous, { start: first.start, end: last.end })
    for (const input of [...inputs].reverse()) insert = insert.slice(0, input.start - first.start) + input.insert + insert.slice(input.end - first.start)
    return compiledReplacementReconciliation(core, previous, { start: first.start, end: last.end, insert }, applied[0]!, commit.revision, 0)
  }
  if (inputs.length < 2 || inputs.length !== applied.length) return undefined
  const result: DocumentSourceEdit[] = []
  let inputOffset = 0
  let compiledOffset = 0
  for (const [index, input] of inputs.entries()) {
    const actual = applied[index]
    if (actual === undefined || actual.start !== input.start || actual.end !== input.end) return undefined
    const mapped = compiledReplacementReconciliation(core, previous, input, actual, commit.revision, compiledOffset)
    if (mapped === undefined) return undefined
    for (const edit of mapped) result.push({ start: edit.start + inputOffset, end: edit.end + inputOffset, insert: edit.insert })
    inputOffset += input.insert.length - (input.end - input.start)
    compiledOffset += actual.insert.length - (actual.end - actual.start)
  }
  return Object.freeze(result.sort((left, right) => left.start - right.start || left.end - right.end).map(edit => Object.freeze(edit)))
}

/** A structural command can retain an original source boundary across its compilation. */
export function retainedSourceEndpoint(core: DocumentCore, previous: DocumentRevision, original: number, planned: number, declared: readonly DocumentSourceEdit[], compiled: readonly DocumentSourceEdit[]): number | undefined {
  const removed = (edits: readonly DocumentSourceEdit[]) => edits.some(edit => edit.start <= original && original < edit.end)
  if (removed(declared) || removed(compiled) || positionAfter(declared, original, true) !== planned) return undefined
  const syntax = core.project(previous, 'markup').syntax
  const projected = syntax.coordinates.toProjected(original, 'next')
  const retained = (start: number, end: number) => start < end &&
    !declared.some(edit => edit.start < end && edit.end > start) && !compiled.some(edit => edit.start < end && edit.end > start)
  const incidentText = (node: typeof syntax.ast.root): boolean => {
    if (projected < node.range.start || projected > node.range.end) return false
    if (node.kind === 'text') {
      const start = syntax.coordinates.toSource(node.range.start, 'next')
      const end = syntax.coordinates.toSource(node.range.end, 'previous')
      return original >= start && original <= end &&
        (retained(Math.max(start, original - 1), original) || retained(original, Math.min(end, original + 1)))
    }
    return node.children.some(incidentText)
  }
  // A consumed trigger's end may numerically coincide with the newly authored
  // destination. Require adjacent retained model text, not just equal offsets.
  if (!incidentText(syntax.ast.root)) return undefined
  return positionAfter(compiled, original, true)
}

import type { CriticMarkupAnnotation, DocumentCore, DocumentCommit, DocumentRevision, DocumentSourceEdit } from './documentCore.js'
import { isAnnotationDelimiter } from './annotationDelimiter.js'
import { createMarkupCompoundSourceEdits } from './markupEditing.js'
import { markupEditOwnership, markupReplacementRange } from './markupEditOwnership.js'
import { nativeCriticSpelling, protectNativeCriticText, retainedTrackedHistoryEdit } from './trackedAuthoring.js'
import { positionAfter } from './sourcePosition.js'

function ordinaryCompilationMatches(
  core: DocumentCore, previous: DocumentRevision, inputs: readonly DocumentSourceEdit[],
  applied: readonly DocumentSourceEdit[], commitRevision: DocumentRevision, scope: 'visible' | 'structure', canonicalImport = false
): boolean {
  // Reuse the ordinary compiler's source ownership rules. Its validation uses
  // the already committed product only for exactly the same compiled operation;
  // this proof neither reparses source nor publishes a second revision.
  // One ordinary insertion compiles to itself at its own position, in its own
  // or its protected spelling, and ordinary deletions insert nothing; any
  // other result is decided without its proof.
  const insertion = inputs.length === 1 ? inputs[0] : undefined
  const compiled = applied.length === 1 ? applied[0] : undefined
  if (insertion !== undefined && insertion.start === insertion.end && insertion.insert.length > 0 &&
      (compiled === undefined || compiled.start !== insertion.start || compiled.end !== insertion.start ||
        (compiled.insert !== insertion.insert && compiled.insert !== protectNativeCriticText(insertion.insert)))) return false
  if (inputs.every(input => input.insert.length === 0) && applied.some(edit => edit.insert.length > 0)) return false
  const mismatch = Symbol('different compilation')
  let planned: readonly DocumentSourceEdit[] | undefined
  try {
    planned = createMarkupCompoundSourceEdits(core, previous, inputs, candidate => {
      if (candidate.length !== applied.length || !candidate.every((edit, index) => {
        const actual = applied[index]
        return actual !== undefined && actual.start === edit.start && actual.end === edit.end && actual.insert === edit.insert
      })) throw mismatch
      return commitRevision
    }, canonicalImport, scope)
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
  return ordinaryIntervalReconciliation(core, previous, input, applied)
}

function ordinaryIntervalReconciliation(
  core: DocumentCore, previous: DocumentRevision, input: DocumentSourceEdit,
  applied: readonly DocumentSourceEdit[]
): readonly DocumentSourceEdit[] | undefined {
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
  const retained = retainedTrackedHistoryEdit(core, previous, input)
  if (retained !== undefined && retained.start === applied.start && retained.end === applied.end && retained.insert === applied.insert) {
    return Object.freeze([Object.freeze({ start: input.start, end: input.start, insert: retained.insert })])
  }
  if (input.insert === '' && applied.insert === '') {
    const ownership = markupEditOwnership(core, previous, [input], 'structure')
    const deleted = ownership?.deleted.slice().sort((a, b) => a.start - b.start)
    if (deleted !== undefined && deleted.length > 0) {
      let end = deleted[0]!.start
      const contiguous = deleted.every(range => {
        if (range.start > end) return false
        end = Math.max(end, range.end)
        return true
      })
      if (contiguous && deleted[0]!.start === applied.start && end === applied.end) return ordinaryIntervalReconciliation(core, previous, input, [applied])
    }
  }
  if (input.start === input.end && applied.start === applied.end && input.insert === applied.insert && input.start !== applied.start) {
    // Tracked insertion beside a suggestion may move across its hidden
    // delimiters and retained history into an existing content/new arm.
    // Relate that exact hidden source to the declared payload; the unchanged
    // surrounding text is never inferred by diffing projections.
    const from = Math.min(input.start, applied.start)
    const to = Math.max(input.start, applied.start)
    let hidden = true
    for (let offset = from; offset < to && hidden; offset += 1) hidden = !visibleAt(previous.annotations, offset)
    // The payload lands at an edge of a proposed arm, never inside syntax.
    const pending = [...previous.annotations]
    let armEdge = false
    while (pending.length > 0 && !armEdge) {
      const annotation = pending.pop()!
      for (const arm of annotation.arms) pending.push(...arm.annotations)
      armEdge = (annotation.kind === 'addition' || annotation.kind === 'substitution') && annotation.arms.some(arm =>
        arm.name === (annotation.kind === 'addition' ? 'content' : 'new') &&
        (applied.start > input.start ? arm.range.start : arm.range.end) === applied.start)
    }
    if (hidden && armEdge) {
      const gap = core.sourceSlice(previous, { start: from, end: to })
      const end = input.start + input.insert.length
      return applied.start > input.start
        ? Object.freeze([
          Object.freeze({ start: input.start, end: input.start, insert: gap }),
          Object.freeze({ start: end, end: end + gap.length, insert: '' })
        ])
        : Object.freeze([
          Object.freeze({ start: applied.start, end: input.start, insert: '' }),
          Object.freeze({ start: end, end, insert: gap })
        ])
    }
  }
  if (input.start < applied.start || input.end > applied.end) {
    // A suggestion moved to the next line start retains the line break the
    // operation typed before it; relate both over their common interval.
    if (input.start === input.end || applied.start === applied.end) {
      const start = Math.min(input.start, applied.start)
      const end = Math.max(input.end, applied.end)
      if (end - start > input.insert.length + applied.insert.length + 2) return undefined
      applied = {
        start,
        end,
        insert: core.sourceSlice(previous, { start, end: applied.start }) + applied.insert +
          core.sourceSlice(previous, { start: applied.end, end })
      }
    } else return undefined
  }
  const native = core.sourceSlice(previous, { start: applied.start, end: input.start }) + input.insert +
    core.sourceSlice(previous, { start: input.end, end: applied.end })
  // A compiler-owned escape completion replaced by typed text is removed.
  if (applied.insert.length > 0 && applied.insert.length < native.length && native.endsWith(applied.insert) &&
      /^\\+$/u.test(native.slice(0, native.length - applied.insert.length))) {
    return Object.freeze([Object.freeze({ start: applied.start, end: applied.start + native.length - applied.insert.length, insert: '' })])
  }
  return ownedReplacementReconciliation(applied, committed, compiledOffset, native) ??
    visibleReplacementReconciliation(previous, input, applied, committed, compiledOffset, native) ??
    splitHistoryReconciliation(input, applied, committed, compiledOffset)
}

/** Whether a committed source offset is visible text rather than delimiter or history. */
function visibleAt(annotations: readonly CriticMarkupAnnotation[], offset: number): boolean {
  const pending = [...annotations]
  while (pending.length > 0) {
    const annotation = pending.pop()!
    if (offset < annotation.range.start || offset >= annotation.range.end) continue
    const arm = annotation.arms.find(arm => arm.range.start <= offset && offset < arm.range.end)
    if (arm === undefined || annotation.kind === 'deletion' || annotation.kind === 'comment' || arm.name === 'old') return false
    pending.push(...arm.annotations)
  }
  return true
}

/**
 * A widened suggestion retains the operation's text as its visible arms. Its
 * delimiters, retained history and delimiter-line padding are compiler-owned
 * insertions around that exact text; delimiters and history the operation's
 * span previously contained move into the suggestion's hidden arms.
 */
function visibleReplacementReconciliation(
  previous: DocumentRevision, input: DocumentSourceEdit,
  applied: DocumentSourceEdit, committed: DocumentRevision, compiledOffset: number, native: string
): readonly DocumentSourceEdit[] | undefined {
  const start = applied.start + compiledOffset
  const prefix = input.start - applied.start
  const nativeHidden = (index: number): boolean => {
    if (index >= prefix && index < prefix + input.insert.length) return false
    const offset = index < prefix ? applied.start + index : input.end + index - prefix - input.insert.length
    return !visibleAt(previous.annotations, offset)
  }
  const edits: DocumentSourceEdit[] = []
  const push = (edit: DocumentSourceEdit): void => {
    const last = edits.at(-1)
    if (last !== undefined && last.end === edit.start && (edit.start === edit.end ? last.start === last.end : last.insert.length === 0)) {
      edits[edits.length - 1] = { start: last.start, end: edit.end, insert: last.insert + edit.insert }
    } else edits.push(edit)
  }
  let consumed = 0
  for (let index = 0; index < applied.insert.length || consumed < native.length;) {
    if (consumed < native.length && nativeHidden(consumed)) {
      push({ start: applied.start + consumed, end: applied.start + consumed + 1, insert: '' })
      consumed += 1
      continue
    }
    if (index >= applied.insert.length) return undefined
    const character = applied.insert[index]!
    const visible = visibleAt(committed.annotations, start + index)
    index += 1
    if (visible && native[consumed] === character) {
      consumed += 1
      continue
    }
    if (visible && character === '\\' && consumed > 0) {
      // An escape completion belongs to the escaped text it follows, so a
      // caret after that text also follows its completion.
      const offset = applied.start + consumed
      const last = edits.at(-1)
      if (last !== undefined && last.end === offset && last.start < last.end) {
        edits[edits.length - 1] = { ...last, insert: last.insert + character }
      } else edits.push({ start: offset - 1, end: offset, insert: native[consumed - 1]! + character })
      continue
    }
    if (visible && !/[\n\r]/u.test(character)) return undefined
    push({ start: applied.start + consumed, end: applied.start + consumed, insert: character })
  }
  return Object.freeze(edits.map(edit => Object.freeze(edit)))
}

/** Text typed into history is the complete Addition that splits it. */
function splitHistoryReconciliation(
  input: DocumentSourceEdit, applied: DocumentSourceEdit, committed: DocumentRevision, compiledOffset: number
): readonly DocumentSourceEdit[] | undefined {
  if (input.start !== input.end || input.insert.length === 0) return undefined
  const start = applied.start + compiledOffset
  const pending = [...committed.annotations]
  while (pending.length > 0) {
    const annotation = pending.pop()!
    for (const arm of annotation.arms) pending.push(...arm.annotations)
    if (annotation.kind !== 'addition' || annotation.range.start < start || annotation.range.end > start + applied.insert.length) continue
    const arm = annotation.arms[0]
    const text = arm === undefined ? '' : committed.source.slice(arm.range.start, arm.range.end)
    // The Addition holds the typed text, completed by an escape the closer needs.
    if (arm === undefined || !text.startsWith(input.insert) || !/^\\*$/u.test(text.slice(input.insert.length))) continue
    const before = applied.insert.slice(0, arm.range.start - start)
    const after = applied.insert.slice(arm.range.end - start)
    const inserted = input.start + input.insert.length
    const completion = text.slice(input.insert.length)
    return Object.freeze([
      Object.freeze({ start: applied.start, end: input.start, insert: before }),
      ...(completion.length === 0 ? [] : [Object.freeze({ start: inserted - 1, end: inserted, insert: input.insert.at(-1)! + completion })]),
      Object.freeze({ start: inserted, end: inserted + applied.end - input.end, insert: after })
    ].filter(edit => edit.start < edit.end || edit.insert.length > 0))
  }
  return undefined
}

function ownedReplacementReconciliation(
  applied: DocumentSourceEdit, committed: DocumentRevision, compiledOffset: number, native: string
): readonly DocumentSourceEdit[] | undefined {
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
  core: DocumentCore, previous: DocumentRevision, inputs: readonly DocumentSourceEdit[], commit: DocumentCommit, canonicalImport = false, scope: 'visible' | 'structure' = 'structure'
): readonly DocumentSourceEdit[] | undefined {
  if (canonicalImport && ordinaryCompilationMatches(core, previous, inputs, commit.change.appliedEdits, commit.revision, scope, true)) {
    // The shared compiler proved the whole operation, including imported CM.
    // Relate each disjoint declared action to its owned deletion intervals.
    const used = new Set<DocumentSourceEdit>()
    const result: DocumentSourceEdit[] = []
    let offset = 0
    for (const input of inputs) {
      const actual = commit.change.appliedEdits.filter(edit => edit.start <= input.end && input.start <= edit.end)
      if (actual.some(edit => used.has(edit))) return undefined
      for (const edit of actual) used.add(edit)
      const mapped = ordinaryIntervalReconciliation(core, previous, input, actual)
      if (mapped === undefined) return undefined
      result.push(...mapped.map(edit => ({ ...edit, start: edit.start + offset, end: edit.end + offset })))
      offset += input.insert.length - (input.end - input.start)
    }
    if (used.size !== commit.change.appliedEdits.length) return undefined
    return Object.freeze(result.sort((a, b) => a.start - b.start || a.end - b.end).map(edit => Object.freeze(edit)))
  }
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
  if (
    inputs.every((input, index) => input.start === input.end && applied[index]!.start === applied[index]!.end &&
      input.insert === applied[index]!.insert) &&
    inputs.some((input, index) => input.start !== applied[index]!.start)
  ) {
    // Tracking can move a pure insertion across adjacent annotation delimiters
    // (a list marker placed inside the addition that owns its paragraph).
    // Equal ordered insertions keep equal lengths, so each moved span maps in
    // place and every position outside it is unchanged.
    const moved: DocumentSourceEdit[] = []
    let offset = 0
    for (const [index, input] of inputs.entries()) {
      const planned = input.start + offset
      const compiled = applied[index]!.start + offset
      if (planned !== compiled) {
        const start = Math.min(planned, compiled)
        const end = Math.max(planned, compiled) + input.insert.length
        moved.push(Object.freeze({ start, end, insert: commit.revision.source.slice(start, end) }))
      }
      offset += input.insert.length
    }
    return Object.freeze(moved)
  }
  const result: DocumentSourceEdit[] = []
  let inputOffset = 0
  let compiledOffset = 0
  for (const [index, input] of inputs.entries()) {
    const actual = applied[index]
    if (actual === undefined || actual.start > input.start || actual.end < input.end) return undefined
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
      // Hidden annotation delimiters between a caret and its text keep that
      // caret beside the same retained text, as at a line start before an opener.
      let start = syntax.coordinates.toSource(node.range.start, 'next')
      let end = syntax.coordinates.toSource(node.range.end, 'previous')
      while (start > original && isAnnotationDelimiter(previous.annotations, start - 1)) start -= 1
      while (end < original && isAnnotationDelimiter(previous.annotations, end)) end += 1
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

import type { DocumentSourceEdit, SourceRange } from '@marktext/document-core'

export interface MuyaPlainTextSourceBinding {
  /** Muya state path for one top-level paragraph's text field. */
  readonly path: readonly [blockIndex: number, field: 'text']
  /** Exact canonical-source range occupied by `text`. */
  readonly sourceRange: SourceRange
  readonly text: string
}

export interface MuyaMathSourceBinding {
  readonly blockIndex: number
  readonly sourceRange: SourceRange
  readonly text: string
}

export type MuyaMathSourceEditResult = Readonly<{
  readonly edit: DocumentSourceEdit
  readonly binding: MuyaMathSourceBinding
}>

export type MuyaPlainTextSourceEditResult =
  | Readonly<{ readonly kind: 'edit'; readonly edit: DocumentSourceEdit }>
  | Readonly<{
    readonly kind: 'unsupported'
    readonly reason:
      | 'binding-mismatch'
      | 'block-shape'
      | 'no-text-change'
      | 'non-user-change'
      | 'operation-mismatch'
      | 'operation-shape'
  }>

export interface MuyaPlainTextSourceEditAdapter {
  accept(change: unknown): MuyaPlainTextSourceEditResult
}

/**
 * Decodes the proven native Muya operation for pasting two or more plain
 * paragraphs into one bound paragraph. The returned edit carries only the
 * pasted visible text; the document actor remains responsible for Track
 * Changes syntax.
 */
export function sourceEditForMuyaTwoParagraphPaste(
  bindings: readonly MuyaPlainTextSourceBinding[],
  changeValue: unknown
): DocumentSourceEdit | undefined {
  const change = jsonChangeOf(changeValue)
  if (
    change === undefined || change.source !== 'user' ||
    !Array.isArray(change.op) || change.op.length < 2 ||
    !Array.isArray(change.prevDoc) || !Array.isArray(change.doc) ||
    change.prevDoc.length !== bindings.length ||
    change.doc.length !== change.prevDoc.length + change.op.length - 1
  ) return undefined

  const firstComponent = change.op[0]
  if (!Array.isArray(firstComponent) || firstComponent.length !== 3) {
    return undefined
  }
  const blockIndex = firstComponent[0]
  if (!Number.isSafeInteger(blockIndex) || (blockIndex as number) < 0) {
    return undefined
  }
  const index = blockIndex as number
  const binding = bindings[index]
  if (
    binding === undefined || binding.path[0] !== index ||
    binding.path[1] !== 'text' ||
    binding.sourceRange.end - binding.sourceRange.start !== binding.text.length
  ) return undefined

  for (let previousIndex = 0; previousIndex < bindings.length; previousIndex += 1) {
    const previousBinding = bindings[previousIndex]
    if (
      previousBinding === undefined ||
      previousBinding.path[0] !== previousIndex ||
      previousBinding.path[1] !== 'text' ||
      paragraphTextAt(change.prevDoc, previousIndex) !== previousBinding.text
    ) return undefined
    if (
      previousIndex !== index &&
      paragraphTextAt(
        change.doc,
        previousIndex < index
          ? previousIndex
          : previousIndex + change.op.length - 1
      ) !== previousBinding.text
    ) return undefined
  }

  const nativeTextEdit = textEditAt(firstComponent, index)
  if (nativeTextEdit === undefined || nativeTextEdit.length !== 3) {
    return undefined
  }
  const leadingSkip = nativeTextEdit[0]
  const deletion = nativeTextEdit[1]
  const firstInsert = nativeTextEdit[2]
  if (
    typeof leadingSkip !== 'number' ||
    deletion === null || typeof deletion !== 'object' ||
    Object.keys(deletion).length !== 1 ||
    typeof firstInsert !== 'string' || firstInsert.length === 0
  ) return undefined
  const prefixUnits = utf16UnitsOfCodePoints(binding.text, leadingSkip)
  if (prefixUnits === undefined) return undefined
  const suffix = binding.text.slice(prefixUnits)
  if (
    suffix.length === 0 ||
    (deletion as { readonly d?: unknown }).d !== suffix ||
    paragraphTextAt(change.doc, index) !==
      `${binding.text.slice(0, prefixUnits)}${firstInsert}`
  ) return undefined

  const insertedText = [firstInsert]
  for (let offset = 1; offset < change.op.length; offset += 1) {
    const insertionComponent = change.op[offset]
    if (
      !Array.isArray(insertionComponent) || insertionComponent.length !== 2 ||
      insertionComponent[0] !== index + offset ||
      insertionComponent[1] === null ||
      typeof insertionComponent[1] !== 'object'
    ) return undefined
    const insertionDescriptor = insertionComponent[1] as {
      readonly i?: unknown
    }
    if (
      Object.keys(insertionDescriptor).length !== 1 ||
      insertionDescriptor.i === null ||
      typeof insertionDescriptor.i !== 'object'
    ) return undefined
    const insertedBlock = insertionDescriptor.i as {
      readonly name?: unknown
      readonly text?: unknown
    }
    if (
      insertedBlock.name !== 'paragraph' ||
      typeof insertedBlock.text !== 'string' ||
      paragraphTextAt(change.doc, index + offset) !== insertedBlock.text
    ) return undefined
    const isLast = offset === change.op.length - 1
    const contribution = isLast
      ? insertedBlock.text.endsWith(suffix)
        ? insertedBlock.text.slice(0, -suffix.length)
        : undefined
      : insertedBlock.text
    if (contribution === undefined || contribution.length === 0) return undefined
    insertedText.push(contribution)
  }

  const position = binding.sourceRange.start + prefixUnits
  return Object.freeze({
    start: position,
    end: position,
    insert: insertedText.join('\n\n')
  })
}

/**
 * Decodes the currently proven native Muya cross-paragraph typing operation.
 * The operation removes a contiguous run of top-level plain paragraphs and
 * merges the two endpoint fragments plus the typed text into the first block.
 */
export function sourceEditForMuyaCrossParagraphChange(
  bindings: readonly MuyaPlainTextSourceBinding[],
  changeValue: unknown
): DocumentSourceEdit | undefined {
  const change = jsonChangeOf(changeValue)
  if (
    change === undefined || change.source !== 'user' ||
    !Array.isArray(change.op) || change.op.length < 2 ||
    !Array.isArray(change.prevDoc) || !Array.isArray(change.doc)
  ) return undefined

  const firstComponent = change.op[0]
  if (!Array.isArray(firstComponent) || firstComponent.length !== 3) {
    return undefined
  }
  const startIndex = firstComponent[0]
  if (!Number.isSafeInteger(startIndex) || (startIndex as number) < 0) {
    return undefined
  }
  const first = startIndex as number
  const removalCount = change.op.length - 1
  const endIndex = first + removalCount
  for (let offset = 1; offset < change.op.length; offset += 1) {
    const removal = change.op[offset]
    if (
      !Array.isArray(removal) || removal.length !== 2 ||
      removal[0] !== first + offset || removal[1] === null ||
      typeof removal[1] !== 'object'
    ) return undefined
    const descriptor = removal[1] as { readonly r?: unknown }
    if (Object.keys(descriptor).length !== 1 || descriptor.r !== true) {
      return undefined
    }
  }

  if (
    change.prevDoc.length !== bindings.length ||
    change.doc.length !== change.prevDoc.length - removalCount
  ) return undefined
  const startBinding = bindings[first]
  const endBinding = bindings[endIndex]
  if (
    startBinding === undefined || endBinding === undefined ||
    startBinding.path[0] !== first || startBinding.path[1] !== 'text' ||
    endBinding.path[0] !== endIndex || endBinding.path[1] !== 'text'
  ) return undefined
  for (let index = first; index <= endIndex; index += 1) {
    const binding = bindings[index]
    if (
      binding === undefined || binding.path[0] !== index ||
      binding.path[1] !== 'text' ||
      paragraphTextAt(change.prevDoc, index) !== binding.text
    ) return undefined
    if (
      index > first &&
      binding.sourceRange.start < (bindings[index - 1]?.sourceRange.end ?? 0)
    ) return undefined
  }

  const nativeTextEdit = textEditAt(firstComponent, first)
  const previous = startBinding.text
  const next = paragraphTextAt(change.doc, first)
  if (
    nativeTextEdit === undefined || next === undefined ||
    applyNativeTextEdit(previous, nativeTextEdit) !== next
  ) return undefined
  const leadingSkip = nativeTextEdit[0]
  if (typeof leadingSkip !== 'number') return undefined
  const prefixUnits = utf16UnitsOfCodePoints(previous, leadingSkip)
  if (
    prefixUnits === undefined ||
    !next.startsWith(previous.slice(0, prefixUnits))
  ) return undefined

  const maximumSuffix = Math.min(
    endBinding.text.length,
    next.length - prefixUnits
  )
  let suffixUnits = 0
  while (
    suffixUnits < maximumSuffix &&
    endBinding.text.charCodeAt(endBinding.text.length - suffixUnits - 1) ===
      next.charCodeAt(next.length - suffixUnits - 1)
  ) suffixUnits += 1
  const insert = next.slice(prefixUnits, next.length - suffixUnits)

  const start = startBinding.sourceRange.start + prefixUnits
  const end = endBinding.sourceRange.end - suffixUnits
  if (end <= start) return undefined
  return Object.freeze({ start, end, insert })
}

interface MuyaJsonChange {
  readonly op: unknown
  readonly source: unknown
  readonly prevDoc: unknown
  readonly doc: unknown
}

const unsupported = (
  reason: Extract<MuyaPlainTextSourceEditResult, { kind: 'unsupported' }>['reason']
): MuyaPlainTextSourceEditResult => Object.freeze({
  kind: 'unsupported',
  reason
})

const jsonChangeOf = (value: unknown): MuyaJsonChange | undefined => {
  if (value === null || typeof value !== 'object') return undefined
  const change = value as Partial<MuyaJsonChange>
  return {
    op: change.op,
    source: change.source,
    prevDoc: change.prevDoc,
    doc: change.doc
  }
}

const paragraphTextAt = (
  state: unknown,
  index: number
): string | undefined => {
  if (!Array.isArray(state)) return undefined
  const block: unknown = state[index]
  if (block === null || typeof block !== 'object') return undefined
  const candidate = block as { readonly name?: unknown; readonly text?: unknown }
  if (candidate.name !== 'paragraph' || typeof candidate.text !== 'string') {
    return undefined
  }
  return candidate.text
}

const mathTextAt = (
  state: unknown,
  index: number
): string | undefined => {
  if (!Array.isArray(state)) return undefined
  const block: unknown = state[index]
  if (block === null || typeof block !== 'object') return undefined
  const candidate = block as {
    readonly name?: unknown
    readonly text?: unknown
    readonly meta?: unknown
  }
  if (
    candidate.name !== 'math-block' || typeof candidate.text !== 'string' ||
    candidate.meta === null || typeof candidate.meta !== 'object' ||
    (candidate.meta as { readonly mathStyle?: unknown }).mathStyle !== ''
  ) return undefined
  return candidate.text
}

const textEditAt = (
  operation: unknown,
  blockIndex: number
): readonly unknown[] | undefined => {
  if (
    !Array.isArray(operation) ||
    operation.length !== 3 ||
    operation[0] !== blockIndex ||
    operation[1] !== 'text'
  ) return undefined
  const component: unknown = operation[2]
  if (component === null || typeof component !== 'object') return undefined
  const fields = Object.keys(component)
  if (fields.length !== 1 || fields[0] !== 'es') return undefined
  const edit = (component as { readonly es?: unknown }).es
  return Array.isArray(edit) ? edit : undefined
}

const utf16UnitsOfCodePoints = (
  text: string,
  count: number
): number | undefined => {
  if (!Number.isSafeInteger(count) || count <= 0) return undefined
  let codePoints = 0
  let units = 0
  for (const value of text) {
    if (codePoints === count) break
    codePoints += 1
    units += value.length
  }
  return codePoints === count ? units : undefined
}

const applyNativeTextEdit = (
  previous: string,
  operation: readonly unknown[]
): string | undefined => {
  const output: string[] = []
  let remaining = previous
  for (const component of operation) {
    if (typeof component === 'number') {
      const units = utf16UnitsOfCodePoints(remaining, component)
      if (units === undefined) return undefined
      output.push(remaining.slice(0, units))
      remaining = remaining.slice(units)
      continue
    }
    if (typeof component === 'string') {
      if (component.length === 0) return undefined
      output.push(component)
      continue
    }
    if (component === null || typeof component !== 'object') return undefined
    const fields = Object.keys(component)
    const deletion = (component as { readonly d?: unknown }).d
    if (
      fields.length !== 1 || fields[0] !== 'd' ||
      typeof deletion !== 'string' || deletion.length === 0 ||
      !remaining.startsWith(deletion)
    ) return undefined
    remaining = remaining.slice(deletion.length)
  }
  output.push(remaining)
  return output.join('')
}

const changedTextEdit = (
  sourceStart: number,
  previous: string,
  next: string
): DocumentSourceEdit | undefined => {
  let prefix = 0
  const sharedLimit = Math.min(previous.length, next.length)
  while (
    prefix < sharedLimit &&
    previous.charCodeAt(prefix) === next.charCodeAt(prefix)
  ) prefix += 1

  let suffix = 0
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous.charCodeAt(previous.length - suffix - 1) ===
      next.charCodeAt(next.length - suffix - 1)
  ) suffix += 1

  if (prefix === previous.length && prefix === next.length) return undefined
  return Object.freeze({
    start: sourceStart + prefix,
    end: sourceStart + previous.length - suffix,
    insert: next.slice(prefix, next.length - suffix)
  })
}

export function sourceEditForMuyaMathTextChange(
  binding: MuyaMathSourceBinding,
  changeValue: unknown
): MuyaMathSourceEditResult | undefined {
  const change = jsonChangeOf(changeValue)
  if (change === undefined || change.source !== 'user') return undefined
  const operation = textEditAt(change.op, binding.blockIndex)
  if (operation === undefined) return undefined
  const previous = mathTextAt(change.prevDoc, binding.blockIndex)
  const next = mathTextAt(change.doc, binding.blockIndex)
  if (
    previous === undefined || next === undefined || previous !== binding.text ||
    binding.sourceRange.end - binding.sourceRange.start !== previous.length ||
    applyNativeTextEdit(previous, operation) !== next
  ) return undefined
  const edit = changedTextEdit(binding.sourceRange.start, previous, next)
  if (edit === undefined) return undefined
  const delta = edit.insert.length - (edit.end - edit.start)
  return Object.freeze({
    edit,
    binding: Object.freeze({
      blockIndex: binding.blockIndex,
      sourceRange: Object.freeze({
        start: binding.sourceRange.start,
        end: binding.sourceRange.end + delta
      }),
      text: next
    })
  })
}

/**
 * Adapts one parser-bound top-level paragraph's native Muya text operation to
 * canonical UTF-16 coordinates. Other operation shapes remain fallback work.
 */
export function createMuyaPlainTextSourceEditAdapter(
  binding: MuyaPlainTextSourceBinding
): MuyaPlainTextSourceEditAdapter {
  const [blockIndex, field] = binding.path
  const { start, end } = binding.sourceRange
  if (
    !Number.isSafeInteger(blockIndex) || blockIndex < 0 || field !== 'text' ||
    !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
    start < 0 || end < start || end - start !== binding.text.length
  ) throw new RangeError('Muya plain-text source binding is invalid')
  let acceptedText = binding.text

  return Object.freeze({
    accept(changeValue: unknown): MuyaPlainTextSourceEditResult {
      const change = jsonChangeOf(changeValue)
      if (change === undefined || change.source !== 'user') {
        return unsupported('non-user-change')
      }
      const operation = textEditAt(change.op, blockIndex)
      if (operation === undefined) {
        return unsupported('operation-shape')
      }
      const previous = paragraphTextAt(change.prevDoc, blockIndex)
      const next = paragraphTextAt(change.doc, blockIndex)
      if (previous === undefined || next === undefined) {
        return unsupported('block-shape')
      }
      if (previous !== acceptedText) return unsupported('binding-mismatch')
      if (applyNativeTextEdit(previous, operation) !== next) {
        return unsupported('operation-mismatch')
      }
      const edit = changedTextEdit(start, previous, next)
      if (edit === undefined) return unsupported('no-text-change')
      acceptedText = next
      return Object.freeze({ kind: 'edit', edit })
    }
  })
}

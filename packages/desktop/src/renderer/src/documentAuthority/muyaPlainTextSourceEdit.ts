import type { DocumentSourceEdit, SourceRange } from '@marktext/document-core'
import { advanceMuyaSourceStructure } from './muyaContainerSourceEdit'
import {
  createMuyaNormalizedTextValidator,
  mappedMuyaSourceRange,
  type MuyaDocumentEnd,
  type MuyaSourceStructure
} from './muyaMarkupView'

export interface MuyaPlainTextSourceBinding {
  /** Muya state path ending in a content block's text field. */
  readonly path: readonly (number | string)[]
  /** Canonical envelope; segments map text when annotation syntax is hidden. */
  readonly sourceRange: SourceRange
  readonly text: string
  /** A current annotation owns text or an elided anchor in this leaf. */
  readonly annotationContext?: true
  /** Parser-owned unannotated outer block; carried by its first leaf only. */
  readonly outerBlock?: Readonly<{ range: SourceRange; source: string; followingSource?: string }>
  /** Canonical EOF lies beyond elided annotation closers and comments. */
  readonly documentEnd?: MuyaDocumentEnd
  readonly sourceStructure?: MuyaSourceStructure
  readonly paragraphPrefixPosition?: number
  /** Exact parser-owned prefix for a single-paragraph native container. */
  readonly containerPrefix?: Readonly<{ range: SourceRange; source: string }>
  readonly segments?: readonly Readonly<{ text: SourceRange; source: SourceRange }>[]
  /** Pending drafts place insertion after newly exposed old review content. */
  readonly insertionAffinity?: 'previous' | 'next'
  /** Parser-delimited spelling for a new sibling list item. */
  readonly listContinuation?: Readonly<{ prefix: string; lineEnding: string }>
  /** False keeps the structural paragraph selectable for Review but not editable. */
  readonly editable?: false
  /** Empty fenced bodies need a line ending before their existing closer. */
  readonly emptyLiteralLineEnding?: string
}

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

/** Validate a native draft delta without assuming it is already acknowledged. */
export function nativeMuyaTextEdit(changeValue: unknown): DocumentSourceEdit | undefined {
  const change = jsonChangeOf(changeValue)
  if (change?.source !== 'user' || !Array.isArray(change.op)) return undefined
  const path = change.op.slice(0, -1)
  if (
    path.at(-1) !== 'text' ||
    !path.every((part) => typeof part === 'string' || typeof part === 'number')
  ) { return undefined }
  const previous = textAtPath(change.prevDoc, path)
  const next = textAtPath(change.doc, path)
  const operation = textEditAtPath(change.op, path)
  if (
    previous === undefined ||
    next === undefined ||
    operation === undefined ||
    applyNativeTextEdit(previous, operation) !== next
  ) { return undefined }
  return changedTextEdit(0, previous, next)
}

/** Retain one validated native composition intent for later source mapping. */
export function composeMuyaNativeTextChange(
  previousValue: unknown,
  nextValue: unknown
): unknown | undefined {
  const next = jsonChangeOf(nextValue)
  if (nativeMuyaTextEdit(nextValue) === undefined || next === undefined || !Array.isArray(next.op)) { return undefined }
  if (previousValue === undefined) return structuredClone(nextValue)
  const previous = jsonChangeOf(previousValue)
  if (previous === undefined || !Array.isArray(previous.op)) return undefined
  const path = next.op.slice(0, -1)
  if (
    JSON.stringify(path) !== JSON.stringify(previous.op.slice(0, -1)) ||
    textAtPath(previous.doc, path) !== textAtPath(next.prevDoc, path)
  ) { return undefined }
  const before = textAtPath(previous.prevDoc, path)
  const after = textAtPath(next.doc, path)
  if (before === undefined || after === undefined) return undefined
  const edit = changedTextEdit(0, before, after) ?? {
    start: before.length,
    end: before.length,
    insert: ''
  }
  return {
    source: 'user',
    prevDoc: previous.prevDoc,
    doc: structuredClone(next.doc),
    op: [
      ...path,
      {
        es: [
          edit.start,
          ...(edit.end === edit.start ? [] : [{ d: before.slice(edit.start, edit.end) }]),
          ...(edit.insert.length === 0 ? [] : [edit.insert])
        ]
      }
    ]
  }
}

/** Preserve the canonical EOF and its exact newline suffix through pending edits. */
export function advanceMuyaDocumentEnd(
  boundary: MuyaDocumentEnd,
  edit: DocumentSourceEdit
): MuyaDocumentEnd {
  const offset = boundary.offset + edit.insert.length - (edit.end - edit.start)
  const suffixStart = boundary.offset - boundary.trailingLineEndings.length
  if (edit.end < suffixStart) return { ...boundary, offset }
  const suffix =
    boundary.trailingLineEndings.slice(0, Math.max(0, edit.start - suffixStart)) +
    edit.insert +
    boundary.trailingLineEndings.slice(Math.max(0, edit.end - suffixStart))
  const trailingLineEndings = suffix.match(/(?:\r\n|\r|\n)+$/u)?.[0] ?? ''
  const lineEnding = trailingLineEndings.match(/\r\n|\r|\n/u)?.[0] ?? boundary.lineEnding
  return { offset, trailingLineEndings, lineEnding }
}

/** Advance a bound view after a canonical edit without exposing hidden syntax. */
export function advanceMuyaSourceBinding(
  previous: MuyaPlainTextSourceBinding,
  edit: DocumentSourceEdit
): MuyaPlainTextSourceBinding {
  const delta = edit.insert.length - (edit.end - edit.start)
  const outer = previous.outerBlock
  let binding =
    previous.documentEnd === undefined
      ? previous
      : { ...previous, documentEnd: advanceMuyaDocumentEnd(previous.documentEnd, edit) }
  if (previous.sourceStructure !== undefined) {
    const sourceStructure = advanceMuyaSourceStructure(previous.sourceStructure, edit)
    const { sourceStructure: _oldStructure, ...rest } = binding
    binding = { ...rest, ...(sourceStructure === undefined ? {} : { sourceStructure }) }
  }
  const prefix = previous.containerPrefix
  if (prefix !== undefined) {
    if (edit.end <= prefix.range.start) {
      binding = {
        ...binding,
        containerPrefix: {
          ...prefix,
          range: { start: prefix.range.start + delta, end: prefix.range.end + delta }
        }
      }
    } else if (edit.start < prefix.range.end) {
      const { containerPrefix: _stalePrefix, ...rest } = binding
      binding = rest
    }
  }
  if (
    previous.paragraphPrefixPosition !== undefined &&
    edit.end <= previous.paragraphPrefixPosition &&
    edit.start < previous.paragraphPrefixPosition
  ) {
    binding = { ...binding, paragraphPrefixPosition: previous.paragraphPrefixPosition + delta }
  }
  if (outer !== undefined) {
    if (edit.end <= outer.range.start && edit.start < outer.range.start) {
      binding = {
        ...binding,
        outerBlock: {
          ...outer,
          source: outer.source,
          range: { start: outer.range.start + delta, end: outer.range.end + delta }
        }
      }
    } else if (edit.start >= outer.range.start && edit.end <= outer.range.end) {
      binding = {
        ...binding,
        outerBlock: {
          ...outer,
          range: { start: outer.range.start, end: outer.range.end + delta },
          source:
            outer.source.slice(0, edit.start - outer.range.start) +
            edit.insert +
            outer.source.slice(edit.end - outer.range.start)
        }
      }
    } else if (edit.start < outer.range.end && edit.end > outer.range.start) {
      const { outerBlock: _stale, ...rest } = binding
      binding = rest
    }
  }
  const segments = binding.segments
  if (
    edit.end < binding.sourceRange.start ||
    (edit.end === binding.sourceRange.start && edit.start < edit.end)
  ) {
    return {
      ...binding,
      sourceRange: {
        start: binding.sourceRange.start + delta,
        end: binding.sourceRange.end + delta
      },
      ...(segments === undefined
        ? {}
        : {
          segments: segments.map((segment) => ({
            text: segment.text,
            source: { start: segment.source.start + delta, end: segment.source.end + delta }
          }))
        })
    }
  }
  if (edit.start > binding.sourceRange.end) return binding
  // An empty parser-owned leaf has no text segments yet. Its collapsed source
  // position still anchors the first speculative insertion and subsequent keys.
  const sourceSegments =
    segments === undefined ||
    (segments.length === 0 &&
      binding.text.length === 0 &&
      binding.sourceRange.start === binding.sourceRange.end)
      ? [{ text: { start: 0, end: binding.text.length }, source: binding.sourceRange }]
      : segments
  const first = sourceSegments.find(
    (segment) => segment.source.start <= edit.start && edit.start <= segment.source.end
  )
  const last = sourceSegments.find(
    (segment) => segment.source.start <= edit.end && edit.end <= segment.source.end
  )
  if (first === undefined || last === undefined) return binding
  const textOffset = (
    segment: (typeof sourceSegments)[number],
    offset: number
  ): number | undefined => {
    if (offset === segment.source.start) return segment.text.start
    if (offset === segment.source.end) return segment.text.end
    return segment.text.end - segment.text.start === segment.source.end - segment.source.start
      ? segment.text.start + offset - segment.source.start
      : undefined
  }
  const sourceOffset = (segment: (typeof sourceSegments)[number], offset: number): number =>
    offset === segment.text.end
      ? segment.source.end
      : segment.source.start + offset - segment.text.start
  const start = textOffset(first, edit.start)
  const end = textOffset(last, edit.end)
  if (start === undefined || end === undefined) return binding
  const textDelta = edit.insert.length - (end - start)
  const nextSegments: { text: SourceRange; source: SourceRange }[] = []
  for (const segment of sourceSegments) {
    const beforeEnd = Math.min(segment.text.end, start)
    if (beforeEnd > segment.text.start) {
      nextSegments.push({
        text: { start: segment.text.start, end: beforeEnd },
        source: { start: segment.source.start, end: sourceOffset(segment, beforeEnd) }
      })
    }
  }
  if (edit.insert.length > 0) {
    nextSegments.push({
      text: { start, end: start + edit.insert.length },
      source: { start: edit.start, end: edit.start + edit.insert.length }
    })
  }
  for (const segment of sourceSegments) {
    const afterStart = Math.max(segment.text.start, end)
    if (segment.text.end > afterStart) {
      nextSegments.push({
        text: { start: afterStart + textDelta, end: segment.text.end + textDelta },
        source: {
          start: sourceOffset(segment, afterStart) + delta,
          end: segment.source.end + delta
        }
      })
    }
  }
  return {
    ...binding,
    text: binding.text.slice(0, start) + edit.insert + binding.text.slice(end),
    sourceRange: { start: binding.sourceRange.start, end: binding.sourceRange.end + delta },
    ...(segments === undefined ? {} : { segments: nextSegments })
  }
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
    change?.source === 'user' &&
    Array.isArray(change.op) &&
    change.op.length === 2 &&
    typeof change.op[0] === 'number' &&
    Array.isArray(change.prevDoc) &&
    Array.isArray(change.doc) &&
    change.doc.length === change.prevDoc.length + 1
  ) {
    const index = change.op[0]
    const descriptor = change.op[1] as { i?: { name?: string; text?: string } } | null
    const prior = bindings.find((item) => item.path.length === 2 && item.path[0] === index - 1)
    if (
      prior !== undefined &&
      descriptor !== null &&
      descriptor.i?.name === 'paragraph' &&
      descriptor.i.text === '' &&
      paragraphTextAt(change.doc, index) === '' &&
      change.prevDoc.every(
        (_, previousIndex) =>
          paragraphTextAt(change.prevDoc, previousIndex) ===
          paragraphTextAt(change.doc, previousIndex < index ? previousIndex : previousIndex + 1)
      )
    ) {
      const end = mappedMuyaSourceRange(prior, {
        start: prior.text.length,
        end: prior.text.length
      })?.end
      return end === undefined ? undefined : { start: end, end, insert: '\n\n' }
    }
  }
  if (
    change === undefined ||
    change.source !== 'user' ||
    !Array.isArray(change.op) ||
    change.op.length < 2 ||
    !Array.isArray(change.prevDoc) ||
    !Array.isArray(change.doc) ||
    change.prevDoc.length !== bindings.length ||
    change.doc.length !== change.prevDoc.length + change.op.length - 1
  ) { return undefined }

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
  if (binding === undefined || binding.path[0] !== index || binding.path[1] !== 'text') { return undefined }

  for (let previousIndex = 0; previousIndex < bindings.length; previousIndex += 1) {
    const previousBinding = bindings[previousIndex]
    if (
      previousBinding === undefined ||
      previousBinding.path[0] !== previousIndex ||
      previousBinding.path[1] !== 'text' ||
      paragraphTextAt(change.prevDoc, previousIndex) !== previousBinding.text
    ) { return undefined }
    if (
      previousIndex !== index &&
      paragraphTextAt(
        change.doc,
        previousIndex < index ? previousIndex : previousIndex + change.op.length - 1
      ) !== previousBinding.text
    ) { return undefined }
  }

  const nativeTextEdit = textEditAt(firstComponent, index)
  if (
    nativeTextEdit === undefined ||
    (nativeTextEdit.length !== 2 && nativeTextEdit.length !== 3)
  ) {
    return undefined
  }
  const leadingSkip = nativeTextEdit[0]
  if (typeof leadingSkip !== 'number') return undefined
  const prefixUnits = utf16UnitsOfCodePoints(binding.text, leadingSkip)
  if (prefixUnits === undefined) return undefined
  const suffix = binding.text.slice(prefixUnits)
  const deletion = nativeTextEdit.length === 3 ? nativeTextEdit[1] : undefined
  const firstInsert = nativeTextEdit.length === 3 ? nativeTextEdit[2] : nativeTextEdit[1]
  if (
    typeof firstInsert !== 'string' ||
    firstInsert.length === 0 ||
    (suffix.length === 0
      ? deletion !== undefined
      : deletion === null ||
        typeof deletion !== 'object' ||
        Object.keys(deletion).length !== 1 ||
        (deletion as { readonly d?: unknown }).d !== suffix) ||
    paragraphTextAt(change.doc, index) !== `${binding.text.slice(0, prefixUnits)}${firstInsert}`
  ) { return undefined }

  const insertedText = [firstInsert]
  for (let offset = 1; offset < change.op.length; offset += 1) {
    const insertionComponent = change.op[offset]
    if (
      !Array.isArray(insertionComponent) ||
      insertionComponent.length !== 2 ||
      insertionComponent[0] !== index + offset ||
      insertionComponent[1] === null ||
      typeof insertionComponent[1] !== 'object'
    ) { return undefined }
    const insertionDescriptor = insertionComponent[1] as {
      readonly i?: unknown
    }
    if (
      Object.keys(insertionDescriptor).length !== 1 ||
      insertionDescriptor.i === null ||
      typeof insertionDescriptor.i !== 'object'
    ) { return undefined }
    const insertedBlock = insertionDescriptor.i as {
      readonly name?: unknown
      readonly text?: unknown
    }
    if (
      insertedBlock.name !== 'paragraph' ||
      typeof insertedBlock.text !== 'string' ||
      paragraphTextAt(change.doc, index + offset) !== insertedBlock.text
    ) { return undefined }
    const isLast = offset === change.op.length - 1
    let contribution: string | undefined = insertedBlock.text
    if (isLast && suffix.length > 0) {
      contribution = insertedBlock.text.endsWith(suffix)
        ? insertedBlock.text.slice(0, -suffix.length)
        : undefined
    }
    if (contribution === undefined || contribution.length === 0) return undefined
    insertedText.push(contribution)
  }

  const position = mappedMuyaSourceRange(binding, { start: prefixUnits, end: prefixUnits })?.start
  if (position === undefined) return undefined
  return Object.freeze({
    start: position,
    end: position,
    insert: insertedText.join('\n\n')
  })
}

interface MuyaJsonChange {
  readonly op: unknown
  readonly source: unknown
  readonly prevDoc: unknown
  readonly doc: unknown
}

const unsupported = (
  reason: Extract<MuyaPlainTextSourceEditResult, { kind: 'unsupported' }>['reason']
): MuyaPlainTextSourceEditResult =>
  Object.freeze({
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

const paragraphTextAt = (state: unknown, index: number): string | undefined => {
  if (!Array.isArray(state)) return undefined
  const block: unknown = state[index]
  if (block === null || typeof block !== 'object') return undefined
  const candidate = block as { readonly name?: unknown; readonly text?: unknown }
  if (candidate.name !== 'paragraph' || typeof candidate.text !== 'string') {
    return undefined
  }
  return candidate.text
}

const textAtPath = (state: unknown, path: readonly (number | string)[]): string | undefined => {
  let value = state
  for (const key of path) {
    if (value === null || typeof value !== 'object') return undefined
    value = (value as Record<string | number, unknown>)[key]
  }
  return typeof value === 'string' ? value : undefined
}

const textEditAtPath = (
  operation: unknown,
  path: readonly (number | string)[]
): readonly unknown[] | undefined => {
  if (
    !Array.isArray(operation) ||
    operation.length !== path.length + 1 ||
    !path.every((key, index) => operation[index] === key)
  ) { return undefined }
  const component: unknown = operation.at(-1)
  if (component === null || typeof component !== 'object') return undefined
  const fields = Object.keys(component)
  if (fields.length !== 1 || fields[0] !== 'es') return undefined
  const edit = (component as { readonly es?: unknown }).es
  return Array.isArray(edit) ? edit : undefined
}

const textEditAt = (operation: unknown, blockIndex: number): readonly unknown[] | undefined => {
  if (
    !Array.isArray(operation) ||
    operation.length !== 3 ||
    operation[0] !== blockIndex ||
    operation[1] !== 'text'
  ) { return undefined }
  const component: unknown = operation[2]
  if (component === null || typeof component !== 'object') return undefined
  const fields = Object.keys(component)
  if (fields.length !== 1 || fields[0] !== 'es') return undefined
  const edit = (component as { readonly es?: unknown }).es
  return Array.isArray(edit) ? edit : undefined
}

const utf16UnitsOfCodePoints = (text: string, count: number): number | undefined => {
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
      fields.length !== 1 ||
      fields[0] !== 'd' ||
      typeof deletion !== 'string' ||
      deletion.length === 0 ||
      !remaining.startsWith(deletion)
    ) { return undefined }
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
  while (prefix < sharedLimit && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) { prefix += 1 }

  let suffix = 0
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous.charCodeAt(previous.length - suffix - 1) === next.charCodeAt(next.length - suffix - 1)
  ) { suffix += 1 }

  if (prefix === previous.length && prefix === next.length) return undefined
  return Object.freeze({
    start: sourceStart + prefix,
    end: sourceStart + previous.length - suffix,
    insert: next.slice(prefix, next.length - suffix)
  })
}

/** Validate source coordinates before native edits can be admitted. */
export function assertMuyaPlainTextSourceBinding(binding: MuyaPlainTextSourceBinding): void {
  validateMuyaSourceBinding(binding, false)
}

/** Model presentation may normalize owned text; native diff decoding may not. */
export function assertMuyaDocumentSourceBinding(binding: MuyaPlainTextSourceBinding): void {
  validateMuyaSourceBinding(binding, true)
}

function validateMuyaSourceBinding(
  binding: MuyaPlainTextSourceBinding,
  modelPresentation: boolean
): void {
  const blockIndex = binding.path[0]
  const field = binding.path.at(-1)
  const { start, end } = binding.sourceRange
  if (
    typeof blockIndex !== 'number' ||
    !Number.isSafeInteger(blockIndex) ||
    blockIndex < 0 ||
    field !== 'text' ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    (binding.segments === undefined && end - start !== binding.text.length)
  ) { throw new RangeError('Muya plain-text source binding is invalid') }
  const segments = binding.segments
  if (segments !== undefined) {
    let textEnd = 0
    let sourceEnd = start
    let normalizedTextIsOwned: ReturnType<typeof createMuyaNormalizedTextValidator> | undefined
    for (const segment of segments) {
      const normalizedNewline =
        segment.text.end - segment.text.start === 1 &&
        segment.source.end - segment.source.start === 2 &&
        binding.text[segment.text.start] === '\n'
      const removedNativeText = segment.source.start === segment.source.end
      const normalizedText =
        modelPresentation &&
        !normalizedNewline &&
        !removedNativeText &&
        segment.text.end - segment.text.start !== segment.source.end - segment.source.start &&
        (normalizedTextIsOwned ??= createMuyaNormalizedTextValidator(binding))(segment)
      if (
        segment.text.start !== textEnd ||
        segment.source.start < sourceEnd ||
        segment.text.end < segment.text.start ||
        segment.source.end < segment.source.start ||
        segment.source.end > end ||
        (!normalizedNewline &&
          !removedNativeText &&
          !normalizedText &&
          segment.text.end - segment.text.start !== segment.source.end - segment.source.start)
      ) {
        throw new RangeError('Muya source segments are invalid')
      }
      textEnd = segment.text.end
      sourceEnd = segment.source.end
    }
    if (textEnd !== binding.text.length) throw new RangeError('Muya source segments are incomplete')
  }
}

/**
 * Adapts one parser-bound top-level paragraph's native Muya text operation to
 * canonical UTF-16 coordinates. Other operation shapes remain fallback work.
 */
export function createMuyaPlainTextSourceEditAdapter(
  binding: MuyaPlainTextSourceBinding,
  semanticSelection = false
): MuyaPlainTextSourceEditAdapter {
  assertMuyaPlainTextSourceBinding(binding)
  let acceptedBinding = binding
  let acceptedText = binding.text
  let segments = binding.segments?.map((segment) => ({
    text: { ...segment.text },
    source: { ...segment.source }
  }))
  return Object.freeze({
    accept(changeValue: unknown): MuyaPlainTextSourceEditResult {
      const change = jsonChangeOf(changeValue)
      if (change === undefined || change.source !== 'user') {
        return unsupported('non-user-change')
      }
      const operation = textEditAtPath(change.op, binding.path)
      if (operation === undefined) {
        return unsupported('operation-shape')
      }
      const previous = textAtPath(change.prevDoc, binding.path)
      const next = textAtPath(change.doc, binding.path)
      if (previous === undefined || next === undefined) {
        return unsupported('block-shape')
      }
      if (previous !== acceptedText) return unsupported('binding-mismatch')
      if (applyNativeTextEdit(previous, operation) !== next) {
        return unsupported('operation-mismatch')
      }
      const local = changedTextEdit(0, previous, next)
      if (local === undefined) return unsupported('no-text-change')
      const map = {
        text: acceptedText,
        sourceRange: acceptedBinding.sourceRange,
        segments
      }
      const contiguous = mappedMuyaSourceRange(
        map,
        local,
        local.start === local.end ? acceptedBinding.insertionAffinity : undefined
      )
      const first =
        semanticSelection && contiguous === undefined
          ? mappedMuyaSourceRange(map, { start: local.start, end: local.start }, 'next')
          : undefined
      const last =
        semanticSelection && contiguous === undefined
          ? mappedMuyaSourceRange(map, { start: local.end, end: local.end }, 'previous')
          : undefined
      const source =
        contiguous ??
        (first !== undefined && last !== undefined
          ? { start: first.start, end: last.end }
          : undefined)
      if (source === undefined) return unsupported('operation-shape')
      const edit = Object.freeze({ ...source, insert: local.insert })
      acceptedBinding = advanceMuyaSourceBinding(acceptedBinding, edit)
      segments = acceptedBinding.segments?.map((segment) => ({
        text: { ...segment.text },
        source: { ...segment.source }
      }))
      acceptedText = next
      return Object.freeze({ kind: 'edit', edit })
    }
  })
}

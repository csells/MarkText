import deepEqual from 'deep-equal'
import { applyNativeOperation, serializeNativeState } from '@muyajs/core'
import type { DocumentSourceEdit } from '@marktext/document-core'
import type { MuyaPlainTextSourceBinding } from './muyaPlainTextSourceEdit'
import { sourceEditForMuyaContainerChange, sourceEditForMuyaUnwrappedList } from './muyaContainerSourceEdit'

const atPath = (root: unknown, path: readonly (string | number)[]): unknown =>
  path.reduce<unknown>((value, key) => value !== null && typeof value === 'object'
    ? (value as Record<string | number, unknown>)[key]
    : undefined, root)

/** Validate and budget native structure while its source bindings are in flight. */
export function nativeMuyaStructuralDraft(change: unknown, maximumUnits: number): DocumentSourceEdit | undefined {
  if (change === null || typeof change !== 'object') return undefined
  const { source, op, prevDoc, doc } = change as { source?: unknown, op?: unknown, prevDoc?: unknown, doc?: unknown }
  if (source !== 'user' || !Array.isArray(op) || !Array.isArray(prevDoc) || !Array.isArray(doc)) return undefined
  try {
    if (!deepEqual(applyNativeOperation(prevDoc, op), doc)) return undefined
    let first = 0
    while (first < prevDoc.length && first < doc.length && deepEqual(prevDoc[first], doc[first])) first += 1
    let oldEnd = prevDoc.length
    let newEnd = doc.length
    while (oldEnd > first && newEnd > first && deepEqual(prevDoc[oldEnd - 1], doc[newEnd - 1])) {
      oldEnd -= 1
      newEnd -= 1
    }
    if (first === oldEnd && first === newEnd) return undefined
    const insert = serializeNativeState(doc.slice(first, newEnd), { maximumUnits })
    // This local envelope accounts for queue admission only. The retained
    // operation is decoded against acknowledged bindings before submission.
    return insert === undefined ? undefined : { start: 0, end: 0, insert }
  } catch {
    return undefined
  }
}

const annotatedContainerPrefix = (
  bindings: readonly MuyaPlainTextSourceBinding[], index: number,
  previous: unknown, next: unknown, maximumUnits?: number
): DocumentSourceEdit | undefined => {
  const binding = bindings.find(item => item.path.length === 2 && item.path[0] === index && item.path[1] === 'text')
  if (binding?.annotationContext !== true || binding.paragraphPrefixPosition === undefined ||
      binding.text.length === 0) return undefined
  if (!deepEqual(previous, { name: 'paragraph', text: binding.text }) || next === null || typeof next !== 'object') return undefined
  const container = next as { name?: unknown, children?: unknown }
  if (!Array.isArray(container.children) || container.children.length !== 1) return undefined
  const quoted = container.name === 'block-quote' && deepEqual(container.children[0], previous)
  const listed = (container.name === 'bullet-list' || container.name === 'order-list') &&
    deepEqual(container.children[0], { name: 'list-item', children: [previous] })
  const tasked = container.name === 'task-list' && deepEqual(container.children[0], {
    name: 'task-list-item', meta: { checked: false }, children: [previous]
  })
  if (!quoted && !listed && !tasked) return undefined
  try {
    // Serialize the wrapper with a neutral leaf to obtain native prefix spelling.
    // Paragraph continuation lines can remain lazy, preserving annotation bytes
    // and original line endings across the entire unchanged paragraph.
    const leaf = { name: 'paragraph', text: 'content' }
    const wrapped = {
      ...container,
      children: quoted
        ? [leaf]
        : [
          { ...(container.children[0] as object), children: [leaf] }
        ]
    }
    const serialized = serializeNativeState([wrapped], { maximumUnits })
    const suffix = 'content\n'
    if (!serialized?.endsWith(suffix)) return undefined
    const prefix = serialized.slice(0, -suffix.length)
    if (prefix.length === 0 || prefix.includes('\n') || prefix.includes('\r')) return undefined
    // The native command wraps unchanged content. Insert its prefix before the
    // parser-owned paragraph boundary, leaving all annotation bytes intact.
    return { start: binding.paragraphPrefixPosition, end: binding.paragraphPrefixPosition, insert: prefix }
  } catch {
    return undefined
  }
}

/** Serialize only the native changed blocks, inside their parser-owned source envelope. */
export function sourceEditForMuyaStructuralChange(
  bindings: readonly MuyaPlainTextSourceBinding[], change: unknown, maximumUnits?: number
): DocumentSourceEdit | undefined {
  if (change === null || typeof change !== 'object') return undefined
  const { source, op, prevDoc, doc } = change as { source?: unknown, op?: unknown, prevDoc?: unknown, doc?: unknown }
  if (source !== 'user' || !Array.isArray(op) || op.length < 2 ||
      !Array.isArray(prevDoc) || !Array.isArray(doc)) return undefined
  try {
    if (!deepEqual(applyNativeOperation(prevDoc, op), doc)) return undefined
  } catch {
    return undefined
  }
  let first = 0
  while (first < prevDoc.length && first < doc.length && deepEqual(prevDoc[first], doc[first])) first += 1
  let oldEnd = prevDoc.length
  let newEnd = doc.length
  while (oldEnd > first && newEnd > first && deepEqual(prevDoc[oldEnd - 1], doc[newEnd - 1])) {
    oldEnd -= 1
    newEnd -= 1
  }
  if (oldEnd === first) {
    if (newEnd === first) return undefined
    const following = bindings.find(binding => binding.path[0] === first && binding.outerBlock)
    const preceding = first === prevDoc.length
      ? bindings.find(binding => binding.path[0] === first - 1 && binding.documentEnd)
      : undefined
    const boundary = following ?? preceding
    if (boundary === undefined || atPath(prevDoc, boundary.path) !== boundary.text) return undefined
    try {
      if (following?.outerBlock !== undefined && !following.annotationContext) {
        const owner = following.outerBlock
        const context = owner.source + (owner.followingSource ?? '')
        const generated = serializeNativeState(doc.slice(first, newEnd), { maximumUnits, sourceLineEndings: context })
        if (generated === undefined) return undefined
        const ending = context.match(/\r\n|\r|\n/u)?.[0] ?? '\n'
        const insert = generated.replace(/(?:\r\n|\r|\n)+$/u, '') + ending + ending
        return { start: owner.range.start, end: owner.range.start, insert }
      }
      const end = preceding?.documentEnd
      if (end === undefined) return undefined
      const generated = serializeNativeState(doc.slice(first, newEnd), { maximumUnits, sourceLineEndings: end.lineEnding })
      if (generated === undefined) return undefined
      const trailingLines = end.trailingLineEndings.replace(/\r\n|\r/g, '\n').length
      const insert = end.lineEnding.repeat(Math.max(0, 2 - trailingLines)) + generated
      return { start: end.offset, end: end.offset, insert }
    } catch {
      return undefined
    }
  }

  if (oldEnd === first + 1) {
    const owner = bindings.find(binding => binding.path[0] === first && binding.sourceStructure)?.sourceStructure
    if (owner !== undefined && bindings.some(binding => binding.path[0] === first && binding.annotationContext)) {
      const unwrapped = sourceEditForMuyaUnwrappedList(owner, prevDoc[first], doc.slice(first, newEnd))
      if (unwrapped !== undefined) return unwrapped
    }
  }
  if (oldEnd === first + 1 && newEnd === first + 1) {
    const containerOwner = bindings.find(binding => binding.path[0] === first && binding.sourceStructure)?.sourceStructure
    if (containerOwner !== undefined && bindings.some(binding => binding.path[0] === first && binding.annotationContext)) {
      const edit = sourceEditForMuyaContainerChange(containerOwner, prevDoc[first], doc[first], maximumUnits)
      if (edit !== undefined) return edit
    }
    const emptyLiteral = bindings.find(binding => binding.path[0] === first &&
      binding.emptyLiteralLineEnding !== undefined && binding.text === '' &&
      atPath(prevDoc, binding.path) === '')
    if (emptyLiteral !== undefined) {
      const text = atPath(doc, emptyLiteral.path)
      if (typeof text === 'string' && text.length > 0) {
        return { ...emptyLiteral.sourceRange, insert: text + emptyLiteral.emptyLiteralLineEnding }
      }
    }
    const textBinding = bindings.find(binding => binding.path.length === 2 && binding.path[0] === first && binding.path[1] === 'text')
    const heading = doc[first] as { name?: string, text?: string, meta?: { level?: number } }
    const level = heading?.meta?.level
    if (textBinding !== undefined && !textBinding.annotationContext &&
        atPath(prevDoc, textBinding.path) === textBinding.text &&
        heading?.name === 'atx-heading' && typeof heading.text === 'string' &&
        typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 6) {
      const marker = '#'.repeat(level)
      if (heading.text === marker || heading.text.startsWith(marker + ' ') || heading.text.startsWith(marker + '\t')) {
        // The native heading already contains its source prefix. Serializing an
        // empty heading adds whitespace and invalidates queued native offsets.
        return { ...textBinding.sourceRange, insert: heading.text }
      }
    }
    const prefix = annotatedContainerPrefix(bindings, first, prevDoc[first], doc[first], maximumUnits)
    if (prefix !== undefined) return prefix
    const leaf = bindings.find(binding => binding.path[0] === first && binding.containerPrefix !== undefined)
    if (leaf?.annotationContext && leaf.containerPrefix !== undefined &&
        atPath(prevDoc, leaf.path) === leaf.text && deepEqual(doc[first], { name: 'paragraph', text: leaf.text })) {
      return { ...leaf.containerPrefix.range, insert: '' }
    }
  }
  const owners = new Map<number, NonNullable<MuyaPlainTextSourceBinding['outerBlock']>>()
  for (const binding of bindings) {
    const index = binding.path[0]
    if (typeof index !== 'number' || index < first || index >= oldEnd) continue
    if (binding.annotationContext || atPath(prevDoc, binding.path) !== binding.text) return undefined
    if (binding.outerBlock !== undefined) owners.set(index, binding.outerBlock)
  }
  if (owners.size !== oldEnd - first) return undefined
  const start = owners.get(first)
  const end = owners.get(oldEnd - 1)
  if (start === undefined || end === undefined) return undefined
  try {
    if (newEnd === first) {
      const previous = bindings.find(binding => binding.path[0] === first - 1 && binding.outerBlock)?.outerBlock
      const following = bindings.find(binding => binding.path[0] === oldEnd && binding.outerBlock)?.outerBlock
      if (previous !== undefined && previous.followingSource?.length === start.range.start - previous.range.end) {
        return { start: previous.range.end, end: end.range.end, insert: '' }
      }
      if (following !== undefined && end.followingSource?.length === following.range.start - end.range.end) {
        return { start: start.range.start, end: following.range.start, insert: '' }
      }
      return { start: start.range.start, end: end.range.end, insert: '' }
    }
    // The editor's existing serializer owns list, fence, table and container
    // spelling. This consumes native state, never reparses projected Markdown.
    let originalSource = ''
    for (let index = first; index < oldEnd; index += 1) {
      const owner = owners.get(index)
      if (owner === undefined) return undefined
      originalSource += owner.source
      if (index + 1 < oldEnd) originalSource += owner.followingSource ?? ''
    }
    if (originalSource.length !== end.range.end - start.range.start) return undefined
    const generated = serializeNativeState(doc.slice(first, newEnd), {
      maximumUnits,
      sourceLineEndings: originalSource + (end.followingSource ?? '')
    })
    if (generated === undefined) return undefined
    // Native empty container children can serialize as whitespace beyond the
    // parser's last semantic node. That spelling belongs to the replaced
    // native block, rather than accumulating as new blank blocks on each edit.
    const previousSpelling = serializeNativeState(prevDoc.slice(first, oldEnd), {
      maximumUnits,
      sourceLineEndings: originalSource + (end.followingSource ?? '')
    })?.replace(/(?:\r\n|\r|\n)+$/u, '')
    let availableSource = originalSource + (end.followingSource ?? '')
    while (availableSource.length < (previousSpelling?.length ?? 0)) {
      const position = start.range.start + availableSource.length
      const next = bindings.find(binding => binding.outerBlock?.range.start === position)?.outerBlock
      const continuation = next === undefined ? '' : next.source + (next.followingSource ?? '')
      if (continuation.length === 0 || !/^[\t \r\n]*$/u.test(continuation)) break
      availableSource += continuation
    }
    const ownedEnd = previousSpelling !== undefined && previousSpelling.length > originalSource.length &&
      availableSource.startsWith(previousSpelling)
      ? start.range.start + previousSpelling.length
      : end.range.end
    const ending = ownedEnd === end.range.end ? end.source.match(/(?:\r\n|\r|\n)+$/u)?.[0] ?? '' : ''
    const insert = generated.replace(/(?:\r\n|\r|\n)+$/u, '') + ending
    return { start: start.range.start, end: ownedEnd, insert }
  } catch {
    return undefined
  }
}

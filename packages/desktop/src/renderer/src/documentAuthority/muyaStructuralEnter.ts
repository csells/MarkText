import deepEqual from 'deep-equal'
import type { DocumentSourceEdit } from '@marktext/document-core'
import type { MuyaPlainTextSourceBinding } from './muyaPlainTextSourceEdit'
import { nativeMuyaTextEdit } from './muyaPlainTextSourceEdit'

type StateNode = { name: string, text?: string, children?: StateNode[] }
const valueAt = (root: unknown, path: readonly (string | number)[]): unknown =>
  path.reduce<unknown>((value, key) => value !== null && typeof value === 'object'
    ? (value as Record<string | number, unknown>)[key]
    : undefined, root)

/** A native end-of-block Enter inserts a sibling without rewriting existing blocks. */
export function sourceEditForMuyaStructuralEnter(
  bindings: readonly MuyaPlainTextSourceBinding[], change: unknown
): { edit: DocumentSourceEdit, bindings: readonly MuyaPlainTextSourceBinding[] } | undefined {
  if (change === null || typeof change !== 'object') return undefined
  const { source, op, prevDoc, doc } = change as { source?: unknown, op?: unknown, prevDoc?: unknown, doc?: unknown }
  if (source !== 'user' || !Array.isArray(op) || op.length < 2 ||
      !Array.isArray(prevDoc) || !Array.isArray(doc)) return undefined
  const descriptorIndex = op.findIndex(part => part !== null && typeof part === 'object' && 'i' in part)
  if (descriptorIndex < 1) return undefined
  const descriptor = op[descriptorIndex]
  const index = op[descriptorIndex - 1]
  const containerPath = op.slice(0, descriptorIndex - 1)
  if (!Number.isSafeInteger(index) || index < 1 ||
      !containerPath.every(part => typeof part === 'string' || typeof part === 'number') ||
      descriptor === null || typeof descriptor !== 'object' || Object.keys(descriptor).join() !== 'i') return undefined
  const inserted = structuredClone(descriptor.i) as StateNode | undefined
  const listItem = inserted?.name === 'list-item' || inserted?.name === 'task-list-item'
  const empty = listItem ? inserted.children?.[0] : inserted
  if (empty?.name !== 'paragraph' || typeof empty.text !== 'string' ||
      (listItem && inserted.children?.length !== 1)) return undefined
  const previousSiblings = valueAt(prevDoc, containerPath)
  const nextSiblings = valueAt(doc, containerPath)
  if (!Array.isArray(previousSiblings) || !Array.isArray(nextSiblings) || index > previousSiblings.length) return undefined
  const previousName = (previousSiblings[index - 1] as StateNode | undefined)?.name
  if (listItem
    ? previousName !== 'list-item' && previousName !== 'task-list-item'
    : !['paragraph', 'atx-heading', 'setext-heading'].includes(previousName ?? '')) return undefined
  const expected = structuredClone(prevDoc)
  const expectedSiblings = valueAt(expected, containerPath)
  if (!Array.isArray(expectedSiblings)) return undefined
  expectedSiblings.splice(index, 0, inserted)
  const tail = op.slice(descriptorIndex + 1)
  if (tail.length > 0) {
    const textPath = listItem ? ['children', 0, 'text'] : ['text']
    if (!deepEqual(tail.slice(0, -1), textPath)) return undefined
    const target = [...containerPath, index, ...textPath]
    if (nativeMuyaTextEdit({ source, prevDoc: expected, doc, op: [...containerPath, index, ...tail] }) === undefined) return undefined
    const nextText = valueAt(doc, target)
    if (typeof nextText !== 'string') return undefined
    empty.text = nextText
  }
  if (!deepEqual(expected, doc)) return undefined
  const priorPath = [...containerPath, index - 1, ...(listItem ? ['children', 0] : []), 'text']
  const prior = bindings.find(binding => deepEqual(binding.path, priorPath))
  if (prior === undefined || prior.text.length === 0 ||
      (listItem && prior.listContinuation === undefined)) return undefined
  const suffix = (listItem ? prior.listContinuation!.lineEnding + prior.listContinuation!.prefix : '\n\n') + empty.text
  const edit = { start: prior.sourceRange.end, end: prior.sourceRange.end, insert: suffix }
  const shiftPath = (path: readonly (string | number)[]): readonly (string | number)[] => {
    const position = path[containerPath.length]
    if (containerPath.every((part, i) => path[i] === part) && typeof position === 'number' && position >= index) {
      return [...containerPath, position + 1, ...path.slice(containerPath.length + 1)]
    }
    return path
  }
  const nextBindings = bindings.map(binding => {
    if (binding === prior) return binding
    const shift = binding.sourceRange.start >= edit.start ? suffix.length : 0
    return {
      ...binding,
      path: shiftPath(binding.path),
      sourceRange: { start: binding.sourceRange.start + shift, end: binding.sourceRange.end + shift },
      ...(binding.segments === undefined
        ? {}
        : {
          segments: binding.segments.map(segment => ({
            ...segment, source: { start: segment.source.start + shift, end: segment.source.end + shift }
          }))
        })
    }
  })
  const newPath = [...containerPath, index, ...(listItem ? ['children', 0] : []), 'text']
  nextBindings.splice(bindings.indexOf(prior) + 1, 0, {
    path: newPath,
    text: empty.text,
    sourceRange: {
      start: edit.start + suffix.length - empty.text.length, end: edit.start + suffix.length
    },
    ...(prior.annotationContext ? { annotationContext: true as const } : {}),
    ...(listItem ? { listContinuation: prior.listContinuation } : {})
  })
  return { edit, bindings: nextBindings }
}

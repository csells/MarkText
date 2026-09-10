import type { DocumentSourceEdit } from '@marktext/document-core'
import { advanceMuyaSourceStructure } from './muyaContainerSourceEdit'
import deepEqual from 'deep-equal'
import { advanceMuyaDocumentEnd, type MuyaPlainTextSourceBinding } from './muyaPlainTextSourceEdit'

/** Keep pending native text coordinates while applying Core-authored source edits. */
export function reconcileMuyaNativeBindings(
  bindings: readonly MuyaPlainTextSourceBinding[],
  edits: readonly DocumentSourceEdit[]
): readonly MuyaPlainTextSourceBinding[] {
  if (edits.length === 0) return bindings
  const position = (offset: number, after: boolean): number =>
    offset +
    edits.reduce((delta, edit) => {
      if (offset < edit.start || (offset === edit.start && !after)) return delta
      const removed = offset >= edit.end ? edit.end - edit.start : offset - edit.start
      return delta + edit.insert.length - removed
    }, 0)
  return bindings.map((binding) => {
    const segments = binding.segments ?? [
      { text: { start: 0, end: binding.text.length }, source: binding.sourceRange }
    ]
    const mapped = segments.flatMap((segment) => {
      // A prior model deletion retains this native span's coordinates at its
      // exact source boundary until all queued input using them has settled.
      if (segment.source.start === segment.source.end) {
        const offset = position(segment.source.start, true)
        return [{ ...segment, source: { start: offset, end: offset } }]
      }
      const splits = [
        ...new Set([
          segment.source.start,
          ...edits
            .flatMap((edit) => [edit.start, edit.end])
            .filter((offset) => offset > segment.source.start && offset < segment.source.end),
          segment.source.end
        ])
      ].sort((left, right) => left - right)
      if (
        splits.length > 2 &&
        segment.source.end - segment.source.start !== segment.text.end - segment.text.start
      ) {
        throw new Error('Native reconciliation crosses a nonlinear text segment')
      }
      return splits.slice(0, -1).map((start, index) => {
        const end = splits[index + 1]
        return {
          text:
            splits.length === 2
              ? segment.text
              : {
                start: segment.text.start + start - segment.source.start,
                end: segment.text.start + end - segment.source.start
              },
          source: { start: position(start, true), end: position(end, false) }
        }
      })
    })
    const touched = edits.some(
      (edit) => edit.start <= binding.sourceRange.end && edit.end >= binding.sourceRange.start
    )
    const { outerBlock, containerPrefix, ...rest } = binding
    return {
      ...rest,
      ...(binding.sourceStructure === undefined
        ? {}
        : {
          sourceStructure: [...edits]
            .sort((left, right) => right.start - left.start)
            .reduce<
            MuyaPlainTextSourceBinding['sourceStructure']
          >((owner, edit) => (owner === undefined ? undefined : advanceMuyaSourceStructure(owner, edit)), binding.sourceStructure)
        }),
      ...(binding.documentEnd === undefined
        ? {}
        : {
          documentEnd: [...edits]
            .sort((left, right) => right.start - left.start)
            .reduce(advanceMuyaDocumentEnd, binding.documentEnd)
        }),
      sourceRange:
        mapped.length === 0
          ? {
            start: position(binding.sourceRange.start, true),
            end: position(binding.sourceRange.end, true)
          }
          : { start: mapped[0].source.start, end: mapped[mapped.length - 1].source.end },
      segments: mapped,
      insertionAffinity: 'next' as const,
      ...(binding.paragraphPrefixPosition === undefined
        ? {}
        : { paragraphPrefixPosition: position(binding.paragraphPrefixPosition, false) }),
      ...(touched
        ? { annotationContext: true as const }
        : {
          ...(outerBlock === undefined
            ? {}
            : {
              outerBlock: {
                ...outerBlock,
                range: {
                  start: position(outerBlock.range.start, true),
                  end: position(outerBlock.range.end, false)
                }
              }
            }),
          ...(containerPrefix === undefined
            ? {}
            : {
              containerPrefix: {
                ...containerPrefix,
                range: {
                  start: position(containerPrefix.range.start, true),
                  end: position(containerPrefix.range.end, false)
                }
              }
            })
        })
    }
  })
}

/** New native blocks use acknowledged owners; unchanged drafts keep their text domain. */
export function reconcileMuyaNativeStructureBindings(
  previous: readonly MuyaPlainTextSourceBinding[],
  acknowledged: readonly MuyaPlainTextSourceBinding[],
  change: unknown,
  edits: readonly DocumentSourceEdit[]
): readonly MuyaPlainTextSourceBinding[] {
  const { prevDoc, doc } = change as { prevDoc?: unknown; doc?: unknown }
  if (!Array.isArray(prevDoc) || !Array.isArray(doc)) { throw new Error('Native structural acknowledgement lacks document topology') }
  let first = 0
  while (first < prevDoc.length && first < doc.length && deepEqual(prevDoc[first], doc[first])) { first += 1 }
  let oldEnd = prevDoc.length
  let newEnd = doc.length
  while (oldEnd > first && newEnd > first && deepEqual(prevDoc[oldEnd - 1], doc[newEnd - 1])) {
    oldEnd -= 1
    newEnd -= 1
  }
  const atPath = (path: readonly (string | number)[]): unknown =>
    path.reduce<unknown>(
      (value, key) =>
        value !== null && typeof value === 'object'
          ? (value as Record<string | number, unknown>)[key]
          : undefined,
      doc
    )
  const position = (offset: number, after: boolean): number =>
    offset +
    edits.reduce(
      (delta, edit) =>
        delta +
        (edit.end < offset || (edit.end === offset && (edit.start < edit.end || after))
          ? edit.insert.length - (edit.end - edit.start)
          : 0),
      0
    )
  const range = (
    source: MuyaPlainTextSourceBinding['sourceRange']
  ): MuyaPlainTextSourceBinding['sourceRange'] => ({
    start: position(source.start, true),
    end: position(source.end, false)
  })
  const retained = new Map<string, MuyaPlainTextSourceBinding>()
  for (const binding of previous) {
    const root = binding.path[0]
    if (typeof root !== 'number' || (root >= first && root < oldEnd)) continue
    const path = [root >= oldEnd ? root + newEnd - oldEnd : root, ...binding.path.slice(1)]
    if (atPath(path) !== binding.text) continue
    // Structural siblings change source offsets, never the retained leaf text.
    if (
      edits.some(
        (edit) => edit.start < binding.sourceRange.end && edit.end > binding.sourceRange.start
      )
    ) {
      throw new Error('Native structural acknowledgement overlaps an unchanged pending leaf')
    }
    const { outerBlock: _outer, containerPrefix: _prefix, documentEnd: _end, ...rest } = binding
    retained.set(JSON.stringify(path), {
      ...rest,
      path,
      sourceRange: range(binding.sourceRange),
      ...(binding.segments === undefined
        ? {}
        : {
          segments: binding.segments.map((segment) => ({
            ...segment,
            source: range(segment.source)
          }))
        }),
      ...(binding.paragraphPrefixPosition === undefined
        ? {}
        : { paragraphPrefixPosition: position(binding.paragraphPrefixPosition, true) })
    })
  }
  return acknowledged.map((binding) => {
    if (atPath(binding.path) === binding.text) return binding
    const native = retained.get(JSON.stringify(binding.path))
    if (native === undefined) { throw new Error('Native structural acknowledgement cannot identify a pending leaf') }
    const { documentEnd: _previousEnd, sourceStructure: _previousStructure, ...rest } = native
    return {
      ...rest,
      ...(binding.documentEnd === undefined ? {} : { documentEnd: binding.documentEnd }),
      ...(binding.sourceStructure === undefined ? {} : { sourceStructure: binding.sourceStructure })
    }
  })
}

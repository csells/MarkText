import type { MuyaSourceStructure } from './muyaMarkupView'
import type { DocumentSourceEdit } from '@marktext/document-core'

export type MuyaStructuralSourceEdit = DocumentSourceEdit &
  Readonly<{
    structuralEdits?: readonly DocumentSourceEdit[]
  }>

export const muyaSourceEdits = (edit: DocumentSourceEdit): readonly DocumentSourceEdit[] =>
  (edit as MuyaStructuralSourceEdit).structuralEdits ?? [edit]

export function advanceMuyaSourceStructure(
  owner: MuyaSourceStructure,
  edit: DocumentSourceEdit
): MuyaSourceStructure | undefined {
  const delta = edit.insert.length - (edit.end - edit.start)
  const shiftRange = (range: MuyaSourceStructure['range']): MuyaSourceStructure['range'] => ({
    start: range.start + (edit.end <= range.start && edit.start < range.start ? delta : 0),
    end: range.end + (edit.start <= range.end ? delta : 0)
  })
  if (edit.start > owner.range.end) return owner
  if (
    (edit.start < owner.range.start && edit.end > owner.range.start) ||
    (edit.start < owner.range.end && edit.end > owner.range.end)
  ) { return undefined }
  const source =
    edit.end <= owner.range.start && edit.start < owner.range.start
      ? owner.source
      : owner.source.slice(0, edit.start - owner.range.start) +
        edit.insert +
        owner.source.slice(edit.end - owner.range.start)
  return {
    range: shiftRange(owner.range),
    source,
    nodes: owner.nodes.map((node) => ({
      ...node,
      range: shiftRange(node.range),
      ...(node.lineStarts === undefined
        ? {}
        : {
          lineStarts: node.lineStarts.map((offset) => offset + (edit.end <= offset ? delta : 0))
        }),
      ...(node.delimiterRange === undefined
        ? {}
        : { delimiterRange: shiftRange(node.delimiterRange) })
    }))
  }
}

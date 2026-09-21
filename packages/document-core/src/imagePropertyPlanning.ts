import { rebaseModelTextPoint } from './modelText.js'
import { inputSourceRange, type DocumentInputSelection } from './inputPlanning.js'
import { resolveTableCell, tableCellSelectionAfter } from './tableSelection.js'
import { encodeImageSrc, encodeImageInsertionSrc, type ImagePropertyPatch } from '@marktext/input-policy'
import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, ProjectionCoordinateMap, SourceRange } from './documentCore.js'
import { positionAfter } from './sourcePosition.js'
import { createTrackedSourceEdit } from './trackedAuthoring.js'
import { createMarkupCompoundSourceEdits } from './markupEditing.js'
import { isImageSizeValue } from './internal/profile1/imageSizeAttributes.js'
import { markupAnnotations } from './markupEditOwnership.js'

export interface DocumentImagePropertiesAction {
  readonly format: 'image-properties'
  readonly selection: SourceRange
  readonly tracked: boolean
  readonly properties: ImagePropertyPatch
  readonly currentSelection?: DocumentInputSelection
}

/** The same parser-owned image label value used by native image rendering. */
export const imageAltText = (node: MarkdownAstNode): string =>
  (node.kind === 'inline-html' || node.kind === 'html-block') && node.attributes.tagName === 'img'
    ? String(node.attributes.semanticAlt ?? '')
    : node.kind === 'text'
      ? String(node.attributes.semanticText ?? '')
      : node.kind === 'inline-code'
        ? String(node.attributes.semanticContent ?? '')
        : node.kind === 'soft-break' || node.kind === 'hard-break'
          ? '\n'
          : node.children.map(imageAltText).join('')

export const imageDestination = (value: string): string => encodeImageInsertionSrc(value)
  .replace(/\(/g, '%28').replace(/\)/g, '%29')
  .replace(/&/g, '&amp;').replace(/\\/g, '\\\\').replace(/[<>\r\n\t]/g, char => encodeURIComponent(char))
export const imageLabel = (value: string): string => value.replace(/&/g, '&amp;').replace(/[\\`*_[\]{}<>~$]/g, char => `\\${char}`).replace(/\r/g, '&#13;').replace(/\n/g, '&#10;')
const imageTitle = (value: string, close: string): string => value.replace(/&/g, '&amp;').split('')
  .map(char => char === '\\' || char === close || close === ')' && char === '(' ? `\\${char}` : char).join('')

const escapeHtmlAttribute = (value: string, quote = '"'): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(quote === "'" ? /'/g : /"/g, quote === "'" ? '&#39;' : '&quot;')

const imagePropertyKeys = { src: 'semanticDestination', alt: 'semanticAlt', title: 'semanticTitle', width: 'semanticWidth', height: 'semanticHeight', 'data-align': 'semanticAlign' } as const
const layoutKeys = ['width', 'height', 'data-align'] as const

function markdownImageSizeEdits(previous: DocumentRevision, image: MarkdownAstNode, properties: ImagePropertyPatch, coordinates: ProjectionCoordinateMap): DocumentSourceEdit[] {
  const changes = layoutKeys.filter(name => properties[name] !== undefined && properties[name] !== (image.attributes[imagePropertyKeys[name]] ?? ''))
  if (changes.length === 0) return []
  for (const name of changes) {
    const value = properties[name]!
    if (value !== '' && !isImageSizeValue(name, value)) throw new RangeError(`Invalid Markdown image ${name}`)
  }
  const sizeStart = image.attributes.sizeStart
  const sizeEnd = image.attributes.sizeEnd
  const remaining = layoutKeys.filter(name => (properties[name] ?? image.attributes[imagePropertyKeys[name]] ?? '') !== '')
  const inactiveArms = markupAnnotations(previous.annotations).flatMap(annotation => annotation.arms.flatMap(arm =>
    annotation.kind === 'deletion' || annotation.kind === 'substitution' && arm.name === 'old'
      ? [{ annotation, arm }]
      : []))
  if (typeof sizeStart === 'number' && typeof sizeEnd === 'number' && remaining.length > 0) {
    const start = coordinates.toSource(sizeStart, 'next')
    const end = coordinates.toSource(sizeEnd, 'previous')
    const removedSize = inactiveArms.find(({ arm }) => arm.range.start <= start && end <= arm.range.end && arm.range.start >= coordinates.toSource(Number(image.attributes.imageSyntaxEnd), 'previous'))
    if (removedSize !== undefined) {
      const fields = remaining.map(name => `${name}=${properties[name] ?? image.attributes[imagePropertyKeys[name]]}`)
      const point = removedSize.annotation.range.end
      return [{ start: point, end: point, insert: `{${fields.join(' ')}}` }]
    }
  }
  if (remaining.length === 0 && typeof sizeStart === 'number' && typeof sizeEnd === 'number') {
    return [{ start: coordinates.toSource(sizeStart, 'next'), end: coordinates.toSource(sizeEnd, 'previous'), insert: '' }]
  }
  const edits: DocumentSourceEdit[] = []
  const added: string[] = []
  for (const name of changes) {
    const value = properties[name]!
    const attributeStart = image.attributes[`${name}AttributeStart`]
    const attributeEnd = image.attributes[`${name}AttributeEnd`]
    const valueStart = image.attributes[`${name}ValueStart`]
    const valueEnd = image.attributes[`${name}ValueEnd`]
    const removedAttribute = typeof attributeStart === 'number' && typeof attributeEnd === 'number'
      ? inactiveArms.find(({ arm }) => arm.range.start <= coordinates.toSource(attributeStart, 'next') && coordinates.toSource(attributeEnd, 'previous') <= arm.range.end)
      : undefined
    if (value !== '' && removedAttribute !== undefined) {
      edits.push({ ...removedAttribute.annotation.range, insert: `${name}=${value}` })
      continue
    }
    if (value === '' && typeof attributeStart === 'number' && typeof attributeEnd === 'number') {
      edits.push({ start: coordinates.toSource(attributeStart, 'next'), end: coordinates.toSource(attributeEnd, 'next'), insert: '' })
    } else if (typeof valueStart === 'number' && typeof valueEnd === 'number') {
      const start = coordinates.toSource(valueStart, 'next')
      const end = coordinates.toSource(valueEnd, 'previous')
      const removedValue = image.attributes[imagePropertyKeys[name]] === ''
        ? inactiveArms.find(({ arm }) => arm.range.start <= end && end <= arm.range.end)
        : undefined
      const point = removedValue?.annotation.range.end
      edits.push(point === undefined ? { start, end, insert: value } : { start: point, end: point, insert: value })
    } else if (value !== '') added.push(`${name}=${value}`)
  }
  if (added.length > 0) {
    for (const name of layoutKeys) {
      if (properties[name] !== undefined || image.attributes[imagePropertyKeys[name]] !== '') continue
      const start = image.attributes[`${name}AttributeStart`]
      const end = image.attributes[`${name}AttributeEnd`]
      if (typeof start === 'number' && typeof end === 'number') {
        edits.push({ start: coordinates.toSource(start, 'next'), end: coordinates.toSource(end, 'next'), insert: '' })
      }
    }
    const point = typeof sizeEnd === 'number' ? sizeEnd - 1 : Number(image.attributes.imageSyntaxEnd)
    const offset = coordinates.toSource(point, typeof sizeEnd === 'number' ? 'next' : 'previous')
    edits.push({ start: offset, end: offset, insert: typeof sizeEnd === 'number' ? ` ${added.join(' ')}` : `{${added.join(' ')}}` })
  }
  return edits
}

function htmlImageEdits(core: DocumentCore, previous: DocumentRevision, image: MarkdownAstNode, properties: DocumentImagePropertiesAction['properties'], coordinates: ProjectionCoordinateMap): DocumentSourceEdit[] {
  const edits: DocumentSourceEdit[] = []
  let added = ''
  for (const name of Object.keys(properties) as Array<keyof ImagePropertyPatch>) {
    const requested = properties[name]
    if (requested === undefined || requested === image.attributes[imagePropertyKeys[name]]) continue
    const value = name === 'src' ? encodeImageSrc(requested) : requested
    const attributeStart = image.attributes[`${name}AttributeStart`]
    const attributeEnd = image.attributes[`${name}AttributeEnd`]
    const valueStart = image.attributes[`${name}ValueStart`]
    const valueEnd = image.attributes[`${name}ValueEnd`]
    const quote = String(image.attributes[`${name}Quote`] ?? '')
    if (typeof valueStart === 'number' && typeof valueEnd === 'number') {
      const insert = quote === '' ? `"${escapeHtmlAttribute(value, '"')}"` : escapeHtmlAttribute(value, quote)
      edits.push({ start: coordinates.toSource(valueStart, 'next'), end: coordinates.toSource(valueEnd, 'previous'), insert })
    } else if (typeof attributeStart === 'number' && typeof attributeEnd === 'number') {
      const start = coordinates.toSource(attributeStart, 'next')
      const end = coordinates.toSource(attributeEnd, 'previous')
      edits.push({ start, end, insert: `${core.sourceSlice(previous, { start, end })}="${escapeHtmlAttribute(value, '"')}"` })
    } else added += ` ${name}="${escapeHtmlAttribute(value, '"')}"`
  }
  if (edits.length > 0 || added !== '') {
    const tagCloseStart = image.attributes.tagCloseStart
    if (typeof tagCloseStart !== 'number') throw new RangeError('HTML image has no owned closing delimiter')
    if (image.attributes.selfClosing !== true) added += ' /'
    if (added !== '') {
      const point = coordinates.toSource(tagCloseStart, 'previous')
      edits.push({ start: point, end: point, insert: added })
    }
  }
  return edits
}

export function planImageProperties(
  core: DocumentCore,
  previous: DocumentRevision,
  action: DocumentImagePropertiesAction,
  preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision,
  previewSyntax: (edits: readonly DocumentSourceEdit[]) => MarkupSyntax
): Readonly<{ edits: readonly DocumentSourceEdit[]; selection: DocumentInputSelection }> {
  const { selection } = action
  if (Object.entries(action.properties).some(([key, value]) => !Object.hasOwn(imagePropertyKeys, key) || typeof value !== 'string')) {
    throw new TypeError('Image properties must be text')
  }
  if (!Number.isSafeInteger(selection.start) || !Number.isSafeInteger(selection.end) ||
      selection.start < 0 || selection.end < selection.start || selection.end > previous.sourceLength) {
    throw new RangeError('Image selection is outside the current document')
  }
  const { syntax } = core.project(previous, 'markup')
  const { coordinates } = syntax
  let image: MarkdownAstNode | undefined
  const visit = (node: MarkdownAstNode): void => {
    const html = (node.kind === 'inline-html' || node.kind === 'html-block') && node.attributes.tagName === 'img' && node.attributes.closingTag !== true
    const start = html && typeof node.attributes.tagStart === 'number' ? node.attributes.tagStart : node.range.start
    const end = html && typeof node.attributes.tagEnd === 'number' ? node.attributes.tagEnd : node.range.end
    if ((node.kind === 'image' || html) && coordinates.toSource(start, 'next') === selection.start &&
        coordinates.toSource(end, 'previous') === selection.end) image = node
    for (const child of node.children) visit(child)
  }
  visit(syntax.ast.root)
  if (image === undefined) throw new RangeError('Image properties require an exact owned image')
  const properties = {
    alt: imageAltText(image),
    src: String(image.attributes.semanticDestination ?? ''),
    title: String(image.attributes.semanticTitle ?? ''),
    ...action.properties
  }
  const html = image.kind !== 'image'
  const imageSyntaxEnd = Number(image.attributes.imageSyntaxEnd ?? image.range.end)
  const edits: DocumentSourceEdit[] = html ? htmlImageEdits(core, previous, image, action.properties, coordinates) : []
  if (!html) {
    const layout = markdownImageSizeEdits(previous, image, action.properties, coordinates)
    const compiledLayout = action.tracked ? layout : createMarkupCompoundSourceEdits(core, previous, layout, preview, true)
    if (compiledLayout === undefined) throw new RangeError('Image layout cannot preserve its source annotations')
    edits.push(...compiledLayout)
    const destinationStart = image.attributes.destinationStart
    const destinationEnd = image.attributes.destinationEnd
    const reference = typeof image.attributes.referenceLabel === 'string'
    if (!reference && (typeof destinationStart !== 'number' || typeof destinationEnd !== 'number')) {
      throw new RangeError('Image destination has no owned inline source range')
    }
    if (reference && (properties.src !== image.attributes.semanticDestination || properties.title !== (image.attributes.semanticTitle ?? ''))) {
      const labelEnd = image.attributes.labelEnd
      if (typeof labelEnd !== 'number') throw new RangeError('Reference image label has no owned source range')
      const suffix = `(${imageDestination(properties.src)}${properties.title === '' ? '' : ` "${imageTitle(properties.title, '"')}"`})`
      edits.push({ start: coordinates.toSource(labelEnd + 1, 'previous'), end: coordinates.toSource(imageSyntaxEnd, 'previous'), insert: suffix })
    } else if (reference && properties.alt !== imageAltText(image) && image.attributes.referenceKind !== 'full') {
      const labelEnd = image.attributes.labelEnd
      const referenceLabel = image.attributes.rawReferenceLabel
      if (typeof labelEnd !== 'number' || typeof referenceLabel !== 'string') throw new RangeError('Implicit image reference has no owned label spelling')
      edits.push({ start: coordinates.toSource(labelEnd + 1, 'previous'), end: coordinates.toSource(imageSyntaxEnd, 'previous'), insert: `[${referenceLabel}]` })
    } else if (!reference && properties.src !== image.attributes.semanticDestination) {
      if (typeof destinationStart !== 'number' || typeof destinationEnd !== 'number') throw new RangeError('Image destination has no owned inline source range')
      edits.push({ start: coordinates.toSource(destinationStart, 'next'), end: coordinates.toSource(destinationEnd, 'previous'), insert: imageDestination(properties.src) })
    }
    if (properties.alt !== imageAltText(image)) {
      const labelStart = image.attributes.labelStart
      const labelEnd = image.attributes.labelEnd
      if (typeof labelStart !== 'number' || typeof labelEnd !== 'number') throw new RangeError('Image label has no owned source range')
      const insert = imageLabel(properties.alt)
      const labelEdits = createMarkupCompoundSourceEdits(core, previous, [{ start: coordinates.toSource(labelStart, 'next'), end: coordinates.toSource(labelEnd, 'previous'), insert }], preview, true)
      if (labelEdits === undefined) throw new RangeError('Image alt replacement cannot preserve this label')
      edits.push(...labelEdits)
    }
    if (!reference && properties.title !== (image.attributes.semanticTitle ?? '')) {
      const titleStart = image.attributes.titleStart
      const titleEnd = image.attributes.titleEnd
      if (typeof titleStart === 'number' && typeof titleEnd === 'number') {
        if (properties.title === '') {
          const destinationSyntaxEnd = image.attributes.destinationSyntaxEnd
          if (typeof destinationSyntaxEnd !== 'number') throw new RangeError('Image title separator has no owned range')
          edits.push({ start: coordinates.toSource(destinationSyntaxEnd, 'next'), end: coordinates.toSource(titleEnd + 1, 'previous'), insert: '' })
        } else {
          const closer = core.sourceSlice(previous, { start: coordinates.toSource(titleEnd, 'next'), end: coordinates.toSource(titleEnd + 1, 'previous') })
          edits.push({ start: coordinates.toSource(titleStart, 'next'), end: coordinates.toSource(titleEnd, 'previous'), insert: imageTitle(properties.title, closer) })
        }
      } else {
        const point = coordinates.toSource(imageSyntaxEnd - 1, 'previous')
        edits.push({ start: point, end: point, insert: ` "${imageTitle(properties.title, '"')}"` })
      }
    }
  }
  edits.sort((left, right) => left.start - right.start || left.end - right.end)
  let authored: readonly DocumentSourceEdit[] = edits
  const editedEnd = Math.max(selection.end, ...edits.map(edit => edit.end))
  let caret = positionAfter(edits, editedEnd, true)
  const layoutOnly = !html && edits.every(edit => edit.start >= coordinates.toSource(imageSyntaxEnd, 'previous'))
  if (action.tracked && edits.length > 0 && layoutOnly) {
    const attributes = image.attributes
    const inactiveField = layoutKeys.some(name => action.properties[name] !== undefined && attributes[imagePropertyKeys[name]] === '')
    if (edits.length > 1 || inactiveField && edits.some(edit => edit.start < edit.end)) {
      // Shared suggestion boundaries can make separately tracked field edits
      // overlap. One owned suffix operation leaves image-label review outside it.
      const ordinary = createMarkupCompoundSourceEdits(core, previous, edits, preview, true)
      if (ordinary === undefined) throw new RangeError('Image layout cannot preserve its source annotations')
      const range = {
        start: Math.min(coordinates.toSource(Number(image.attributes.sizeStart ?? imageSyntaxEnd), 'next'), ...ordinary.map(edit => edit.start)),
        end: Math.max(coordinates.toSource(Number(image.attributes.sizeEnd ?? imageSyntaxEnd), 'previous'), ...ordinary.map(edit => edit.end))
      }
      let insert = core.sourceSlice(previous, range)
      for (const edit of [...ordinary].reverse()) insert = insert.slice(0, edit.start - range.start) + edit.insert + insert.slice(edit.end - range.start)
      const tracked = createTrackedSourceEdit(core, previous, { ...range, insert }, preview, true)
      if (tracked === undefined) throw new RangeError('Image layout cannot preserve its tracked source')
      authored = [tracked]
    } else {
      authored = edits.map(edit => {
        const tracked = createTrackedSourceEdit(core, previous, edit, preview, true)
        if (tracked === undefined) throw new RangeError('Image layout cannot preserve its tracked source')
        return tracked
      })
    }
    caret = positionAfter(authored, editedEnd, true)
  } else if (action.tracked && edits.length > 0) {
    let insert = core.sourceSlice(previous, selection)
    for (const edit of [...edits].reverse()) insert = insert.slice(0, edit.start - selection.start) + edit.insert + insert.slice(edit.end - selection.start)
    const tracked = createTrackedSourceEdit(core, previous, { ...selection, insert }, preview, true)
    if (tracked === undefined) throw new RangeError('Image properties cannot preserve this tracked image')
    authored = [tracked]
    if (tracked.start === selection.start && tracked.end === selection.end && tracked.insert === insert) caret = tracked.start + insert.length
    else {
      const candidate = preview(authored)
      const pending = [...candidate.annotations]
      let newImageEnd: number | undefined
      while (pending.length > 0) {
        const annotation = pending.pop()
        if (annotation === undefined) break
        for (const arm of annotation.arms) {
          if (arm.name === 'new' && arm.range.start >= tracked.start && arm.range.end <= tracked.start + tracked.insert.length &&
              candidate.source.slice(arm.range.start, arm.range.end) === insert) newImageEnd = arm.range.end
          pending.push(...arm.annotations)
        }
      }
      if (newImageEnd === undefined) throw new RangeError('Tracked image properties have no proven resulting selection')
      caret = newImageEnd
    }
  }
  let nextSelection: DocumentInputSelection = { ranges: [{ anchor: caret, focus: caret }], primary: 0 }
  if (action.currentSelection !== undefined) {
    const current = action.currentSelection
    const range = inputSourceRange(core, previous, current)
    if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start || range.end > previous.sourceLength) {
      throw new RangeError('Current image selection is outside the document')
    }
    if ('ranges' in current) {
      if (range.start !== selection.start || range.end !== selection.end) {
        nextSelection = { ...current, ranges: current.ranges.map(range => ({ anchor: positionAfter(authored, range.anchor, true), focus: positionAfter(authored, range.focus, true) })) }
      }
    } else if (current.kind === 'model-text') {
      nextSelection = { kind: 'model-text', anchor: rebaseModelTextPoint(current.anchor, authored), focus: rebaseModelTextPoint(current.focus, authored) }
    } else {
      const cell = resolveTableCell(core, previous, current.cell)
      nextSelection = tableCellSelectionAfter(previewSyntax(authored), previous.sourceLength + authored.reduce((sum, edit) => sum + edit.insert.length - (edit.end - edit.start), 0), authored, current,
        cell.slotStart === undefined ? undefined : positionAfter(authored, cell.start + current.anchor, true),
        cell.slotStart === undefined ? undefined : positionAfter(authored, cell.start + current.focus, true))
    }
  }
  return { edits: authored, selection: nextSelection }
}

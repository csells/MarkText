import { rebaseModelTextPoint } from './modelText.js'
import { inputSourceRange, type DocumentInputSelection } from './inputPlanning.js'
import { resolveTableCell, tableCellSelectionAfter } from './tableSelection.js'
import { encodeImageSrc, type ImagePropertyPatch } from '@marktext/input-policy'
import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, ProjectionCoordinateMap, SourceRange } from './documentCore.js'
import { positionAfter } from './sourcePosition.js'
import { createTrackedSourceEdit } from './trackedAuthoring.js'
import { createMarkupCompoundSourceEdits } from './markupEditing.js'

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

const imageDestination = (value: string): string => encodeImageSrc(value)
  .replace(/&/g, '&amp;').replace(/\\/g, '\\\\').replace(/[<>\r\n\t]/g, char => encodeURIComponent(char))
const imageTitle = (value: string, close: string): string => value.replace(/&/g, '&amp;').split('')
  .map(char => char === '\\' || char === close || close === ')' && char === '(' ? `\\${char}` : char).join('')

const escapeHtmlAttribute = (value: string, quote = '"'): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(quote === "'" ? /'/g : /"/g, quote === "'" ? '&#39;' : '&quot;')

const imagePropertyKeys = { src: 'semanticDestination', alt: 'semanticAlt', title: 'semanticTitle', width: 'semanticWidth', height: 'semanticHeight', 'data-align': 'semanticAlign' } as const

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
  const dimensions = ['width', 'height', 'data-align'] as const
  const needsHtml = !html && dimensions.some(key => Object.hasOwn(action.properties, key))
  const edits: DocumentSourceEdit[] = html ? htmlImageEdits(core, previous, image, action.properties, coordinates) : []
  if (needsHtml) {
    const pending = [...previous.annotations]
    while (pending.length > 0) {
      const annotation = pending.pop()!
      if (annotation.range.start >= selection.start && annotation.range.end <= selection.end) {
        throw new RangeError('Image dimensions cannot yet preserve CriticMarkup inside the image label')
      }
      for (const arm of annotation.arms) pending.push(...arm.annotations)
    }
    let insert = `<img src="${escapeHtmlAttribute(encodeImageSrc(properties.src))}" alt="${escapeHtmlAttribute(properties.alt)}"`
    if (properties.title !== '') insert += ` title="${escapeHtmlAttribute(properties.title)}"`
    for (const name of dimensions) {
      const value = properties[name]
      if (value !== undefined) insert += ` ${name}="${escapeHtmlAttribute(value)}"`
    }
    edits.push({ ...selection, insert: `${insert} />` })
  } else if (!html) {
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
      edits.push({ start: coordinates.toSource(labelEnd + 1, 'previous'), end: selection.end, insert: suffix })
    } else if (reference && properties.alt !== imageAltText(image) && image.attributes.referenceKind !== 'full') {
      const labelEnd = image.attributes.labelEnd
      const referenceLabel = image.attributes.rawReferenceLabel
      if (typeof labelEnd !== 'number' || typeof referenceLabel !== 'string') throw new RangeError('Implicit image reference has no owned label spelling')
      edits.push({ start: coordinates.toSource(labelEnd + 1, 'previous'), end: selection.end, insert: `[${referenceLabel}]` })
    } else if (!reference && properties.src !== image.attributes.semanticDestination) {
      if (typeof destinationStart !== 'number' || typeof destinationEnd !== 'number') throw new RangeError('Image destination has no owned inline source range')
      edits.push({ start: coordinates.toSource(destinationStart, 'next'), end: coordinates.toSource(destinationEnd, 'previous'), insert: imageDestination(properties.src) })
    }
    if (properties.alt !== imageAltText(image)) {
      const labelStart = image.attributes.labelStart
      const labelEnd = image.attributes.labelEnd
      if (typeof labelStart !== 'number' || typeof labelEnd !== 'number') throw new RangeError('Image label has no owned source range')
      const insert = properties.alt.replace(/&/g, '&amp;').replace(/[\\`*_[\]{}<>~$]/g, value => `\\${value}`).replace(/\r/g, '&#13;').replace(/\n/g, '&#10;')
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
        const point = coordinates.toSource(image.range.end - 1, 'previous')
        edits.push({ start: point, end: point, insert: ` "${imageTitle(properties.title, '"')}"` })
      }
    }
  }
  edits.sort((left, right) => left.start - right.start || left.end - right.end)
  let authored: readonly DocumentSourceEdit[] = edits
  let caret = positionAfter(edits, selection.end, true)
  if (action.tracked && edits.length > 0) {
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

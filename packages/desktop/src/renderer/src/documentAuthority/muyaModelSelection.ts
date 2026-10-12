import { documentActiveFormats } from '@marktext/document-core'
import isEqual from 'lodash/isEqual'
import { firstGraphemeLength } from '@muyajs/core'
import type {
  DocumentClipboardInput,
  DocumentDOMPoint,
  DocumentFormatInput,
  DocumentTextInput,
  DocumentInput,
  DocumentEditing,
  Muya
} from '@muyajs/core'

import type {
  DocumentClipboardAction,
  MarkdownAstNode,
  DocumentSelection,
  DocumentInputTarget,
  DocumentInputSelection,
  DocumentFormatAction,
  DocumentModelTextPoint,
  DocumentModelTextSelection,
  DocumentTableCellSelection,
  DocumentTableSelection,
  SourceRange
} from '@marktext/document-core'

import type { MuyaMarkupBinding, MuyaMarkupView } from './muyaMarkupView'
import {
  mappedMuyaModelPoint,
  mappedMuyaSourceRange,
  isMuyaNormalizedTextSegment
} from './muyaMarkupView'
import type { MuyaModelInput } from './muyaPlainTextCoreAdapter'
import {
  muyaViewBindingsInItems,
  muyaViewBindingsNear,
  muyaViewItemAtPath,
  muyaViewItemsAtPath,
  muyaViewItemsAtRoot,
  muyaViewLastBinding,
  muyaViewPreviousBinding
} from './muyaMarkupViewLookup'
import { samePath } from './muyaMarkupPath'

const sameCell = (left: MuyaMarkupBinding['tableCell'], right: MuyaMarkupBinding['tableCell']) =>
  left !== undefined &&
  right !== undefined &&
  left.table.start === right.table.start &&
  left.table.end === right.table.end &&
  left.row === right.row &&
  left.column === right.column

const nativeOffsetAtSource = (segment: MuyaMarkupBinding['segments'][number], source: number) =>
  source === segment.source.end
    ? segment.text.end
    : source === segment.source.start
      ? segment.text.start
      : segment.source.end - segment.source.start === segment.text.end - segment.text.start
        ? segment.text.start + source - segment.source.start
        : undefined

/** The model projection is the only source of semantic DOM boundary positions. */
export function createMuyaModelSelection(muya: Muya, view: MuyaMarkupView) {
  const nativeSelection = muya.editor.selection
  const bindingAt = (path: readonly (string | number)[]) =>
    muyaViewItemAtPath(view, 'bindings', path)
  const leadingLineBinding = (path: readonly (string | number)[]) => {
    const binding = bindingAt(path)
    return binding?.leadingLinePosition === undefined ? undefined : binding
  }
  /**
   * The binding's leading line position, while Muya renders that line before
   * its text, or renders an underline's empty setext heading in its place.
   */
  const presentedLeadingLine = (path: readonly (string | number)[]): number | undefined => {
    const binding = leadingLineBinding(path)
    if (binding?.leadingLinePosition === undefined) return undefined
    const block = muya.editor.scrollPage?.queryBlock([...path])
    if (!block?.isContent()) return undefined
    const presented =
      binding.syntax.kind === 'thematic-break'
        ? block.blockName === 'setextheading.content' && block.text === ''
        : block.text === `${binding.leadingLineText ?? ''}\n${binding.text}`
    return presented ? binding.leadingLinePosition : undefined
  }
  /** Muya's text offsets include a presented leading line; binding offsets exclude it. */
  const presentedLineShift = (path: readonly (string | number)[]): number => {
    const binding = leadingLineBinding(path)
    return binding === undefined ||
      presentedLeadingLine(path) === undefined ||
      binding.syntax.kind === 'thematic-break'
      ? 0
      : (binding.leadingLineText?.length ?? 0) + 1
  }
  const leadingLineSpaces = (binding: MuyaMarkupBinding) =>
    binding.syntax.kind === 'thematic-break' ? 0 : (binding.leadingLineText?.length ?? 0)
  /** The source position of a native offset on a presented leading line. */
  const leadingLineSource = (binding: MuyaMarkupBinding, offset: number): number | undefined => {
    const position = presentedLeadingLine(binding.path)
    const spaces = leadingLineSpaces(binding)
    return position === undefined || offset < 0 || offset > spaces
      ? undefined
      : position - spaces + offset
  }
  const native = {
    getTextPoint(point: DocumentDOMPoint) {
      const text = nativeSelection.getTextPoint(point)
      if (text == null) return text
      return { ...text, offset: text.offset - presentedLineShift(text.path) }
    },
    getDOMPoint(text: NonNullable<ReturnType<typeof nativeSelection.getTextPoint>>) {
      return nativeSelection.getDOMPoint({
        ...text,
        offset: text.offset + presentedLineShift(text.path)
      })
    }
  }
  /** The marker line whose container Muya shows as its literal paragraph at `path`. */
  const presentedMarkerLine = (path: readonly (string | number)[]) => {
    // A marker line's container holds its paragraph, so both share a root,
    // and in a list, the item.
    const item = path[1] === 'children' && typeof path[2] === 'number' ? path[2] : undefined
    const candidates =
      typeof path[0] !== 'number'
        ? view.bindings
        : item === undefined
          ? muyaViewItemsAtRoot(view, 'bindings', path[0])
          : muyaViewBindingsInItems(view, path[0], item, item + 1)
    const line = candidates.find(
      (binding) =>
        binding.markerLine !== undefined &&
        samePath([...binding.markerLine.statePath, 'text'], path)
    )?.markerLine
    if (line === undefined) return undefined
    const block = muya.editor.scrollPage?.queryBlock([...path])
    return block?.isContent() && block.blockName === 'paragraph.content' && block.text === line.text
      ? line
      : undefined
  }
  /** The empty paragraph whose blank line's spaces Muya shows at `path`. */
  const presentedBlankLine = (path: readonly (string | number)[]) => {
    const at = bindingAt(path)
    const binding = at?.blankLineText === undefined ? undefined : at
    const block = binding && muya.editor.scrollPage?.queryBlock([...path])
    return block?.isContent() && block.text === binding?.blankLineText ? binding : undefined
  }
  const bindingFor = (point: DocumentDOMPoint): MuyaMarkupBinding | undefined => {
    const text = native.getTextPoint(point)
    return text == null ? undefined : bindingAt(text.path)
  }
  const anchorFor = (node: Node, binding: MuyaMarkupBinding) => {
    if (!(node instanceof HTMLElement) || !node.hasAttribute('data-critic-start')) return undefined
    const start = Number(node.dataset.criticStart) + binding.sourceRange.start
    const end = Number(node.dataset.criticEnd) + binding.sourceRange.start
    const comment = muyaViewItemsAtPath(view, 'comments', binding.path).find(
      (item) =>
        item.annotationRange.start === start &&
        item.annotationRange.end === end &&
        node.dataset.criticKind === 'comment'
    )
    const decoration = muyaViewItemsAtPath(view, 'decorations', binding.path).find(
      (item) =>
        item.mark.annotationRange.start === start &&
        item.mark.annotationRange.end === end &&
        item.mark.kind === node.dataset.criticKind &&
        (item.sourcePosition === undefined
          ? !node.hasAttribute('data-critic-position')
          : item.sourcePosition ===
            Number(node.dataset.criticPosition) + binding.sourceRange.start) &&
        (item.mark.kind !== 'substitution' || item.mark.arm === node.dataset.criticArm)
    )
    return comment === undefined && decoration === undefined
      ? undefined
      : {
        start: decoration?.sourcePosition ?? start,
        end: decoration?.exteriorEnd ?? decoration?.sourcePosition ?? end,
        decoration
      }
  }
  const contentRoot = (binding: MuyaMarkupBinding) => {
    const block = muya.editor.scrollPage?.queryBlock([...binding.path])
    return block?.isContent() && block.domNode instanceof HTMLElement ? block.domNode : undefined
  }
  /**
   * The source position before the openers of annotations that begin the
   * visible line starting at paragraph text `line`, if any.
   */
  const lineStartExterior = (binding: MuyaMarkupBinding, line = 0): number | undefined => {
    const root = contentRoot(binding)
    if (root === undefined) return undefined
    // An annotation continued from an earlier line, such as a substitution
    // whose old arm is a heading, has its opener on that line.
    const earlier =
      line === 0
        ? (muyaViewPreviousBinding(view, binding)?.sourceRange.end ?? 0)
        : mappedMuyaSourceRange(binding, { start: line, end: line }, 'previous')?.start
    if (earlier === undefined) return undefined
    let exterior: number | undefined
    for (const node of root.querySelectorAll('[data-critic-start]')) {
      const start = native.getTextPoint({ node, offset: 0 })
      if (start == null || start.offset < line) continue
      if (start.offset > line) break
      // Payload-boundary markers are caret origins inside syntax, not openers.
      const anchor = node.hasAttribute('data-critic-position')
        ? undefined
        : anchorFor(node, binding)
      if (anchor !== undefined && anchor.start >= earlier) {
        exterior = Math.min(exterior ?? anchor.start, anchor.start)
      }
    }
    return exterior
  }
  /** The binding's soft-break trailing line position, while Muya renders that line. */
  const presentedTrailingLine = (binding: MuyaMarkupBinding): number | undefined => {
    if (binding.trailingLinePosition === undefined) return undefined
    const block = muya.editor.scrollPage?.queryBlock([...binding.path])
    return block?.isContent() && block.text === `${binding.text}\n`
      ? binding.trailingLinePosition
      : undefined
  }
  /** The position where Muya shows a caret in spaces that belong to no text. */
  const snapCaret = (
    source: number,
    cell?: DocumentTableCellSelection['cell']
  ): number | undefined => {
    for (const binding of muyaViewBindingsNear(view, source)) {
      if (cell !== undefined && !sameCell(binding.tableCell, cell)) continue
      const snap = binding.caretSnaps?.find((item) => item.from <= source && source < item.to)
      if (snap !== undefined) return snap.at
    }
    return undefined
  }
  /** The number of the cell's padding spaces Muya renders after its text. */
  const presentedCellPadding = (binding: MuyaMarkupBinding): number => {
    if (binding.tableCellPadding === undefined) return 0
    const block = muya.editor.scrollPage?.queryBlock([...binding.path])
    if (!block?.isContent() || !block.text.startsWith(binding.text)) return 0
    const spaces = block.text.length - binding.text.length
    return spaces <= binding.tableCellPadding && /^ *$/u.test(block.text.slice(binding.text.length))
      ? spaces
      : 0
  }
  /** Paragraph text offsets that begin a later visible line, after its line break. */
  const isLaterLineStart = (binding: MuyaMarkupBinding, offset: number) =>
    binding.text[offset - 1] === '\n' ||
    (binding.text[offset - 1] === '\r' && binding.text[offset] !== '\n')
  const domPointToModel = (
    point: DocumentDOMPoint,
    caret = false
  ): DocumentModelTextPoint | undefined => {
    const marker = nativeSelection.getTextPoint(point)
    const markerLine = marker == null ? undefined : presentedMarkerLine(marker.path)
    if (marker != null && markerLine !== undefined) return markerLine.start + marker.offset
    const blank = marker == null ? undefined : presentedBlankLine(marker.path)
    if (marker != null && blank !== undefined) return blank.sourceRange.end + marker.offset
    const binding = bindingFor(point)
    if (binding === undefined) return undefined
    const leadingLine = leadingLineSource(
      binding,
      nativeSelection.getTextPoint(point)?.offset ?? -1
    )
    if (leadingLine !== undefined) return leadingLine
    const trailingLine = presentedTrailingLine(binding)
    if (
      trailingLine !== undefined &&
      (native.getTextPoint(point)?.offset ?? 0) > binding.text.length
    ) {
      return trailingLine
    }
    const padding = presentedCellPadding(binding)
    const paddingOffset = (native.getTextPoint(point)?.offset ?? 0) - binding.text.length
    if (padding > 0 && paddingOffset > 0 && binding.tableCellContent !== undefined) {
      return binding.tableCellContent.end + Math.min(paddingOffset, padding)
    }
    // Element child boundaries distinguish outside an annotation from inside
    // its payload even when both have the same paragraph text offset.
    if (point.node.nodeType === Node.ELEMENT_NODE) {
      const following = point.node.childNodes[point.offset]
      const preceding = point.node.childNodes[point.offset - 1]
      const next = following === undefined ? undefined : anchorFor(following, binding)
      const previous = preceding === undefined ? undefined : anchorFor(preceding, binding)
      // The two rendered arms share an annotation identity. Their common DOM
      // boundary is inside that annotation, not before its entire source range.
      if (
        next !== undefined &&
        previous !== undefined &&
        next.start === previous.start &&
        next.end === previous.end &&
        previous.decoration?.mark.kind === 'substitution' &&
        previous.decoration.mark.arm === 'old' &&
        next.decoration?.mark.kind === 'substitution' &&
        next.decoration.mark.arm === 'new'
      ) {
        const offset = next.decoration.range.start
        return mappedMuyaSourceRange(binding, { start: offset, end: offset }, 'next')?.start
      }
      if (next !== undefined) return next.start
      if (previous !== undefined) return previous.end
    }
    const text = native.getTextPoint(point)
    if (text == null) return undefined
    // Upstream sees annotation syntax as literal text, so a caret at the visible
    // start of a line is before any leading openers, as End is after trailing
    // closers: in an annotation's first text, or in a zero-width marker there.
    // Only an element boundary inside the annotation addresses its interior.
    // Range endpoints keep their own side of the hidden delimiters.
    const laterLine = isLaterLineStart(binding, text.offset)
    if (
      caret &&
      (text.offset === 0 || laterLine) &&
      // A later line's start may be the end of the previous line's text, after its break.
      (point.node.nodeType === Node.TEXT_NODE
        ? point.offset === 0
          ? point.node.parentElement?.closest('[data-critic-start]')?.closest('.mu-content') ===
            point.node.parentElement?.closest('.mu-content')
          : laterLine && point.offset === point.node.textContent?.length
        : point.node.childNodes.length === 0)
    ) {
      const start = lineStartExterior(binding, text.offset)
      if (start !== undefined) return start
    }
    let segments = binding.segments
    for (
      let node = point.node.parentNode;
      node !== null && node !== muya.domNode;
      node = node.parentNode
    ) {
      const anchor = anchorFor(node, binding)
      if (anchor?.decoration !== undefined) {
        const range = anchor.decoration.range
        segments = segments.filter(
          (segment) => segment.text.start < range.end && segment.text.end > range.start
        )
      }
    }
    const mapped = mappedMuyaModelPoint(
      { ...binding, segments },
      text.offset,
      // A later line's text begins after its container prefix, such as `> `.
      laterLine || (point.node.nodeType === Node.TEXT_NODE && point.offset === 0)
        ? 'next'
        : 'previous'
    )
    // An empty later line has no text after its prefix to map through.
    const prefix =
      laterLine && typeof mapped === 'number'
        ? binding.caretSnaps?.find((snap) => snap.at === mapped && snap.from === mapped + 1)
        : undefined
    return prefix === undefined ? mapped : prefix.to - 1
  }
  /**
   * Whether the binding's rendering can hold `source`: in its text, or at an
   * edge or payload boundary of an annotation or Comment shown in it. Only
   * such a binding's DOM is read.
   */
  const mayRenderSource = (binding: MuyaMarkupBinding, source: number): boolean =>
    (binding.text.length === 0 && binding.sourceRange.end === source) ||
    binding.segments.some((segment) => segment.source.start <= source && source <= segment.source.end) ||
    muyaViewItemsAtPath(view, 'decorations', binding.path).some(
      (item) =>
        item.mark.annotationRange.start === source ||
        item.mark.annotationRange.end === source ||
        item.sourcePosition === source ||
        item.exteriorEnd === source
    ) ||
    muyaViewItemsAtPath(view, 'comments', binding.path).some(
      (item) => item.annotationRange.start === source || item.annotationRange.end === source
    )
  const edge = (node: Node, after: boolean): DocumentDOMPoint | undefined => {
    const parent = node.parentNode
    if (parent === null) return undefined
    return {
      node: parent,
      offset: Array.prototype.indexOf.call(parent.childNodes, node) + (after ? 1 : 0)
    }
  }
  const modelPointToText = (
    source: DocumentModelTextPoint,
    cell?: DocumentTableCellSelection['cell']
  ) => {
    if (typeof source !== 'number') {
      for (const binding of muyaViewBindingsNear(view, source.text.start, source.text.end)) {
        const segment = binding.segments.find(
          (item) =>
            item.source.start === source.text.start &&
            item.source.end === source.text.end &&
            isMuyaNormalizedTextSegment(binding, item)
        )
        if (
          segment !== undefined &&
          source.offset >= 0 &&
          source.offset <= segment.text.end - segment.text.start
        ) {
          return { path: binding.path, offset: segment.text.start + source.offset }
        }
      }
      return undefined
    }
    for (const binding of muyaViewBindingsNear(view, source)) {
      if (cell !== undefined && !sameCell(binding.tableCell, cell)) continue
      for (const segment of binding.segments) {
        if (source < segment.source.start || source > segment.source.end) continue
        const offset = nativeOffsetAtSource(segment, source)
        if (offset !== undefined) return { path: binding.path, offset }
      }
      if (binding.text.length === 0 && binding.sourceRange.end === source) {
        return { path: binding.path, offset: 0 }
      }
    }
    return undefined
  }
  const modelPointToDOM = (
    source: DocumentModelTextPoint,
    cell?: DocumentTableCellSelection['cell'],
    caret = false
  ): DocumentDOMPoint | undefined => {
    if (typeof source !== 'number') {
      const text = modelPointToText(source, cell)
      return text === undefined ? undefined : (native.getDOMPoint(text) ?? undefined)
    }
    for (const binding of muyaViewBindingsNear(view, source)) {
      if (cell !== undefined && !sameCell(binding.tableCell, cell)) continue
      if (!mayRenderSource(binding, source)) continue
      const block = muya.editor.scrollPage?.queryBlock([...binding.path])
      const root = block?.isContent() ? block.domNode : undefined
      if (!(root instanceof HTMLElement)) continue
      let closing: DocumentDOMPoint | undefined
      for (const node of root.querySelectorAll('[data-critic-start]')) {
        const anchor = anchorFor(node, binding)
        if (anchor?.start === source) return edge(node, false)
        if (anchor?.end === source) closing = edge(node, true)
      }
      if (closing !== undefined) return closing
      for (const segment of binding.segments) {
        if (source < segment.source.start || source > segment.source.end) continue
        const offset = nativeOffsetAtSource(segment, source)
        if (offset === undefined) continue
        const ordinary = native.getDOMPoint({ path: binding.path, offset })
        if (ordinary != null && isEqual(domPointToModel(ordinary, caret), source)) return ordinary
        // Coincident visible offsets can belong to different substitution arms
        // or nested spans. Select the actual text node whose model map agrees.
        const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const start = native.getTextPoint({ node, offset: 0 })
          if (start == null) continue
          const local = offset - start.offset
          if (local < 0 || local > (node.textContent?.length ?? 0)) continue
          const candidate = { node, offset: local }
          if (isEqual(domPointToModel(candidate, caret), source)) return candidate
          if (local !== 0) continue
          // A text start can be an annotation's interior start, which only an
          // element boundary inside that annotation distinguishes.
          for (
            let child: Node = node;
            child.parentNode !== null && child !== root;
            child = child.parentNode
          ) {
            const boundary = {
              node: child.parentNode,
              offset: Array.prototype.indexOf.call(child.parentNode.childNodes, child)
            }
            if (isEqual(domPointToModel(boundary, caret), source)) return boundary
          }
        }
      }
      if (binding.text.length === 0 && binding.sourceRange.end === source) {
        const point = native.getDOMPoint({ path: binding.path, offset: 0 })
        if (point != null && domPointToModel(point, caret) === source) return point
      }
    }
    for (const binding of muyaViewBindingsNear(view, source)) {
      if (presentedTrailingLine(binding) !== source) continue
      return (
        native.getDOMPoint({ path: binding.path, offset: binding.text.length + 1 }) ?? undefined
      )
    }
    for (const binding of muyaViewBindingsNear(view, source)) {
      if (cell !== undefined && !sameCell(binding.tableCell, cell)) continue
      const end = binding.tableCellContent?.end
      if (end === undefined || source <= end || source > end + presentedCellPadding(binding)) {
        continue
      }
      return (
        native.getDOMPoint({ path: binding.path, offset: binding.text.length + source - end }) ??
        undefined
      )
    }
    for (const binding of muyaViewBindingsNear(view, source)) {
      const spaces = binding.blankLineText?.length ?? 0
      if (source <= binding.sourceRange.end || source > binding.sourceRange.end + spaces) continue
      if (presentedBlankLine(binding.path) === undefined) continue
      return (
        nativeSelection.getDOMPoint({
          path: binding.path,
          offset: source - binding.sourceRange.end
        }) ?? undefined
      )
    }
    for (const binding of muyaViewBindingsNear(view, source)) {
      const line = binding.markerLine
      if (line === undefined || source < line.start || source > line.start + line.text.length) {
        continue
      }
      const path = [...line.statePath, 'text']
      if (presentedMarkerLine(path) === undefined) continue
      return nativeSelection.getDOMPoint({ path, offset: source - line.start }) ?? undefined
    }
    for (const binding of muyaViewBindingsNear(view, source)) {
      if (binding.leadingLinePosition === undefined) continue
      const position = presentedLeadingLine(binding.path)
      if (position === undefined) continue
      const offset = source - position + leadingLineSpaces(binding)
      if (leadingLineSource(binding, offset) !== source) continue
      return nativeSelection.getDOMPoint({ path: binding.path, offset }) ?? undefined
    }
    const snapped = snapCaret(source, cell)
    if (snapped === undefined) return undefined
    for (const binding of muyaViewBindingsNear(view, source)) {
      if (!binding.caretSnaps?.some((snap) => snap.from <= source && source < snap.to)) continue
      // The shown position maps back to the snapped source, not to `snapped`.
      for (const segment of binding.segments) {
        if (snapped < segment.source.start || snapped > segment.source.end) continue
        const offset = nativeOffsetAtSource(segment, snapped)
        if (offset !== undefined) {
          return native.getDOMPoint({ path: binding.path, offset }) ?? undefined
        }
      }
    }
    return modelPointToDOM(snapped, cell, caret)
  }
  const domSelectionToModel = (selection: {
    anchor: DocumentDOMPoint
    focus: DocumentDOMPoint
  }): DocumentInputSelection | undefined => {
    const anchorBinding = bindingFor(selection.anchor)
    const focusBinding = bindingFor(selection.focus)
    const caret =
      selection.anchor.node === selection.focus.node &&
      selection.anchor.offset === selection.focus.offset
    const anchor = domPointToModel(selection.anchor, caret)
    const focus = domPointToModel(selection.focus, caret)
    if (anchor === undefined || focus === undefined) return undefined
    if (
      typeof anchor !== 'number' ||
      typeof focus !== 'number' ||
      anchorBinding?.path.at(-1) === 'lang' ||
      focusBinding?.path.at(-1) === 'lang'
    ) {
      return { kind: 'model-text', anchor, focus }
    }
    const content = anchorBinding?.tableCellContent
    // Annotation exterior anchors may be rendered beside a cell's text while
    // identifying a document position outside that cell.
    if (
      anchorBinding === focusBinding &&
      anchorBinding?.tableCell !== undefined &&
      content !== undefined &&
      Math.min(anchor, focus) >= content.start &&
      Math.max(anchor, focus) <= content.end + (anchorBinding.tableCellPadding ?? 0)
    ) {
      return {
        kind: 'table-cell',
        cell: anchorBinding.tableCell,
        anchor: anchor - content.start,
        focus: focus - content.start
      }
    }
    return { ranges: [{ anchor, focus }], primary: 0 }
  }
  const domSelectionToTarget = (selection: {
    anchor: DocumentDOMPoint
    focus: DocumentDOMPoint
  }): DocumentInputTarget | undefined => {
    const model = domSelectionToModel(selection)
    if (model === undefined || model.kind === 'table-cell' || model.kind === 'model-text') {
      return model
    }
    const range = model.ranges[model.primary]
    return range === undefined
      ? undefined
      : { start: Math.min(range.anchor, range.focus), end: Math.max(range.anchor, range.focus) }
  }
  const cellBinding = (cell: DocumentTableCellSelection['cell']) => {
    for (const binding of muyaViewBindingsNear(view, cell.table.start)) {
      if (sameCell(binding.tableCell, cell)) return binding
    }
    return undefined
  }
  const modelCellPointToDOM = (
    selection: DocumentTableCellSelection,
    offset: number,
    caret = false
  ) => {
    const binding = cellBinding(selection.cell)
    if (binding?.tableCellContent === undefined) return undefined
    return modelPointToDOM(binding.tableCellContent.start + offset, selection.cell, caret)
  }
  const modelCellPointToText = (selection: DocumentTableCellSelection, offset: number) => {
    const binding = cellBinding(selection.cell)
    return binding?.tableCellContent === undefined
      ? undefined
      : modelPointToText(binding.tableCellContent.start + offset, selection.cell)
  }
  const projectSourcePoint = (source: number): number => {
    if (modelPointToDOM(source) !== undefined) return source
    const end = muyaViewLastBinding(view)?.documentEnd?.offset
    if (!Number.isSafeInteger(source) || source < 0 || end === undefined || source > end) {
      throw new RangeError('Source caret is outside the current document')
    }
    // Omitted delimiters, container prefixes and terminal line endings have no
    // editable DOM. Project them onto existing parser-owned boundaries only.
    const boundaries = [
      ...new Set([
        ...view.bindings.flatMap((binding) =>
          binding.text.length === 0
            ? [binding.sourceRange.end]
            : binding.segments.flatMap((segment) => [segment.source.start, segment.source.end])
        ),
        ...view.decorations.flatMap((mark) => [
          mark.mark.annotationRange.start,
          mark.mark.annotationRange.end
        ]),
        ...view.comments.flatMap((comment) => [
          comment.annotationRange.start,
          comment.annotationRange.end
        ])
      ])
    ].sort((left, right) => left - right)
    const candidates = [
      ...boundaries.filter((point) => point >= source),
      ...boundaries.filter((point) => point < source).reverse()
    ]
    const position = candidates.find((point) => modelPointToDOM(point) !== undefined)
    if (position === undefined) throw new Error('Source caret has no rendered model boundary')
    return position
  }
  /**
   * At a visible line start, ArrowRight enters leading annotations whose
   * delimiters are hidden, and ArrowLeft leaves them again.
   */
  const caretStep = (
    point: DocumentDOMPoint,
    direction: 'forward' | 'backward'
  ): DocumentDOMPoint | undefined => {
    const binding = bindingFor(point)
    const root = binding === undefined ? undefined : contentRoot(binding)
    const line = native.getTextPoint(point)?.offset
    if (
      binding === undefined ||
      root === undefined ||
      line === undefined ||
      (line !== 0 && !isLaterLineStart(binding, line))
    ) {
      return undefined
    }
    const exterior = lineStartExterior(binding, line)
    if (exterior === undefined) return undefined
    const current = domPointToModel(point, true)
    if (direction === 'backward') {
      return current === undefined || isEqual(current, exterior)
        ? undefined
        : modelPointToDOM(exterior, undefined, true)
    }
    if (!isEqual(current, exterior)) return undefined
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let first = walker.nextNode()
    while (first !== null && native.getTextPoint({ node: first, offset: 0 })?.offset !== line) {
      first = walker.nextNode()
    }
    const parent = first?.parentNode
    if (first == null || parent == null || parent === root) return undefined
    const interior = {
      node: parent,
      offset: Array.prototype.indexOf.call(parent.childNodes, first)
    }
    const model = domPointToModel(interior, true)
    return model === undefined || isEqual(model, exterior) ? undefined : interior
  }
  /**
   * A line-end move leaves annotations that end the visible line, as a
   * line-start move is before those that begin it: typing there is not part
   * of the annotation (owner decision; Google Docs keeps text typed at a
   * comment's edge outside it).
   */
  const lineEndStep = (point: DocumentDOMPoint): DocumentDOMPoint | undefined => {
    const binding = bindingFor(point)
    const root = binding === undefined ? undefined : contentRoot(binding)
    if (binding === undefined || root === undefined) return undefined
    // Ends of annotations whose closers follow the point on its line.
    const ends: number[] = []
    // Visible content from `first` on along its line. Payload-boundary and
    // comment markers show no text; a comment marker ends its comment's source.
    const continuesLine = (first: Node | null): boolean => {
      for (let next = first; next !== null; next = next.nextSibling) {
        const text = next.textContent ?? ''
        if (text.startsWith('\n') || next.nodeName === 'BR') return false
        if (
          next instanceof HTMLElement &&
          text === '' &&
          (next.hasAttribute('data-critic-position') || next.dataset.criticKind === 'comment')
        ) {
          ends.push(binding.sourceRange.start + Number(next.dataset.criticEnd))
          continue
        }
        if (text !== '' || next instanceof Element) return true
      }
      return false
    }
    // The browser can end a line in text or beside a trailing marker.
    if (point.node.nodeType === Node.TEXT_NODE) {
      if (point.offset < (point.node.textContent ?? '').length) return undefined
    } else if (continuesLine(point.node.childNodes[point.offset] ?? null)) return undefined
    for (let node: Node | null = point.node; node !== null && node !== root; node = node.parentNode) {
      if (continuesLine(node.nextSibling)) return undefined
      if (
        node instanceof HTMLElement &&
        node.hasAttribute('data-critic-start') &&
        !node.hasAttribute('data-critic-position')
      ) {
        ends.push(binding.sourceRange.start + Number(node.dataset.criticEnd))
      }
    }
    const current = domPointToModel(point, true)
    // The outermost end with a rendered position after it; one whose outer
    // end has none still leaves the inner annotations.
    for (const end of [...new Set(ends)].sort((left, right) => right - left)) {
      const exterior = modelPointToDOM(end, undefined, true)
      if (exterior !== undefined && isEqual(domPointToModel(exterior, true), end)) {
        return isEqual(current, end) ? undefined : exterior
      }
    }
    return undefined
  }
  return {
    caretStep,
    lineEndStep,
    snapCaret,
    domPointToModel,
    domPointToTableCell: (point: DocumentDOMPoint) => bindingFor(point)?.tableCell,
    domSelectionToModel,
    domSelectionToTarget,
    modelPointToDOM,
    modelPointToText,
    modelCellPointToDOM,
    modelCellPointToText,
    projectSourcePoint
  }
}

/**
 * Indented code's language box has no source of its own; setting a language
 * there addresses its code block, at the start of its text.
 */
function languageBoxSelection(
  muya: Muya,
  view: MuyaMarkupView,
  point: DocumentDOMPoint
): DocumentInputSelection | undefined {
  const text = muya.editor.selection.getTextPoint(point)
  if (text == null || text.path.at(-1) !== 'lang' || text.path.at(-2) !== 'meta') return undefined
  const body = muyaViewItemAtPath(view, 'bindings', [...text.path.slice(0, -2), 'text'])
  if (body?.syntax.kind !== 'code-block' || body.syntax.attributes.provider !== 'indented-code') {
    return undefined
  }
  const at = body.sourceRange.start
  return { ranges: [{ anchor: at, focus: at }], primary: 0 }
}

/** Resolve the live browser action before any presentation or model mutation. */
export function muyaInputToModel(
  muya: Muya,
  view: MuyaMarkupView,
  input: DocumentTextInput
): Extract<MuyaModelInput, { inputType: string }>
export function muyaInputToModel(
  muya: Muya,
  view: MuyaMarkupView,
  input: DocumentInput
): MuyaModelInput
export function muyaInputToModel(
  muya: Muya,
  view: MuyaMarkupView,
  input: DocumentInput
): MuyaModelInput {
  const { domSelectionToModel, domSelectionToTarget, domPointToTableCell, domPointToModel } =
    createMuyaModelSelection(muya, view)
  const selection =
    domSelectionToModel(input.selection) ??
    ('kind' in input && input.command === 'setCodeLanguage'
      ? languageBoxSelection(muya, view, input.selection.anchor)
      : undefined)
  if (selection === undefined) {
    throw new Error('The current model has no position for the native input selection')
  }
  if ('kind' in input) {
    if (input.command === 'moveText') {
      const target = domSelectionToTarget(input.target)
      if (target === undefined) throw new Error('Text drop has no current model target')
      return {
        kind: input.kind,
        command: input.command,
        selection,
        target,
        copy: input.copy,
        options: input.options
      }
    }
    if (input.command === 'moveBlock') {
      const from = domPointToModel(input.from)
      const to = domPointToModel(input.to)
      if (from === undefined || to === undefined) {
        throw new Error('Block drag has no current model target')
      }
      return {
        kind: input.kind,
        command: input.command,
        from: typeof from === 'number' ? from : from.text.start,
        to: typeof to === 'number' ? to : to.text.start,
        placement: input.placement,
        selection,
        options: input.options
      }
    }
    if (input.command === 'changeBlock') {
      const at = input.change.at === undefined ? undefined : domPointToModel(input.change.at)
      if (input.change.at !== undefined && at === undefined) {
        throw new Error('Block command target has no model position')
      }
      const { at: _nativeTarget, ...change } = input.change
      return {
        kind: input.kind,
        command: input.command,
        change: {
          ...change,
          ...(at === undefined ? {} : { at: typeof at === 'number' ? at : at.text.start })
        },
        selection,
        options: input.options,
        ...(input.historyGroup === undefined ? {} : { historyGroup: input.historyGroup })
      }
    }
    if (
      input.command === 'alignTableColumn' ||
      input.command === 'moveTableColumn' ||
      input.command === 'moveTableRow'
    ) {
      const target = domPointToTableCell(input.target)
      if (target === undefined) {
        throw new Error('The current model has no cell for the table command target')
      }
      const { target: _nativeTarget, historyGroup, ...command } = input
      return {
        ...command,
        target,
        selection,
        ...(historyGroup === undefined ? {} : { historyGroup })
      }
    }
    const { historyGroup, ...command } = input
    return {
      ...command,
      selection,
      ...(historyGroup === undefined ? {} : { historyGroup })
    }
  }
  const range = domSelectionToTarget(input.range)
  if (range === undefined) {
    throw new Error('The current model has no position for the native input boundary')
  }
  return {
    selection,
    range,
    inputType: input.inputType,
    data: input.data,
    options: input.options,
    ...(input.historyGroup === undefined ? {} : { historyGroup: input.historyGroup })
  }
}

/** Formatting receives the same exact live DOM selection as native input. */
export function muyaFormatToModel(
  muya: Muya,
  view: MuyaMarkupView,
  input: DocumentFormatInput,
  tracked: boolean
): DocumentFormatAction {
  const { domPointToModel } = createMuyaModelSelection(muya, view)
  const anchor = domPointToModel(input.selection.anchor)
  const focus = domPointToModel(input.selection.focus)
  if (anchor === undefined || focus === undefined) {
    throw new Error('The current model has no source position for the native formatting selection')
  }
  if (typeof anchor !== 'number' || typeof focus !== 'number') {
    if (input.format === 'image-properties') {
      throw new Error('Image properties require an image source selection')
    }
    return {
      format: input.format,
      selection: { kind: 'model-text', anchor, focus },
      tracked,
      ...(input.image === undefined ? {} : { image: { ...input.image } })
    }
  }
  return input.format === 'image-properties'
    ? {
      format: input.format,
      selection: { start: Math.min(anchor, focus), end: Math.max(anchor, focus) },
      tracked,
      properties: { ...input.properties }
    }
    : {
      format: input.format,
      selection: { ranges: [{ anchor, focus }], primary: 0 },
      tracked,
      ...(input.image === undefined ? {} : { image: { ...input.image } })
    }
}

/** Prepared clipboard payloads use the same live selection mapping as typing. */
function muyaTableSelectionToModel(
  muya: Muya,
  view: MuyaMarkupView,
  selection: Extract<DocumentClipboardInput, { kind: 'table' }>['selection']
): DocumentTableSelection {
  const cells = selection.ranges.map((range) => {
    const anchor = muya.editor.selection.getTextPoint(range.anchor)
    const focus = muya.editor.selection.getTextPoint(range.focus)
    const binding =
      anchor && focus && samePath(anchor.path, focus.path)
        ? muyaViewItemAtPath(view, 'bindings', anchor.path)
        : undefined
    if (binding?.tableCell === undefined) {
      throw new Error('The current model has no address for a selected table cell')
    }
    return binding.tableCell
  })
  const anchor = cells[selection.primary]
  if (
    anchor === undefined ||
    cells.some(
      (cell) => cell.table.start !== anchor.table.start || cell.table.end !== anchor.table.end
    )
  ) {
    throw new Error('The current selection does not identify one model table')
  }
  const rows = cells.map((cell) => cell.row)
  const columns = cells.map((cell) => cell.column)
  const minRow = Math.min(...rows)
  const maxRow = Math.max(...rows)
  const minColumn = Math.min(...columns)
  const maxColumn = Math.max(...columns)
  if (
    new Set(cells.map((cell) => `${cell.row}:${cell.column}`)).size !==
    (maxRow - minRow + 1) * (maxColumn - minColumn + 1)
  ) {
    throw new Error('The selected model cells are not a rectangle')
  }
  return {
    kind: 'table',
    table: anchor.table,
    anchor: { row: anchor.row, column: anchor.column },
    focus: {
      row: anchor.row === minRow ? maxRow : minRow,
      column: anchor.column === minColumn ? maxColumn : minColumn
    }
  }
}

export function muyaClipboardToModel(
  muya: Muya,
  view: MuyaMarkupView,
  input: Extract<DocumentClipboardInput, { kind: 'paste' }>,
  tracked: boolean
): Extract<DocumentClipboardAction, { kind: 'paste' }>
export function muyaClipboardToModel(
  muya: Muya,
  view: MuyaMarkupView,
  input: DocumentClipboardInput,
  tracked: boolean
): DocumentClipboardAction
export function muyaClipboardToModel(
  muya: Muya,
  view: MuyaMarkupView,
  input: DocumentClipboardInput,
  tracked: boolean
): DocumentClipboardAction {
  if (input.kind === 'table') {
    const { historyGroup: _historyGroup, ...table } = input
    return { ...table, tracked, selection: muyaTableSelectionToModel(muya, view, input.selection) }
  }
  const selection = createMuyaModelSelection(muya, view).domSelectionToModel(input.selection)
  if (selection === undefined) {
    throw new Error('The current model has no position for the clipboard selection')
  }
  // Upstream's preference, which Core applies to a code block the edit changes.
  const trim = muya.options.trimUnnecessaryCodeBlockEmptyLines === true
    ? { trimUnnecessaryCodeBlockEmptyLines: true }
    : {}
  return input.kind === 'paste'
    ? {
      kind: 'paste',
      markdown: input.markdown,
      pasteAsPlainText: input.pasteAsPlainText,
      selection,
      tracked,
      ...trim
    }
    : { kind: 'cut', selection, tracked, ...trim }
}

/** The picker consumes intrinsic authoring facts in the same syntax used to render. */
export function muyaEmojiContext(
  muya: Muya,
  view: MuyaMarkupView,
  point: DocumentDOMPoint
): ReturnType<DocumentEditing['emojiContext']> {
  const text = muya.editor.selection.getTextPoint(point)
  if (text == null) return undefined
  const binding = muyaViewItemAtPath(view, 'bindings', text.path)
  if (binding === undefined) return undefined
  const visit = (node: MarkdownAstNode): ReturnType<DocumentEditing['emojiContext']> => {
    const alias = node.attributes.emojiAlias
    if (typeof alias === 'string') {
      const first = binding.segments.find(
        (segment) =>
          segment.syntax.start <= node.range.start && node.range.start < segment.syntax.end
      )
      const last = [...binding.segments]
        .reverse()
        .find(
          (segment) => segment.syntax.start < node.range.end && node.range.end <= segment.syntax.end
        )
      if (first === undefined || last === undefined) return undefined
      const start = first.text.start + node.range.start - first.syntax.start
      const end = last.text.start + node.range.end - last.syntax.start
      if (
        text.offset <= start ||
        text.offset > end ||
        (text.offset === end && node.attributes.emojiClosed === true)
      ) {
        return undefined
      }
      const { modelPointToDOM } = createMuyaModelSelection(muya, view)
      const anchor = modelPointToDOM(first.source.start + node.range.start - first.syntax.start)
      const focus = modelPointToDOM(last.source.start + node.range.end - last.syntax.start)
      return anchor == null || focus == null ? undefined : { alias, range: { anchor, focus } }
    }
    for (const child of node.children) {
      const context = visit(child)
      if (context !== undefined) return context
    }
    return undefined
  }
  return visit(binding.syntax)
}

/** Present active formats from owned syntax; never tokenize the displayed text. */
/** The picker consumes the fence already recognized by the document parser. */
export function muyaCodeLanguage(
  muya: Muya,
  view: MuyaMarkupView,
  point: DocumentDOMPoint
): string | undefined {
  const text = muya.editor.selection.getTextPoint(point)
  if (text == null) return undefined
  const syntax = muyaViewItemAtPath(view, 'bindings', text.path)?.syntax
  if (
    syntax === undefined ||
    !['code-block', 'diagram'].includes(syntax.kind) ||
    syntax.attributes.provider !== 'fenced-code'
  ) {
    return undefined
  }
  return String(syntax.attributes.semanticInfo ?? syntax.attributes.info ?? '')
}

export function muyaActiveFormats(
  muya: Muya,
  view: MuyaMarkupView,
  selection: { anchor: DocumentDOMPoint; focus: DocumentDOMPoint }
): readonly { type: string; tag?: string }[] {
  const { domPointToModel } = createMuyaModelSelection(muya, view)
  const anchor = domPointToModel(selection.anchor)
  const focus = domPointToModel(selection.focus)
  if (anchor === undefined || focus === undefined) return []
  const start = Math.min(
    typeof anchor === 'number' ? anchor : anchor.text.start,
    typeof focus === 'number' ? focus : focus.text.start
  )
  const end = Math.max(
    typeof anchor === 'number' ? anchor : anchor.text.end,
    typeof focus === 'number' ? focus : focus.text.end
  )
  const formats: { type: string; tag?: string }[] = []
  // A binding contributes only with a segment at `start`.
  for (const binding of muyaViewBindingsNear(view, start)) {
    const first =
      binding.segments.find(
        (segment) => segment.source.start <= start && start < segment.source.end
      ) ?? binding.segments.find((segment) => segment.source.end === start)
    const last =
      binding.segments.find((segment) => segment.source.start < end && end <= segment.source.end) ??
      binding.segments.find((segment) => segment.source.start === end)
    if (first === undefined || last === undefined) continue
    const syntaxStart = first.syntax.start + start - first.source.start
    const syntaxEnd = last.syntax.start + end - last.source.start
    formats.push(...documentActiveFormats(binding.syntax, { start: syntaxStart, end: syntaxEnd }))
  }
  return formats
}

/** Capture input identity while an asynchronous clipboard or image operation completes. */
export function muyaClipboardInputSelection(
  muya: Muya,
  view: MuyaMarkupView
): DocumentInputSelection | undefined {
  const native = muya.editor.selection
  if (native.table.hasSelection) return undefined
  const selection = native.image ? native.getImageDOMSelection() : native.getDOMSelection()
  return selection === null
    ? undefined
    : createMuyaModelSelection(muya, view).domSelectionToModel(selection)
}

/** Capture the actual current rectangle or text target after resource preparation. */
export function muyaClipboardCurrentSelection(
  muya: Muya,
  view: MuyaMarkupView
): DocumentSelection | undefined {
  const rectangle = muya.editor.selection.table.getDOMSelection()
  return rectangle === null
    ? muyaClipboardInputSelection(muya, view)
    : muyaTableSelectionToModel(muya, view, rectangle)
}

/** Capture the current clipboard target, including the native selected-image widget. */
export function muyaClipboardSourceRange(
  muya: Muya,
  view: MuyaMarkupView
): { start: number; end: number } | undefined {
  const native = muya.editor.selection
  if (native.table.hasSelection) return undefined
  const selection = native.image ? native.getImageDOMSelection() : native.getDOMSelection()
  if (selection === null) return undefined
  const { domPointToModel } = createMuyaModelSelection(muya, view)
  const anchor = domPointToModel(selection.anchor)
  const focus = domPointToModel(selection.focus)
  if (typeof anchor !== 'number' || typeof focus !== 'number') return undefined
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) }
}

/** Capture the model selection for copy without flattening a native rectangle. */
export function muyaClipboardSelection(
  muya: Muya,
  view: MuyaMarkupView
): SourceRange | DocumentTableSelection | DocumentModelTextSelection | undefined {
  const native = muya.editor.selection
  if (!native.table.hasSelection) {
    const selection = native.image ? native.getImageDOMSelection() : native.getDOMSelection()
    if (selection === null) return undefined
    const model = createMuyaModelSelection(muya, view).domSelectionToModel(selection)
    if (model?.kind === 'model-text') return model
    return muyaClipboardSourceRange(muya, view)
  }
  const selection = native.table.getDOMSelection()
  return selection === null ? undefined : muyaTableSelectionToModel(muya, view, selection)
}

/**
 * Upstream Muya's own Backspace (#113, #4926) removes the whole grapheme
 * before a caret that ends a top-level inline token of the line, or follows
 * its first grapheme; elsewhere Chromium removes one code point of a
 * combining sequence. Upstream reads CriticMarkup delimiters and comments as
 * text, so a text token runs through the hidden annotation source beside it:
 * a caret inside an Addition's end is not at its text token's end. Code keeps
 * the browser's unit.
 */
export function muyaBackspaceRemovesGrapheme(
  muya: Muya,
  view: MuyaMarkupView,
  point: DocumentDOMPoint
): boolean {
  const text = muya.editor.selection.getTextPoint(point)
  if (text == null) return false
  const binding = muyaViewItemAtPath(view, 'bindings', text.path)
  if (binding === undefined || ['code-block', 'diagram', 'math-block'].includes(binding.syntax.kind)) {
    return false
  }
  const caret = createMuyaModelSelection(muya, view).domPointToModel(point, true)
  const { segments } = binding
  const first = segments[0]
  const last = segments.at(-1)
  if (typeof caret !== 'number' || first === undefined || last === undefined) return false
  const annotations = [
    ...muyaViewItemsAtPath(view, 'decorations', binding.path).map((item) => item.mark.annotationRange),
    ...muyaViewItemsAtPath(view, 'comments', binding.path).map((item) => item.annotationRange)
  ]
  /** Extends `offset` over annotation source that contains or adjoins it. */
  const across = (offset: number, direction: 'forward' | 'backward'): number => {
    for (let moved = true; moved;) {
      moved = false
      for (const range of annotations) {
        if (direction === 'forward' && range.start <= offset && offset < range.end) {
          offset = range.end
          moved = true
        } else if (direction === 'backward' && range.start < offset && offset <= range.end) {
          offset = range.start
          moved = true
        }
      }
    }
    return offset
  }
  const toSource = (syntax: number, side: 'start' | 'end'): number | undefined => {
    const segment =
      side === 'start'
        ? segments.find((item) => item.syntax.start <= syntax && syntax < item.syntax.end) ??
          segments.find((item) => item.syntax.end === syntax)
        : segments.find((item) => item.syntax.start < syntax && syntax <= item.syntax.end) ??
          segments.find((item) => item.syntax.start === syntax)
    return segment && segment.source.start + syntax - segment.syntax.start
  }
  const toText = (syntax: number): number | undefined => {
    const segment = segments.find((item) => item.syntax.start <= syntax && syntax <= item.syntax.end)
    return segment && segment.text.start + syntax - segment.syntax.start
  }
  return binding.syntax.children.some((node) => {
    const start = toSource(node.range.start, 'start')
    const end = toSource(node.range.end, 'end')
    if (start === undefined || end === undefined) return false
    let tokenStart = start
    let tokenEnd = end
    if (node.kind === 'text') {
      const before = segments.find((item) => item.syntax.end === node.range.start)
      const after = segments.find((item) => item.syntax.start === node.range.end)
      tokenStart = node.range.start === first.syntax.start ? across(start, 'backward') : (before?.source.end ?? start)
      tokenEnd = node.range.end === last.syntax.end ? across(end, 'forward') : (after?.source.start ?? end)
    }
    if (caret === tokenEnd) return true
    // Upstream's first character there is a hidden delimiter's.
    if (tokenStart < start) return false
    const textStart = toText(node.range.start)
    const textEnd = toText(node.range.end)
    if (textStart === undefined || textEnd === undefined) return false
    const grapheme = firstGraphemeLength(binding.text.slice(textStart, textEnd))
    return grapheme > 0 && caret === start + grapheme
  })
}

/** Where a line-end move places the caret when the line ends in annotations. */
export function muyaLineEndStep(
  muya: Muya,
  view: MuyaMarkupView,
  point: DocumentDOMPoint
): DocumentDOMPoint | undefined {
  return createMuyaModelSelection(muya, view).lineEndStep(point)
}

/** The model's zero-width caret step for a plain horizontal arrow key. */
export function muyaCaretStep(
  muya: Muya,
  view: MuyaMarkupView,
  point: DocumentDOMPoint,
  direction: 'forward' | 'backward'
): DocumentDOMPoint | undefined {
  return createMuyaModelSelection(muya, view).caretStep(point, direction)
}

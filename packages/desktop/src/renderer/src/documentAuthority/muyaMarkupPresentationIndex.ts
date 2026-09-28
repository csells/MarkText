import type { MarkdownAstNode } from '@marktext/document-core'
import type { IInlinePresentationContext } from '@muyajs/core'
import { escapeHtml, isMuyaImageSyntax, renderMuyaMarkupBinding } from './muyaMarkupPresentation'
import { muyaItemAtPath, muyaItemsAtPath, muyaItemsInRoots } from './muyaMarkupViewLookup'
import type {
  MuyaMarkupBinding,
  MuyaMarkupComment,
  MuyaMarkupDecoration,
  MuyaMarkupPath,
  MuyaMarkupView
} from './muyaMarkupView'

export interface MuyaMarkupPresentationIndex {
  /** Includes removed paths, which remain literal until their view is removed. */
  readonly changedPaths: readonly MuyaMarkupPath[]
  render(path: MuyaMarkupPath, text: string, context?: IInlinePresentationContext): string
}

type Renderer = typeof renderMuyaMarkupBinding
type Highlights = NonNullable<IInlinePresentationContext['highlights']>
interface Entry {
  binding: MuyaMarkupBinding
  decorations: readonly MuyaMarkupDecoration[]
  comments: readonly MuyaMarkupComment[]
  readonly hasNativeWidget: boolean
  /** The view whose coordinates `binding`, `decorations` and `comments` use. */
  view: Pick<MuyaMarkupView, 'bindings' | 'decorations' | 'comments'>
  rendered?: { readonly text: string; readonly html: string; readonly highlights: Highlights }
}
/** Entries of each root block, keyed by the rest of their path. */
type RootEntries = ReadonlyMap<string, Entry>
const stores = new WeakMap<
  MuyaMarkupPresentationIndex,
  {
    readonly renderer: Renderer
    readonly commentLabel: string
    readonly view: Pick<MuyaMarkupView, 'bindings' | 'decorations' | 'comments'>
    readonly roots: readonly (RootEntries | undefined)[]
    /** Entries of paths that do not start with a root block number. */
    readonly others: RootEntries
  }
>()
const pathKey = (path: MuyaMarkupPath): string => JSON.stringify(path)
const hasNativeWidget = (node: MarkdownAstNode): boolean =>
  isMuyaImageSyntax(node) ||
  node.kind === 'inline-math' ||
  node.kind === 'inline-html' ||
  node.children.some(hasNativeWidget)
// These facts locate reference owners; resolved semantic values, rather than
// absolute owner positions, determine rendered output.
const referencePositions = new Set([
  'resolvedDefinitionStart',
  'resolvedDefinitionEnd',
  'definitionStart'
])

const sameSyntax = (before: MarkdownAstNode, after: MarkdownAstNode): boolean => {
  if (before === after) return true
  const beforeOrigin = before.range.start
  const afterOrigin = after.range.start
  const pending: Array<readonly [MarkdownAstNode, MarkdownAstNode]> = [[before, after]]
  while (pending.length > 0) {
    const pair = pending.pop()
    if (pair === undefined) break
    const [left, right] = pair
    const leftSpellings = left.semanticTextSegments ?? []
    const rightSpellings = right.semanticTextSegments ?? []
    if (
      leftSpellings.length !== rightSpellings.length ||
      leftSpellings.some((spelling, index) => {
        const other = rightSpellings[index]
        return (
          spelling.value !== other.value ||
          spelling.range.start - beforeOrigin !== other.range.start - afterOrigin ||
          spelling.range.end - beforeOrigin !== other.range.end - afterOrigin
        )
      })
    ) {
      return false
    }
    if (
      left.kind !== right.kind ||
      left.children.length !== right.children.length ||
      left.range.start - beforeOrigin !== right.range.start - afterOrigin ||
      left.range.end - beforeOrigin !== right.range.end - afterOrigin
    ) {
      return false
    }
    const leftKeys = Object.keys(left.attributes).filter((key) => !referencePositions.has(key))
    const rightKeys = Object.keys(right.attributes).filter((key) => !referencePositions.has(key))
    if (leftKeys.length !== rightKeys.length) return false
    for (const key of leftKeys) {
      const leftValue = left.attributes[key]
      const rightValue = right.attributes[key]
      if (!Object.hasOwn(right.attributes, key)) return false
      if (
        typeof leftValue === 'number' &&
        typeof rightValue === 'number' &&
        /(?:Start|End)$/u.test(key)
      ) {
        if (leftValue - beforeOrigin !== rightValue - afterOrigin) return false
      } else if (leftValue !== rightValue) return false
    }
    for (let index = 0; index < left.children.length; index += 1) {
      pending.push([left.children[index], right.children[index]])
    }
  }
  return true
}

const samePresentation = (before: Entry, after: Entry): boolean => {
  const left = before.binding
  const right = after.binding
  if (
    left.text !== right.text ||
    before.decorations.length !== after.decorations.length ||
    before.comments.length !== after.comments.length ||
    left.segments.length !== right.segments.length
  ) {
    return false
  }
  for (let index = 0; index < left.segments.length; index += 1) {
    const a = left.segments[index]
    const b = right.segments[index]
    if (
      a.text.start !== b.text.start ||
      a.text.end !== b.text.end ||
      a.syntax.start - left.syntax.range.start !== b.syntax.start - right.syntax.range.start ||
      a.syntax.end - left.syntax.range.start !== b.syntax.end - right.syntax.range.start
    ) {
      return false
    }
  }
  for (let index = 0; index < before.decorations.length; index += 1) {
    const a = before.decorations[index]
    const b = after.decorations[index]
    if (
      a.range.start !== b.range.start ||
      a.range.end !== b.range.end ||
      (a.sourcePosition === undefined
        ? b.sourcePosition !== undefined
        : b.sourcePosition === undefined ||
          a.sourcePosition - left.sourceRange.start !==
            b.sourcePosition - right.sourceRange.start) ||
      a.mark.kind !== b.mark.kind ||
      (a.mark.kind === 'substitution' &&
        (b.mark.kind !== 'substitution' || a.mark.arm !== b.mark.arm))
    ) {
      return false
    }
  }
  for (let index = 0; index < before.comments.length; index += 1) {
    const a = before.comments[index]
    const b = after.comments[index]
    if (
      a.offset !== b.offset ||
      a.text !== b.text ||
      a.annotationRange.start - left.sourceRange.start !==
        b.annotationRange.start - right.sourceRange.start ||
      a.annotationRange.end - left.sourceRange.start !==
        b.annotationRange.end - right.sourceRange.start
    ) {
      return false
    }
  }
  return sameSyntax(left.syntax, right.syntax)
}

/** Roots `[start, previousEnd)` of `previous`'s view are roots `[start, nextEnd)` of the new one. */
export interface MuyaMarkupPresentationPatch {
  readonly previous: Pick<MuyaMarkupView, 'bindings' | 'decorations' | 'comments'>
  readonly start: number
  readonly previousEnd: number
  readonly nextEnd: number
}

const restKey = (path: MuyaMarkupPath): string => JSON.stringify(path.slice(1))
const rootOf = (path: MuyaMarkupPath): number | undefined =>
  typeof path[0] === 'number' ? path[0] : undefined

/**
 * Index one acknowledged view. The provider looks up only its own marks and
 * retains one cached rendering per leaf; it never scans the document's marks.
 * Comparison ignores uniform coordinate shifts and never serializes an AST.
 * Given the roots a regional change replaced, only those are indexed again:
 * every other root keeps its entries, whose coordinates are refreshed from
 * the view only when the leaf renders again.
 */
export function createMuyaMarkupPresentationIndex(
  view: Pick<MuyaMarkupView, 'bindings' | 'decorations' | 'comments'>,
  previous?: MuyaMarkupPresentationIndex,
  renderer: Renderer = renderMuyaMarkupBinding,
  commentLabel = 'Comment',
  patch?: MuyaMarkupPresentationPatch
): MuyaMarkupPresentationIndex {
  const previousStore = previous === undefined ? undefined : stores.get(previous)
  const before = previousStore?.renderer === renderer ? previousStore : undefined
  const reusesComments = previousStore?.commentLabel === commentLabel
  const changedPaths: MuyaMarkupPath[] = []
  const entryFor = (binding: MuyaMarkupBinding, retained: Entry | undefined): Entry => {
    const entry: Entry = {
      binding,
      decorations: muyaItemsAtPath(view.decorations, binding.path),
      comments: muyaItemsAtPath(view.comments, binding.path),
      hasNativeWidget: hasNativeWidget(binding.syntax),
      view
    }
    if (
      retained !== undefined &&
      (entry.comments.length === 0 || reusesComments) &&
      samePresentation(retained, entry)
    ) {
      entry.rendered = retained.rendered
      if (retained.rendered !== undefined && retained.rendered.text !== binding.text) {
        changedPaths.push(binding.path)
      }
    } else changedPaths.push(binding.path)
    return entry
  }
  const beforeAt = (path: MuyaMarkupPath): Entry | undefined => {
    const root = rootOf(path)
    return root === undefined
      ? before?.others.get(pathKey(path))
      : before?.roots[root]?.get(restKey(path))
  }
  let roots: (RootEntries | undefined)[]
  let others: Map<string, Entry>
  if (
    patch !== undefined &&
    before !== undefined &&
    reusesComments &&
    before.view === patch.previous &&
    before.others.size === 0 &&
    patch.previousEnd <= before.roots.length
  ) {
    const replaced: (Map<string, Entry> | undefined)[] = []
    for (const binding of muyaItemsInRoots(view.bindings, patch.start, patch.nextEnd)) {
      const root = rootOf(binding.path)!
      const key = restKey(binding.path)
      // A replaced root is compared with the root it replaces at the same
      // place, as a full index compares leaves at the same path.
      const retained =
        root < patch.previousEnd ? before.roots[root]?.get(key) : undefined
      const group = (replaced[root - patch.start] ??= new Map())
      group.set(key, entryFor(binding, retained))
    }
    for (let root = patch.start; root < patch.previousEnd; root += 1) {
      for (const [key, entry] of before.roots[root] ?? []) {
        if (replaced[root - patch.start]?.has(key) !== true) changedPaths.push(entry.binding.path)
      }
    }
    roots = [
      ...before.roots.slice(0, patch.start),
      ...Array.from({ length: patch.nextEnd - patch.start }, (_, index) => replaced[index]),
      ...before.roots.slice(patch.previousEnd)
    ]
    others = new Map()
  } else {
    roots = []
    others = new Map()
    for (const binding of view.bindings) {
      const root = rootOf(binding.path)
      const entry = entryFor(binding, beforeAt(binding.path))
      if (root === undefined) others.set(pathKey(binding.path), entry)
      else {
        const group = (roots[root] ??= new Map()) as Map<string, Entry>
        group.set(restKey(binding.path), entry)
      }
    }
    const present = (path: MuyaMarkupPath): boolean => {
      const root = rootOf(path)
      return root === undefined
        ? others.has(pathKey(path))
        : roots[root]?.has(restKey(path)) === true
    }
    for (const group of [...(before?.roots ?? []), before?.others]) {
      for (const entry of group?.values() ?? []) {
        if (!present(entry.binding.path)) changedPaths.push(entry.binding.path)
      }
    }
  }
  const lookup = (path: MuyaMarkupPath): Entry | undefined => {
    const root = rootOf(path)
    return root === undefined ? others.get(pathKey(path)) : roots[root]?.get(restKey(path))
  }
  /**
   * A retained root's entry holds the coordinates of the view it was indexed
   * with. Its presentation and cached rendering are the same, but rendering
   * again reads its coordinates from this view.
   */
  const refreshed = (entry: Entry, path: MuyaMarkupPath): Entry | undefined => {
    if (entry.view === view) return entry
    const binding = muyaItemAtPath(view.bindings, path)
    if (binding === undefined) return undefined
    entry.binding = binding
    entry.decorations = muyaItemsAtPath(view.decorations, path)
    entry.comments = muyaItemsAtPath(view.comments, path)
    entry.view = view
    return entry
  }
  const index: MuyaMarkupPresentationIndex = {
    changedPaths,
    render(path, text, context) {
      const entry = lookup(path)
      // Mount and reconciliation can briefly expose a native placeholder
      // before its model path exists. Keep it literal: returning undefined
      // would delegate to Muya's independent inline parser.
      if (entry === undefined) return escapeHtml(text)
      // Native widgets have mutable loading/cache/selection state. Consult the
      // widget renderer on every requested patch while other leaves stay cached.
      const highlights = context?.highlights ?? []
      const cached = entry.rendered
      if (
        !entry.hasNativeWidget &&
        cached?.text === text &&
        cached.highlights.length === highlights.length &&
        cached.highlights.every(
          (previous, index) =>
            previous.start === highlights[index].start &&
            previous.end === highlights[index].end &&
            previous.active === highlights[index].active
        )
      ) {
        return cached.html
      }
      const current = refreshed(entry, path)
      if (current === undefined) return escapeHtml(text)
      const html = renderer(
        current.binding,
        current.decorations,
        text,
        context,
        current.comments,
        commentLabel
      )
      entry.rendered = { text, html, highlights: highlights.map((highlight) => ({ ...highlight })) }
      return html
    }
  }
  stores.set(index, { renderer, commentLabel, view, roots, others })
  return index
}

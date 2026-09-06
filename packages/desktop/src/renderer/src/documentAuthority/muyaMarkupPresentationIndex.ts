import type { MarkdownAstNode } from '@marktext/document-core'
import type { IInlinePresentationContext } from '@muyajs/core'
import { renderMuyaMarkupBinding } from './muyaMarkupPresentation'
import type {
  MuyaMarkupBinding,
  MuyaMarkupDecoration,
  MuyaMarkupPath,
  MuyaMarkupView
} from './muyaMarkupView'

export interface MuyaMarkupPresentationIndex {
  /** Includes removed paths, whose provider result becomes undefined. */
  readonly changedPaths: readonly MuyaMarkupPath[]
  render(path: MuyaMarkupPath, text: string, context?: IInlinePresentationContext): string | undefined
}

type Renderer = typeof renderMuyaMarkupBinding
type Highlights = NonNullable<IInlinePresentationContext['highlights']>
interface Entry {
  readonly binding: MuyaMarkupBinding
  readonly decorations: readonly MuyaMarkupDecoration[]
  readonly hasImage: boolean
  rendered?: { readonly text: string, readonly html: string, readonly highlights: Highlights }
}
const stores = new WeakMap<MuyaMarkupPresentationIndex, {
  readonly renderer: Renderer
  readonly entries: ReadonlyMap<string, Entry>
}>()
const pathKey = (path: MuyaMarkupPath): string => JSON.stringify(path)
const hasImage = (node: MarkdownAstNode): boolean => node.kind === 'image' || node.children.some(hasImage)

// These facts locate reference owners; resolved semantic values, rather than
// absolute owner positions, determine rendered output.
const referencePositions = new Set(['resolvedDefinitionStart', 'resolvedDefinitionEnd', 'definitionStart'])

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
    if (leftSpellings.length !== rightSpellings.length || leftSpellings.some((spelling, index) => {
      const other = rightSpellings[index]
      return spelling.value !== other.value ||
        spelling.range.start - beforeOrigin !== other.range.start - afterOrigin ||
        spelling.range.end - beforeOrigin !== other.range.end - afterOrigin
    })) return false
    if (left.kind !== right.kind || left.children.length !== right.children.length ||
        left.range.start - beforeOrigin !== right.range.start - afterOrigin ||
        left.range.end - beforeOrigin !== right.range.end - afterOrigin) return false
    const leftKeys = Object.keys(left.attributes).filter(key => !referencePositions.has(key))
    const rightKeys = Object.keys(right.attributes).filter(key => !referencePositions.has(key))
    if (leftKeys.length !== rightKeys.length) return false
    for (const key of leftKeys) {
      const leftValue = left.attributes[key]
      const rightValue = right.attributes[key]
      if (!Object.hasOwn(right.attributes, key)) return false
      if (typeof leftValue === 'number' && typeof rightValue === 'number' && /(?:Start|End)$/u.test(key)) {
        if (leftValue - beforeOrigin !== rightValue - afterOrigin) return false
      } else if (leftValue !== rightValue) return false
    }
    for (let index = 0; index < left.children.length; index += 1) pending.push([left.children[index], right.children[index]])
  }
  return true
}

const samePresentation = (before: Entry, after: Entry): boolean => {
  const left = before.binding
  const right = after.binding
  if (left.text !== right.text || before.decorations.length !== after.decorations.length ||
      left.segments.length !== right.segments.length) return false
  for (let index = 0; index < left.segments.length; index += 1) {
    const a = left.segments[index]
    const b = right.segments[index]
    if (a.text.start !== b.text.start || a.text.end !== b.text.end ||
        a.syntax.start - left.syntax.range.start !== b.syntax.start - right.syntax.range.start ||
        a.syntax.end - left.syntax.range.start !== b.syntax.end - right.syntax.range.start) return false
  }
  for (let index = 0; index < before.decorations.length; index += 1) {
    const a = before.decorations[index]
    const b = after.decorations[index]
    if (a.range.start !== b.range.start || a.range.end !== b.range.end || a.mark.kind !== b.mark.kind ||
        (a.mark.kind === 'substitution' && (b.mark.kind !== 'substitution' || a.mark.arm !== b.mark.arm))) return false
  }
  return sameSyntax(left.syntax, right.syntax)
}

/**
 * Index one acknowledged view. The provider looks up only its own marks and
 * retains one cached rendering per leaf; it never scans the document's marks.
 * Comparison ignores uniform coordinate shifts and never serializes an AST.
 */
export function createMuyaMarkupPresentationIndex(
  view: Pick<MuyaMarkupView, 'bindings' | 'decorations'>,
  previous?: MuyaMarkupPresentationIndex,
  renderer: Renderer = renderMuyaMarkupBinding
): MuyaMarkupPresentationIndex {
  const previousStore = previous === undefined ? undefined : stores.get(previous)
  const before = previousStore?.renderer === renderer ? previousStore.entries : undefined
  const decorations = new Map<string, MuyaMarkupDecoration[]>()
  for (const decoration of view.decorations) {
    const key = pathKey(decoration.path)
    const group = decorations.get(key)
    if (group === undefined) decorations.set(key, [decoration])
    else group.push(decoration)
  }
  const entries = new Map<string, Entry>()
  const changedPaths: MuyaMarkupPath[] = []
  for (const binding of view.bindings) {
    const key = pathKey(binding.path)
    const entry: Entry = { binding, decorations: decorations.get(key) ?? [], hasImage: hasImage(binding.syntax) }
    const retained = before?.get(key)
    if (retained !== undefined && samePresentation(retained, entry)) {
      entry.rendered = retained.rendered
      if (retained.rendered !== undefined && retained.rendered.text !== binding.text) changedPaths.push(binding.path)
    } else changedPaths.push(binding.path)
    entries.set(key, entry)
  }
  for (const [key, entry] of before ?? []) {
    if (!entries.has(key)) changedPaths.push(entry.binding.path)
  }
  const index: MuyaMarkupPresentationIndex = {
    changedPaths,
    render(path, text, context) {
      const entry = entries.get(pathKey(path))
      if (entry === undefined) return undefined
      // Native images have mutable loading/cache/selection state. Consult the
      // widget renderer on every requested patch while other leaves stay cached.
      const highlights = context?.highlights ?? []
      const cached = entry.rendered
      if (!entry.hasImage && cached?.text === text && cached.highlights.length === highlights.length &&
          cached.highlights.every((previous, index) => previous.start === highlights[index].start &&
            previous.end === highlights[index].end && previous.active === highlights[index].active)) return cached.html
      const html = context === undefined
        ? renderer(entry.binding, entry.decorations, text)
        : renderer(entry.binding, entry.decorations, text, context)
      entry.rendered = { text, html, highlights: highlights.map(highlight => ({ ...highlight })) }
      return html
    }
  }
  stores.set(index, { renderer, entries })
  return index
}

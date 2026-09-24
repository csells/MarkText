import type { SourceRange } from '@marktext/document-core'
import {
  createMuyaNormalizedTextValidator,
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

/** Validates source coordinates, including model-owned text normalization. */
export function assertMuyaDocumentSourceBinding(binding: MuyaPlainTextSourceBinding): void {
  const blockIndex = binding.path[0]
  const field = binding.path.at(-1)
  const { start, end } = binding.sourceRange
  if (
    typeof blockIndex !== 'number' ||
    !Number.isSafeInteger(blockIndex) ||
    blockIndex < 0 ||
    (field !== 'text' && !(field === 'lang' && binding.path.at(-2) === 'meta')) ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    (binding.segments === undefined && end - start !== binding.text.length)
  ) {
    throw new RangeError('Muya plain-text source binding is invalid')
  }
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

import { isPositionalMarkdownAttribute } from '@marktext/document-core'
import type {
  CommentMarkupProjection,
  CriticMarkupAnnotation,
  CriticMarkupArm,
  MarkdownAst,
  MarkdownAstNode,
  MarkupSyntax,
  ProjectionCoordinateMap,
  SourceRange
} from '@marktext/document-core'

/** One CriticMarkup arm, located in its Markup syntax's projected coordinates. */
export type MarkupPassageMark = Readonly<{
  readonly start: number
  readonly end: number
  readonly kind: 'addition' | 'deletion' | 'highlight' | 'substitution'
  readonly arm?: 'old' | 'new'
}>

/**
 * A passage as the Markup view shows it: Core's Markup syntax with the
 * suggestions and highlights over it. Every position is in that syntax's
 * projected coordinates, so presenting it reads no source and recognizes no
 * delimiters.
 */
export type MarkupPassage = Readonly<{
  readonly ast: MarkdownAst
  /** Outer marks precede the marks nested in them. */
  readonly marks: readonly MarkupPassageMark[]
  /** The part of the syntax the passage presents; all of it when absent. */
  readonly range?: SourceRange
}>

const projectedArm = (
  coordinates: ProjectionCoordinateMap,
  arm: CriticMarkupArm
): SourceRange => ({
  start: coordinates.toProjected(arm.range.start, 'next'),
  end: coordinates.toProjected(arm.range.end, 'previous')
})

const collectMarks = (
  coordinates: ProjectionCoordinateMap,
  annotation: CriticMarkupAnnotation,
  marks: MarkupPassageMark[]
): void => {
  // A nested Comment's payload is hidden from the Markup view, marks and all.
  if (annotation.kind === 'comment') return
  for (const arm of annotation.arms) {
    const { start, end } = projectedArm(coordinates, arm)
    if (end > start) {
      marks.push(
        Object.freeze({
          start,
          end,
          kind: annotation.kind,
          ...(annotation.kind === 'substitution' && (arm.name === 'old' || arm.name === 'new')
            ? { arm: arm.name }
            : {})
        })
      )
    }
    for (const nested of arm.annotations) collectMarks(coordinates, nested, marks)
  }
}

// Keeps the ancestors of whatever the range touches, so the passage keeps the
// formatting it has in the document. Text is clipped when it is presented.
// Positions become relative to `base`, the start of the passage's first
// block, so a passage reads the same wherever an edit moves its block;
// positions outside `[0, end]`, such as a reference's definition elsewhere in
// the document, are left out.
const localized = (
  node: MarkdownAstNode,
  range: SourceRange,
  base: number,
  end: number
): MarkdownAstNode | undefined => {
  if (!(node.range.start < range.end && node.range.end > range.start)) return undefined
  let low = 0
  let high = node.children.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (node.children[middle]!.range.end <= range.start) low = middle + 1
    else high = middle
  }
  const children: MarkdownAstNode[] = []
  for (let index = low; index < node.children.length; index += 1) {
    const child = node.children[index]!
    if (child.range.start >= range.end) break
    const kept = localized(child, range, base, end)
    if (kept !== undefined) children.push(kept)
  }
  let attributes: Record<string, MarkdownAstNode['attributes'][string]> | undefined
  for (const key in node.attributes) {
    const value = node.attributes[key]
    if (typeof value !== 'number' || !isPositionalMarkdownAttribute(key)) continue
    attributes ??= { ...node.attributes }
    if (value - base < 0 || value - base > end) delete attributes[key]
    else attributes[key] = value - base
  }
  return Object.freeze({
    ...node,
    range: Object.freeze({ start: node.range.start - base, end: node.range.end - base }),
    attributes: attributes === undefined ? node.attributes : Object.freeze(attributes),
    ...(node.semanticTextSegments === undefined
      ? {}
      : {
        semanticTextSegments: Object.freeze(node.semanticTextSegments.map((segment) => Object.freeze({
          ...segment,
          range: Object.freeze({ start: segment.range.start - base, end: segment.range.end - base })
        })))
      }),
    children: Object.freeze(children)
  })
}

/**
 * One arm of a document annotation, with the suggestions nested in it, as
 * the Markup syntax of the arm's blocks presents it. The passage's positions
 * start at its first block.
 */
export const documentArmPassage = (
  syntax: MarkupSyntax,
  annotation: CriticMarkupAnnotation,
  arm: CriticMarkupArm
): MarkupPassage => {
  const { coordinates, ast } = syntax
  const range = projectedArm(coordinates, arm)
  const marks: MarkupPassageMark[] = []
  collectMarks(coordinates, { ...annotation, arms: [arm] }, marks)
  // Top-level blocks are in document order; find the arm's by bisection,
  // since every sidebar entry reads the whole document's syntax.
  const roots = ast.root.children
  let low = 0
  let high = roots.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (roots[middle]!.range.end <= range.start) low = middle + 1
    else high = middle
  }
  const blocks: MarkdownAstNode[] = []
  for (let index = low; index < roots.length && roots[index]!.range.start < range.end; index += 1) {
    blocks.push(roots[index]!)
  }
  const base = blocks[0]?.range.start ?? range.start
  const end = (blocks.at(-1)?.range.end ?? range.end) - base
  const children = blocks.flatMap((block) => localized(block, range, base, end) ?? [])
  return Object.freeze({
    ast: Object.freeze({
      root: Object.freeze({
        kind: 'document',
        range: Object.freeze({ start: 0, end }),
        attributes: Object.freeze({}),
        children: Object.freeze(children)
      })
    }),
    marks: Object.freeze(
      marks.map((mark) => Object.freeze({ ...mark, start: mark.start - base, end: mark.end - base }))
    ),
    range: Object.freeze({ start: range.start - base, end: range.end - base })
  })
}

/** A whole Comment payload in its Markup reading. */
export const commentPassage = (
  projection: CommentMarkupProjection,
  comment: CriticMarkupAnnotation
): MarkupPassage => {
  const { coordinates, ast } = projection.syntax
  const marks: MarkupPassageMark[] = []
  for (const arm of comment.arms) {
    for (const nested of arm.annotations) collectMarks(coordinates, nested, marks)
  }
  return Object.freeze({ ast, marks: Object.freeze(marks) })
}

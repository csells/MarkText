import type {
  CommentMarkupProjection,
  CriticMarkupAnnotation,
  CriticMarkupArm,
  MarkdownAst,
  MarkdownAstNode,
  MarkupProjection,
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
const pruneTo = (node: MarkdownAstNode, range: SourceRange): MarkdownAstNode | undefined => {
  if (node.kind !== 'document' && !(node.range.start < range.end && node.range.end > range.start)) {
    return undefined
  }
  if (node.children.length === 0) return node
  // Children are in document order; skip those that end before the range
  // without visiting them, since every sidebar entry prunes the whole document.
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
    const kept = pruneTo(child, range)
    if (kept !== undefined) children.push(kept)
  }
  return Object.freeze({ ...node, children: Object.freeze(children) })
}

/** One arm of a document annotation, with the suggestions nested in it. */
export const documentArmPassage = (
  markup: MarkupProjection,
  annotation: CriticMarkupAnnotation,
  arm: CriticMarkupArm
): MarkupPassage => {
  const { coordinates, ast } = markup.syntax
  const range = projectedArm(coordinates, arm)
  const marks: MarkupPassageMark[] = []
  collectMarks(coordinates, { ...annotation, arms: [arm] }, marks)
  const root = pruneTo(ast.root, range) ?? ast.root
  return Object.freeze({
    ast: Object.freeze({ root }),
    marks: Object.freeze(marks),
    range: Object.freeze(range)
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

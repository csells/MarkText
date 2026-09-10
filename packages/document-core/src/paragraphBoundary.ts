import type { CriticMarkupAnnotation, MarkdownAstNode, SourceRange } from './documentCore.js'

/** A lone HTML image uses MarkText's inline image editor, not its HTML editor.
 * The HTML grammar emits tag facts for a block only when it contains one tag.
 */
export function paragraphImageRange(node: MarkdownAstNode): SourceRange | undefined {
  return node.kind === 'html-block' && node.attributes.tagName === 'img' && node.attributes.closingTag !== true
    ? { start: Number(node.attributes.tagStart), end: Number(node.attributes.tagEnd) }
    : undefined
}

/** Source boundary for formatting the entire parser-owned paragraph. */
export function paragraphPrefixPosition(roots: readonly CriticMarkupAnnotation[], range: SourceRange): number | undefined {
  const visible: CriticMarkupAnnotation[] = []
  const pending = [...roots].reverse()
  while (pending.length > 0) {
    const annotation = pending.pop()
    if (annotation === undefined) break
    visible.push(annotation)
    if (annotation.kind !== 'comment') for (const arm of annotation.arms) pending.push(...[...arm.annotations].reverse())
  }
  const containing = visible.filter(annotation => annotation.range.start <= range.start && annotation.range.end > range.start)
  if (containing.every(annotation => annotation.kind === 'addition' || annotation.kind === 'highlight')) {
    let position = Math.min(range.start, ...containing.map(annotation => annotation.range.start))
    for (const annotation of [...visible].reverse()) {
      if (annotation.kind === 'comment' && annotation.range.end === position) position = annotation.range.start
    }
    return position
  }
  const shared = containing.filter(annotation => {
    const [oldArm, newArm] = annotation.arms
    return annotation.kind === 'substitution' && annotation.arms.length === 2 &&
      oldArm !== undefined && newArm !== undefined && oldArm.range.start === range.start &&
      newArm.range.end <= range.end
  })
  const position = Math.min(range.start, ...shared.map(annotation => annotation.range.start))
  // Shared inline arms belong to one paragraph. Independently rendered or
  // deleted paragraphs retain their own arm boundary.
  return containing.every(annotation => shared.includes(annotation) || annotation.arms.some(arm =>
    arm.range.start <= position && arm.range.end >= range.end))
    ? position
    : undefined
}

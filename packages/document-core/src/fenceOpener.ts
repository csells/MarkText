import type { DocumentCore, DocumentRevision, MarkdownAstNode, MarkupSyntax } from './documentCore.js'
import { DIAGRAM_FENCE_LANGUAGES } from './internal/profile1/markdownLaneState.js'

/** The diagram type upstream makes of a fence language, if any. */
export function fenceDiagramType(language: string): string | undefined {
  return DIAGRAM_FENCE_LANGUAGES.has(language) ? language : undefined
}

/**
 * The spaces, one to three, that indent a fence opener within its innermost
 * container. Upstream converts the opener line's text without them and
 * writes the new block at the container's own indentation.
 */
export function fenceOpenerOwnIndent(
  core: DocumentCore, revision: DocumentRevision, syntax: MarkupSyntax, containers: readonly MarkdownAstNode[], openerStart: number
): number {
  const lineStartOf = (offset: number): number => {
    const before = core.sourceSlice(revision, { start: Math.max(0, offset - 256), end: offset })
    return offset - before.length + Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r')) + 1
  }
  const line = core.sourceSlice(revision, { start: lineStartOf(openerStart), end: openerStart })
  const container = [...containers].reverse()
    .find(node => node.kind === 'list-item' || node.kind === 'blockquote' || node.kind === 'footnote-definition')
  let baseline = 0
  if (container?.kind === 'blockquote') {
    const quote = line.lastIndexOf('>')
    baseline = quote + 1 + (line[quote + 1] === ' ' || line[quote + 1] === '\t' ? 1 : 0)
  } else if (container !== undefined) {
    const first = container.children[0]
    const firstStart = first === undefined ? openerStart : syntax.coordinates.toSource(first.range.start, 'next')
    baseline = firstStart - lineStartOf(firstStart)
  }
  const indent = line.length - baseline
  return indent > 0 && indent <= 3 && /^ +$/u.test(line.slice(baseline)) ? indent : 0
}

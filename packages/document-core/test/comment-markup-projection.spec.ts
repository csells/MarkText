import { describe, expect, it } from 'vitest'

import {
  createDocumentCore,
  type CriticMarkupAnnotation,
  type MarkdownAstNode
} from '../src/index.js'

const semanticTextOf = (node: MarkdownAstNode): string =>
  node.kind === 'text'
    ? String(node.attributes['semanticText'])
    : node.kind === 'inline-code'
      ? String(node.attributes['semanticContent'])
      : node.children.map(semanticTextOf).join('')

const textNodes = (node: MarkdownAstNode): MarkdownAstNode[] =>
  node.kind === 'text' ? [node] : node.children.flatMap(textNodes)

const commentOf = (annotations: readonly CriticMarkupAnnotation[]): CriticMarkupAnnotation => {
  const comment = annotations.find(annotation => annotation.kind === 'comment')
  if (comment === undefined) throw new Error('Expected a Comment')
  return comment
}

describe('Comment Markup projection', () => {
  const payload = 'Comment with {--nested deletion--}, {~~old~>new~~} and `{++code++}`{>>hidden<<}.'
  const source = `Before{>>${payload}<<} after.\n`

  it('reads a Comment payload with its nested suggestion arms, as the Markup view reads text', () => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const comment = commentOf(revision.annotations)
    const markup = core.projectComment(revision, comment, 'markup')

    expect(markup.kind).toBe('comment-markup')
    expect(markup.annotationRange).toEqual(comment.range)
    expect(semanticTextOf(markup.syntax.ast.root)).toBe(
      'Comment with nested deletion, oldnew and {++code++}.'
    )
    // The Revised reading still omits what the suggestions remove.
    expect(semanticTextOf(core.projectComment(revision, comment).ast.root)).toBe(
      'Comment with , new and {++code++}.'
    )
    expect(core.projectComment(revision, comment, 'markup')).toBe(markup)
  })

  it('locates each nested arm in the payload syntax through its coordinates', () => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const comment = commentOf(revision.annotations)
    const { ast, coordinates } = core.projectComment(revision, comment, 'markup').syntax
    const [text] = textNodes(ast.root)
    if (text === undefined) throw new Error('Expected payload text')
    const payloadArm = comment.arms[0]
    const nested = payloadArm?.annotations ?? []
    expect(nested.map(annotation => annotation.kind)).toEqual(['deletion', 'substitution', 'comment'])
    const armTexts = nested.slice(0, 2).flatMap(annotation =>
      annotation.arms.map(arm =>
        String(text.attributes['semanticText']).slice(
          coordinates.toProjected(arm.range.start, 'next') - text.range.start,
          coordinates.toProjected(arm.range.end, 'previous') - text.range.start
        )
      )
    )
    expect(armTexts).toEqual(['nested deletion', 'old', 'new'])
  })

  it('reads a Comment of an edited revision', () => {
    const core = createDocumentCore()
    const opened = core.open(`Intro.\n\n${source}`)
    const commit = core.apply(opened, [{ start: 5, end: 5, insert: ' text' }])
    const comment = commentOf(commit.revision.annotations)
    expect(semanticTextOf(core.projectComment(commit.revision, comment, 'markup').syntax.ast.root))
      .toBe('Comment with nested deletion, oldnew and {++code++}.')
  })

  it('refuses an annotation that is not a Comment and an unknown reading', () => {
    const core = createDocumentCore()
    const revision = core.open('{++added++}{>>note<<}\n')
    const [addition, comment] = revision.annotations
    if (addition === undefined || comment === undefined) throw new Error('Expected two annotations')
    expect(() => core.projectComment(revision, addition, 'markup')).toThrow(RangeError)
    expect(() =>
      (core.projectComment as (...args: unknown[]) => unknown)(revision, comment, 'original')
    ).toThrow(RangeError)
  })
})

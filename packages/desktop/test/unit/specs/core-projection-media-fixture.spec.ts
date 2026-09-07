import { createDocumentCore, type MarkdownAstNode } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { criticMarkupProjectionMediaSource } from '../../fixtures/criticmarkupProjectionMedia'

const kinds = (node: MarkdownAstNode): string[] => [node.kind, ...node.children.flatMap(kinds)]

describe('integrated media fixture parse control', () => {
  it('contains one isolated Comment with math and both image forms', () => {
    const core = createDocumentCore()
    const revision = core.open(criticMarkupProjectionMediaSource)
    const comments = revision.annotations.filter((annotation) => annotation.kind === 'comment')
    expect(comments).toHaveLength(1)
    const comment = core.projectComment(revision, comments[0])
    expect(kinds(comment.ast.root)).toContain('inline-math')
    expect(kinds(comment.ast.root)).toContain('image')
    expect(kinds(comment.ast.root)).toContain('html-block')
  })
})

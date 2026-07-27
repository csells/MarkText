import { freezeDocumentCoreReviewIndex } from '@shared/types/documentCore'
import { describe, expect, it } from 'vitest'

const authoring = Object.freeze({
  canCreateAddition: false,
  canCreateDeletion: false,
  canCreateSubstitution: false,
  canCreateHighlight: false,
  canCreateComment: false
})

const valid = Object.freeze({
  authoring,
  items: Object.freeze([
    Object.freeze({
      nodeId: 'highlight:1',
      kind: 'highlight',
      sourceRange: Object.freeze({ start: 0, end: 1 }),
      modelRange: Object.freeze({ start: 0, end: 1 }),
      focusOffset: 0,
      depth: 0,
      parent: null,
      commentRevisedText: null,
      oldContent: null,
      newContent: null
    }),
    Object.freeze({
      nodeId: 'comment:1',
      kind: 'comment',
      sourceRange: Object.freeze({ start: 1, end: 2 }),
      modelRange: null,
      focusOffset: 1,
      depth: 0,
      parent: null,
      commentRevisedText: 'note',
      oldContent: null,
      newContent: null
    })
  ]),
  commentedSpans: Object.freeze([
    Object.freeze({
      highlight: 'highlight:1',
      comment: 'comment:1',
      sourceRange: Object.freeze({ start: 0, end: 2 }),
      modelRange: Object.freeze({ start: 0, end: 1 })
    })
  ])
})

describe('document-core Review index wire authority', () => {
  it('rejects ranges outside the authenticated source and model', () => {
    expect(() => freezeDocumentCoreReviewIndex({
      ...valid,
      items: valid.items.map((item, index) => index === 0
        ? {
          ...item,
          sourceRange: { start: 999, end: 1_000 },
          focusOffset: 999
        }
        : item)
    }, 2, 1)).toThrow(/source range|focus|coordinate/i)
  })

  it('rejects duplicate, dangling, and cyclic parent topology', () => {
    expect(() => freezeDocumentCoreReviewIndex({
      ...valid,
      items: valid.items.map(item => ({
        ...item,
        nodeId: 'duplicate'
      })),
      commentedSpans: []
    }, 2, 1)).toThrow(/duplicate/i)

    expect(() => freezeDocumentCoreReviewIndex({
      ...valid,
      items: [{
        ...valid.items[0],
        depth: 1,
        parent: 'missing'
      }],
      commentedSpans: []
    }, 2, 1)).toThrow(/parent|topology/i)

    expect(() => freezeDocumentCoreReviewIndex({
      ...valid,
      items: [{
        ...valid.items[0],
        depth: 1,
        parent: 'highlight:1'
      }],
      commentedSpans: []
    }, 2, 1)).toThrow(/parent|cycle|topology/i)
  })

  it('proves every commented span references an adjacent Highlight and Comment', () => {
    expect(freezeDocumentCoreReviewIndex(valid, 2, 1)).toEqual(valid)
    expect(() => freezeDocumentCoreReviewIndex({
      ...valid,
      commentedSpans: [{
        ...valid.commentedSpans[0],
        comment: 'highlight:1'
      }]
    }, 2, 1)).toThrow(/commented span|Highlight|Comment/i)
  })
})

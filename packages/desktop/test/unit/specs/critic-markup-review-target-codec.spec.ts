import { describe, expect, it } from 'vitest'
import {
  decodeCriticMarkupCommentEditRequest,
  decodeCriticMarkupCommandTarget,
  decodeCriticMarkupEditorContextRequest,
  decodeCriticMarkupEditorContextResponse,
  decodeCriticMarkupSidebarItemAction
} from '@shared/types/criticMarkup'

const target = Object.freeze({
  revisionId: 'revision:7',
  nodeId: 'critic:comment:4'
})

describe('CriticMarkup Review command identity codec', () => {
  it('accepts only the exact revision and parser NodeId pair', () => {
    expect(decodeCriticMarkupCommandTarget(target)).toEqual(target)

    for (const malformed of [
      { nodeId: target.nodeId },
      { revisionId: target.revisionId },
      { ...target, revisionId: '' },
      { ...target, nodeId: '' },
      { ...target, sourceStart: 12 },
      { ...target, nodeId: `${target.nodeId}\0forged` },
      Object.assign(Object.create(null), target)
    ]) {
      expect(
        () => decodeCriticMarkupCommandTarget(malformed),
        JSON.stringify(malformed)
      ).toThrow()
    }
  })

  it('requires document identity and a closed target on sidebar commands', () => {
    const command = {
      documentId: 'document:active',
      action: 'accept' as const,
      target
    }
    expect(decodeCriticMarkupSidebarItemAction(command)).toEqual(command)

    for (const malformed of [
      { ...command, documentId: '' },
      { ...command, fileId: 'document:active' },
      { ...command, action: 'unknown' },
      { ...command, target: { ...target, sourceStart: 4 } },
      { ...command, extra: true }
    ]) {
      expect(
        () => decodeCriticMarkupSidebarItemAction(malformed),
        JSON.stringify(malformed)
      ).toThrow()
    }
  })

  it('closes the native comment-menu round trip over command identity only', () => {
    const edit = {
      documentId: 'document:active',
      target
    }
    expect(decodeCriticMarkupCommentEditRequest(edit)).toEqual(edit)
    expect(decodeCriticMarkupEditorContextResponse({
      requestId: 'request:1',
      ...edit
    })).toEqual({
      requestId: 'request:1',
      ...edit
    })
    expect(decodeCriticMarkupEditorContextResponse({
      requestId: 'request:2',
      documentId: null,
      target: null
    })).toEqual({
      requestId: 'request:2',
      documentId: null,
      target: null
    })

    for (const malformed of [
      { fileId: edit.documentId, target },
      { ...edit, target: { ...target, sourceStart: 0 } },
      { ...edit, display: { raw: '{>>not authority<<}' } },
      { requestId: 'request:3', ...edit, extra: true },
      { requestId: 'request:4', documentId: null, target },
      { requestId: 'request:5', documentId: edit.documentId, target: null }
    ]) {
      expect(
        () => 'requestId' in malformed
          ? decodeCriticMarkupEditorContextResponse(malformed)
          : decodeCriticMarkupCommentEditRequest(malformed),
        JSON.stringify(malformed)
      ).toThrow()
    }
  })

  it('closes the native point query before any hit testing', () => {
    const query = { requestId: 'request:1', x: 41, y: 73 }
    expect(decodeCriticMarkupEditorContextRequest(query)).toEqual(query)

    for (const malformed of [
      { ...query, x: Number.NaN },
      { ...query, y: Number.POSITIVE_INFINITY },
      { ...query, x: 1.5 },
      { ...query, requestId: '' },
      { ...query, extra: true }
    ]) {
      expect(() => decodeCriticMarkupEditorContextRequest(malformed)).toThrow()
    }
  })
})

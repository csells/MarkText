import { describe, expect, it } from 'vitest'
import {
  decodeDocumentCoreAttachRequest,
  decodeDocumentCoreLifecycleIntent,
  decodeDocumentCoreRelocateRequest,
  decodeDocumentCoreResolveExternalChangeRequest,
  decodeDocumentCoreSaveRequest
} from 'main_renderer/ipc/documentFileRuntimeCodec'

describe('closed document file IPC codec', () => {
  it('admits only an opaque identity for renderer attachment', () => {
    expect(decodeDocumentCoreAttachRequest({
      documentId: 'document:1'
    })).toEqual({ documentId: 'document:1' })

    for (const forbidden of [
      { source: '# forged' },
      { durabilityKey: 'renderer-journal' },
      { parseConfiguration: {} },
      { pathname: '/tmp/forged.md' }
    ]) {
      expect(() => decodeDocumentCoreAttachRequest({
        documentId: 'document:1',
        ...forbidden
      })).toThrow(/closed/i)
    }
  })

  it('admits only document identity and a closed save mode', () => {
    for (const mode of ['save', 'save-as', 'autosave'] as const) {
      expect(decodeDocumentCoreSaveRequest({
        documentId: 'document:1',
        mode
      })).toEqual({ documentId: 'document:1', mode })
    }

    for (const forbidden of [
      { source: '# forged' },
      { markdown: '# forged' },
      { revisionId: 'revision:forged' },
      { pathname: '/tmp/forged.md' },
      { encoding: 'utf-8' },
      { options: {} }
    ]) {
      expect(() => decodeDocumentCoreSaveRequest({
        documentId: 'document:1',
        mode: 'save',
        ...forbidden
      })).toThrow(/closed/i)
    }
    expect(() => decodeDocumentCoreSaveRequest({
      documentId: 'document:1',
      mode: 'overwrite'
    })).toThrow(/mode/i)
  })

  it('rejects malformed and unsafe identities before host lookup', () => {
    for (const request of [
      null,
      [],
      {},
      { documentId: '', mode: 'save' },
      { documentId: 'document\u00001', mode: 'save' },
      { documentId: 'document:1' }
    ]) {
      expect(() => decodeDocumentCoreSaveRequest(request)).toThrow()
    }
  })

  it('admits semantic lifecycle intent without renderer dirty or target lists', () => {
    for (const intent of [
      { kind: 'save-all' },
      { kind: 'close-saved' },
      { kind: 'close-all' },
      { kind: 'close-window' },
      { kind: 'close-document', documentId: 'document:1' },
      { kind: 'close-others', keepDocumentId: 'document:1' }
    ]) {
      expect(decodeDocumentCoreLifecycleIntent(intent)).toEqual(intent)
    }

    for (const intent of [
      null,
      {},
      { kind: 'save-all', documentIds: ['document:1'] },
      { kind: 'close-all', dirtyDocumentIds: ['document:1'] },
      { kind: 'close-window', isSaved: true },
      { kind: 'close-document' },
      { kind: 'close-document', documentId: '' },
      { kind: 'close-document', documentId: 'document:1', pathname: '/tmp/x' },
      { kind: 'close-others', keepDocumentId: 'document\u00001' },
      { kind: 'unknown' }
    ]) {
      expect(() => decodeDocumentCoreLifecycleIntent(intent)).toThrow()
    }
  })

  it('admits only identity plus an explicit external-change decision', () => {
    for (const resolution of ['reload', 'keep'] as const) {
      expect(decodeDocumentCoreResolveExternalChangeRequest({
        documentId: 'document:1',
        resolution
      })).toEqual({
        documentId: 'document:1',
        resolution
      })
    }
    for (const request of [
      { documentId: 'document:1', resolution: 'overwrite' },
      {
        documentId: 'document:1',
        resolution: 'reload',
        source: 'forged'
      },
      {
        documentId: 'document:1',
        resolution: 'keep',
        pathname: '/tmp/forged.md'
      }
    ]) {
      expect(() => decodeDocumentCoreResolveExternalChangeRequest(request))
        .toThrow()
    }
  })

  it('admits only identity plus a closed semantic relocation intent', () => {
    expect(decodeDocumentCoreRelocateRequest({
      documentId: 'document:1',
      intent: {
        kind: 'rename',
        filename: 'renamed.md'
      }
    })).toEqual({
      documentId: 'document:1',
      intent: {
        kind: 'rename',
        filename: 'renamed.md'
      }
    })
    expect(decodeDocumentCoreRelocateRequest({
      documentId: 'document:1',
      intent: { kind: 'move-to' }
    })).toEqual({
      documentId: 'document:1',
      intent: { kind: 'move-to' }
    })

    for (const forbidden of [
      { pathname: '/tmp/forged.md' },
      { sourcePathname: '/tmp/source.md' },
      { targetPathname: '/tmp/target.md' },
      { source: '# forged' },
      { revisionId: 'revision:forged' },
      { currentFile: {} }
    ]) {
      expect(() => decodeDocumentCoreRelocateRequest({
        documentId: 'document:1',
        intent: { kind: 'move-to' },
        ...forbidden
      })).toThrow(/closed/i)
    }

    for (const intent of [
      { kind: 'move-to', pathname: '/tmp/forged.md' },
      { kind: 'rename', filename: '../escape.md' },
      { kind: 'rename', filename: 'child/escape.md' },
      { kind: 'rename', filename: 'child\\escape.md' },
      { kind: 'rename', filename: '.' },
      { kind: 'rename', filename: '..' },
      { kind: 'rename', filename: 'bad\u0000.md' },
      { kind: 'rename' },
      { kind: 'replace', filename: 'renamed.md' }
    ]) {
      expect(() => decodeDocumentCoreRelocateRequest({
        documentId: 'document:1',
        intent
      })).toThrow()
    }
  })
})

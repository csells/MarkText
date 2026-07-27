import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type {
  DocumentCoreExportOptions,
  DocumentCoreStaticSinkReceipt
} from '@shared/types/documentCore'
import {
  createDocumentCoreStaticSinkAcceptanceSurface,
  type DocumentCoreStaticSinkAcceptanceRequest
} from 'main_renderer/documentCore/staticSinkAcceptanceSurface'
import type {
  DocumentCoreResolvedStaticSinkRequest
} from 'main_renderer/documentCore/staticSinkHost'

const exportOptions: DocumentCoreExportOptions = Object.freeze({
  title: 'Review',
  page: Object.freeze({
    size: Object.freeze({ kind: 'named', name: 'A4' }),
    landscape: false,
    marginsMm: Object.freeze({
      top: 20,
      right: 15,
      bottom: 20,
      left: 15
    })
  }),
  theme: Object.freeze({ kind: 'built-in', name: 'default' }),
  typography: null,
  autoNumberHeadings: false,
  showFrontMatter: false,
  toc: Object.freeze({ title: '', includeTopHeading: true }),
  header: null,
  footer: null,
  headerFooterAppearance: null
})

const requestBase = Object.freeze({
  documentId: 'document:1',
  revisionId: 'revision:1',
  view: 'markup' as const,
  options: exportOptions
})

describe('main-only static sink acceptance surface', () => {
  it.each([
    {
      ...requestBase,
      consumer: 'styled-html',
      targetPath: path.resolve('artifacts', 'review.html')
    },
    {
      ...requestBase,
      consumer: 'pdf',
      targetPath: path.resolve('artifacts', 'review.pdf')
    },
    {
      ...requestBase,
      consumer: 'print',
      proofPath: path.resolve('artifacts', 'print-proof.pdf')
    }
  ] satisfies readonly DocumentCoreStaticSinkAcceptanceRequest[])(
    'delegates $consumer to the shared static sink host for an attached owner',
    async(request) => {
      const resolveOwner = vi.fn(() => 'renderer:41')
      const receipt = {
        schema: 'document-core-static-sink-receipt-1' as const,
        kind: 'written' as const,
        consumer: 'pdf' as const,
        view: 'markup' as const,
        revisionId: 'revision:1',
        sourceHash: 'source-sha256:acceptance' as const,
        targetPath: path.resolve('artifacts', 'result.pdf'),
        bytes: 100
      } as unknown as DocumentCoreStaticSinkReceipt
      const executeStaticSink = vi.fn(async(
        _ownerId: string,
        _request: DocumentCoreResolvedStaticSinkRequest
      ) => receipt)
      const surface = createDocumentCoreStaticSinkAcceptanceSurface(
        resolveOwner,
        executeStaticSink
      )

      await surface.execute(41, request)

      expect(resolveOwner).toHaveBeenCalledWith(41)
      expect(executeStaticSink).toHaveBeenCalledWith(
        'renderer:41',
        request
      )
      expect(Object.isFrozen(executeStaticSink.mock.calls[0]?.[1])).toBe(true)
    }
  )

  it('rejects relative artifact paths before resolving an owner or host', async() => {
    const resolveOwner = vi.fn(() => 'renderer:41')
    const executeStaticSink = vi.fn()
    const surface = createDocumentCoreStaticSinkAcceptanceSurface(
      resolveOwner,
      executeStaticSink
    )

    await expect(surface.execute(41, {
      ...requestBase,
      consumer: 'styled-html',
      targetPath: 'renderer-chosen.html'
    })).rejects.toThrow(/absolute|artifact|path/i)
    await expect(surface.execute(41, {
      ...requestBase,
      consumer: 'print',
      proofPath: 'renderer-chosen.pdf'
    })).rejects.toThrow(/absolute|artifact|path/i)

    expect(resolveOwner).not.toHaveBeenCalled()
    expect(executeStaticSink).not.toHaveBeenCalled()
  })
})

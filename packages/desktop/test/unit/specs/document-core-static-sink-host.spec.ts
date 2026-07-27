import {
  WireEnvelopeCodecV1,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentCoreExportOptions } from '@shared/types/documentCore'
import { createFileDocumentSessionJournalStorage } from 'main_renderer/documentCore/durableSessionJournalStorage'
import {
  decodeDocumentCorePublication,
  type DocumentCoreMainSessionHost
} from 'main_renderer/documentCore/mainSessionHost'
import {
  createTestDocumentCoreMainSessionHost as createDocumentCoreMainSessionHost
} from '../helpers/documentSessionHost'
import {
  createDocumentCoreStaticSinkHost,
  type DocumentCoreStaticSinkSurface
} from 'main_renderer/documentCore/staticSinkHost'
import {
  createDocumentCoreExportDecorator,
  type DocumentCorePdfPageOptions
} from 'main_renderer/documentCore/exportDecorator'

const configuration: ParseConfiguration = Object.freeze({
  markdownProfile: 'markdown-profile-1',
  criticMarkupProfile: 'marktext-profile-1',
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  markdownOptions: Object.freeze({
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  }),
  executionBudget: Object.freeze({
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  })
})

const exportOptions = Object.freeze({
  title: 'Review',
  page: Object.freeze({
    size: Object.freeze({
      kind: 'named' as const,
      name: 'A4' as const
    }),
    landscape: false,
    marginsMm: Object.freeze({
      top: 20,
      right: 15,
      bottom: 20,
      left: 15
    })
  }),
  theme: Object.freeze({
    kind: 'built-in' as const,
    name: 'default' as const
  }),
  typography: null,
  autoNumberHeadings: false,
  showFrontMatter: false,
  toc: Object.freeze({
    title: '',
    includeTopHeading: true
  }),
  header: null,
  footer: null,
  headerFooterAppearance: null
}) satisfies DocumentCoreExportOptions

const decorator = () => createDocumentCoreExportDecorator({
  cssFor: vi.fn(async() => '')
})

const directories: string[] = []
const hosts: DocumentCoreMainSessionHost[] = []

afterEach(async() => {
  await Promise.allSettled(hosts.splice(0).map((host) =>
    host.close('renderer:1', 'static-document')
  ))
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function sessionHost() {
  const directory = await mkdtemp(join(tmpdir(), 'marktext-static-sink-'))
  directories.push(directory)
  const host = createDocumentCoreMainSessionHost(
    createFileDocumentSessionJournalStorage(directory)
  )
  hosts.push(host)
  const source = createSourceSnapshot(
    '[TOC]\n\n# Safe {++new++} ' +
    '<img src=x onerror="globalThis.__hostile = true">'
  )
  const ticket = await host.startOpen('renderer:1', {
    documentId: 'static-document',
    durabilityKey: 'durable-static-document',
    sourceLength: source.text.length,
    parseConfiguration: configuration
  })
  await host.appendOpenChunk(
    'renderer:1',
    'static-document',
    ticket.ticketId,
    0,
    source.text
  )
  const admission = await host.completeOpen(
    'renderer:1',
    'static-document',
    ticket.ticketId
  )
  if ('envelope' in admission) {
    throw new Error('Initial source admission unexpectedly published')
  }
  const attachment = await host.startOpen('renderer:1', {
    documentId: 'static-document',
    durabilityKey: 'durable-static-document',
    sourceLength: 0,
    parseConfiguration: configuration
  })
  const publication = await host.completeOpen(
    'renderer:1',
    'static-document',
    attachment.ticketId
  )
  if (!('envelope' in publication)) {
    throw new Error('Renderer attachment returned no publication')
  }
  const snapshot = decodeDocumentCorePublication(
    new WireEnvelopeCodecV1().publish(
      publication.envelope,
      publication.baseSnapshotId
    )
  )
  return Object.freeze({ host, revisionId: snapshot.revisionId })
}

describe('main-owned document-core static sink host', () => {
  it('consumes branded HTML into the named HTML and PDF sinks without returning it', async() => {
    const writeStyledHtml = vi.fn(async(
      _targetPath: string,
      _html: string
    ) => 401)
    const writePdf = vi.fn(async(
      _targetPath: string,
      _html: string,
      _pageOptions: DocumentCorePdfPageOptions
    ) => 902)
    const surface: DocumentCoreStaticSinkSurface = {
      writeStyledHtml,
      writePdf,
      submitPrint: vi.fn(async() => {})
    }
    const session = await sessionHost()
    const sinks = createDocumentCoreStaticSinkHost(
      session.host,
      surface,
      decorator()
    )

    const htmlReceipt = await sinks.execute('renderer:1', {
      documentId: 'static-document',
      revisionId: session.revisionId,
      consumer: 'styled-html',
      view: 'markup',
      targetPath: '/tmp/review.html',
      options: exportOptions
    })
    const pdfReceipt = await sinks.execute('renderer:1', {
      documentId: 'static-document',
      revisionId: session.revisionId,
      consumer: 'pdf',
      view: 'revised',
      targetPath: '/tmp/review.pdf',
      options: exportOptions
    })

    expect(htmlReceipt).toMatchObject({
      kind: 'written',
      consumer: 'styled-html',
      targetPath: '/tmp/review.html',
      bytes: 401
    })
    expect(pdfReceipt).toMatchObject({
      kind: 'written',
      consumer: 'pdf',
      targetPath: '/tmp/review.pdf',
      bytes: 902
    })
    expect(htmlReceipt).not.toHaveProperty('html')
    expect(pdfReceipt).not.toHaveProperty('html')

    const styled = writeStyledHtml.mock.calls[0]?.[1] ?? ''
    expect(styled).toContain('<ins>new</ins>')
    expect(styled).toContain('<h1 id="safe-new-img-srcx-')
    expect(styled).toContain('class="toc-container"')
    expect(styled).toContain('href="#safe-new-img-srcx-')
    expect(styled).toContain('data-marktext-export-options')
    expect(styled).toContain('&lt;img')
    expect(styled).not.toContain('<img src=x')

    const pdf = writePdf.mock.calls[0]?.[1] ?? ''
    expect(pdf).toContain('Safe new')
    expect(pdf).toContain('data-marktext-export-options')
    expect(pdf).not.toContain('<ins>')
    expect(pdf).not.toContain('<img src=x')
  })

  it('uses print-render HTML at the print boundary and supports a deterministic proof artifact', async() => {
    const submitPrint = vi.fn(async(_html: string) => {})
    const writePrintProof = vi.fn(async(
      _targetPath: string,
      _html: string
    ) => 733)
    const session = await sessionHost()
    const sinks = createDocumentCoreStaticSinkHost(
      session.host,
      {
        writeStyledHtml: vi.fn(async(
          _targetPath: string,
          _html: string
        ) => 0),
        writePdf: vi.fn(async(
          _targetPath: string,
          _html: string
        ) => 0),
        submitPrint,
        writePrintProof
      },
      decorator()
    )

    const printed = await sinks.execute('renderer:1', {
      documentId: 'static-document',
      revisionId: session.revisionId,
      consumer: 'print',
      view: 'markup',
      options: exportOptions
    })
    const proof = await sinks.execute('renderer:1', {
      documentId: 'static-document',
      revisionId: session.revisionId,
      consumer: 'print',
      view: 'markup',
      proofPath: '/tmp/print-proof.pdf',
      options: exportOptions
    })

    expect(printed).toMatchObject({
      kind: 'submitted',
      consumer: 'print'
    })
    expect(proof).toMatchObject({
      kind: 'proof-written',
      consumer: 'print',
      targetPath: '/tmp/print-proof.pdf',
      bytes: 733
    })
    expect(submitPrint).toHaveBeenCalledTimes(1)
    expect(writePrintProof).toHaveBeenCalledTimes(1)
    expect(submitPrint.mock.calls[0]?.[0]).toContain('<ins>new</ins>')
    expect(submitPrint.mock.calls[0]?.[0]).toContain(
      'data-marktext-export-options'
    )
    expect(submitPrint.mock.calls[0]?.[0]).not.toContain('<img src=x')
  })

  it('rejects a stale revision before entering any static sink', async() => {
    const surface: DocumentCoreStaticSinkSurface = {
      writeStyledHtml: vi.fn(async() => 0),
      writePdf: vi.fn(async() => 0),
      submitPrint: vi.fn(async() => {})
    }
    const session = await sessionHost()
    const sinks = createDocumentCoreStaticSinkHost(
      session.host,
      surface,
      decorator()
    )

    await expect(sinks.execute('renderer:1', {
      documentId: 'static-document',
      revisionId: 'revision:stale',
      consumer: 'styled-html',
      view: 'markup',
      targetPath: '/tmp/stale.html',
      options: exportOptions
    })).rejects.toThrow(/stale|revision/i)

    expect(surface.writeStyledHtml).not.toHaveBeenCalled()
    expect(surface.writePdf).not.toHaveBeenCalled()
    expect(surface.submitPrint).not.toHaveBeenCalled()
  })
})

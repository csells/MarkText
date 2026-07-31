import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('document-core static sink cutover', () => {
  it('has no renderer-content or current-webContents export/print route', () => {
    const mainFile = source('src/main/menu/actions/file.ts')
    const rendererStore = source('src/renderer/src/store/editor.ts')
    const ipcContract = source('src/shared/types/ipc.ts')

    for (const removed of [
      'mt::response-export',
      'mt::response-print',
      'mt::export-success',
      'mt::print-service-clearup'
    ]) {
      expect(mainFile).not.toContain(removed)
      expect(rendererStore).not.toContain(removed)
      expect(ipcContract).not.toContain(removed)
    }
    expect(mainFile).not.toContain('webContents.printToPDF')
    expect(mainFile).not.toContain('printWebContents')
    expect(rendererStore).not.toContain('EXPORT(')
    expect(rendererStore).not.toContain('PRINT_RESPONSE')
  })

  it('routes HTML, PDF, and print from the editor through one core invoke', () => {
    const editor = source(
      'src/renderer/src/components/editorWithTabs/editor.vue'
    )
    const route = editor.slice(
      editor.indexOf('const handleExport'),
      editor.indexOf('// Push the current selection', editor.indexOf(
        'const handleExport'
      ))
    )

    expect(route).toContain("'mt::document-core::materialize-static'")
    expect(route).toContain('decodeDocumentCoreStaticSinkReceipt(')
    expect(route).toContain('revisionId')
    expect(route).not.toContain('editorStore.EXPORT')
    expect(route).not.toContain('PRINT_RESPONSE')
  })

  it('keeps physical output paths out of the renderer IPC contract', () => {
    const sharedTypes = source('src/shared/types/documentCore.ts')
    const rendererContract = sharedTypes.slice(
      sharedTypes.indexOf('interface DocumentCoreStaticSinkRequestBase'),
      sharedTypes.indexOf(
        'interface DocumentCoreStaticSinkReceiptBase'
      )
    )
    const codec = source('src/main/ipc/documentCoreRuntimeCodec.ts')
    const decoder = codec.slice(
      codec.indexOf('export function decodeDocumentCoreStaticSinkRequest'),
      codec.indexOf('\n}', codec.indexOf(
        'export function decodeDocumentCoreStaticSinkRequest'
      )) + 2
    )
    const preload = source('src/preload/index.ts')
    const rendererGlobals = source('src/types/global.d.ts')

    expect(rendererContract).not.toContain('targetPath')
    expect(rendererContract).not.toContain('proofPath')
    expect(decoder).not.toContain('targetPath')
    expect(decoder).not.toContain('proofPath')
    expect(preload).not.toContain('__mtDocumentCoreStaticSinkAcceptance')
    expect(rendererGlobals).not.toContain(
      '__mtDocumentCoreStaticSinkAcceptance'
    )
  })

  it('installs deterministic artifact control only in Electron main automation', () => {
    const mainIpc = source('src/main/ipc/documentCore.ts')
    const acceptance = source(
      'src/main/documentCore/staticSinkAcceptanceSurface.ts'
    )
    const hostileE2e = source(
      'test/e2e/document-core-hostile-sinks.spec.ts'
    )

    expect(mainIpc).toContain("process.env.PERF_TESTING === 'true'")
    // The read-only renderer bridge is deleted; automation surfaces are
    // main-only and gated on PERF_TESTING alone.
    expect(mainIpc).not.toContain('MARKTEXT_E2E_READONLY_BRIDGE')
    expect(mainIpc).toContain(
      "'__mtDocumentCoreStaticSinkAcceptance'"
    )
    expect(acceptance).toContain('executeStaticSink(')
    expect(hostileE2e).toContain('app.evaluate(')
    expect(hostileE2e).toContain(
      '__mtDocumentCoreStaticSinkAcceptance'
    )
    expect(hostileE2e).toContain('renderer-forged')
  })
})

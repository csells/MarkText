import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(__dirname, '../../../../')

async function source(relativePath: string): Promise<string> {
  return await readFile(path.join(repositoryRoot, relativePath), 'utf8')
}

describe('document session authority absence', () => {
  it('has one Desktop host options contract with an attached session only', async() => {
    const [host, caller] = await Promise.all([
      source(
        'desktop/src/renderer/src/components/editorWithTabs/' +
        'documentCoreDesktopEditor.ts'
      ),
      source(
        'desktop/src/renderer/src/components/editorWithTabs/editor.vue'
      )
    ])

    expect(host).toContain('export interface DocumentHostOptions')
    expect(host).toContain('readonly session: DocumentCoreRemoteSession')
    expect(host).not.toContain('DocumentCoreDesktopEditorOptions')
    expect(host).not.toContain('DocumentCoreViewSessionFactory')
    expect(host).not.toContain('sessionFactory')
    expect(host).not.toContain('readonly source: SourceSnapshot')
    expect(host).not.toContain('readonly parseConfiguration:')
    expect(host).not.toContain('readonly writeClipboardMaterialization?:')
    expect(host).not.toContain('readonly pasteClipboard?:')
    expect(host).not.toContain('options.writeClipboardMaterialization')
    expect(host).not.toContain('options.pasteClipboard')
    expect(caller).not.toContain('writeClipboardMaterialization:')
    expect(caller).not.toContain('pasteClipboard:')
  })

  it('has no deferred view factory or declaration-only open requests', async() => {
    const [view, publicView, shared] = await Promise.all([
      source('document-view/src/documentCore/documentCoreView.ts'),
      source('document-view/src/index.ts'),
      source('desktop/src/shared/types/documentCore.ts')
    ])

    expect(view).not.toContain('DocumentCoreViewSessionFactory')
    expect(view).not.toContain('sessionFactory')
    expect(view).not.toContain('createDocumentSession')
    expect(view).not.toContain('createStandaloneDocumentCoreSession')
    expect(view).not.toContain('readonly source: SourceSnapshot')
    expect(publicView).not.toContain('createStandaloneDocumentCoreSession')
    expect(shared).not.toContain('DocumentCoreAppendOpenChunkRequest')
    expect(shared).not.toContain('DocumentCoreCompleteOpenRequest')
    expect(shared).not.toContain('DocumentCoreCancelOpenRequest')
  })

  it('cannot redirect the production session worker through ambient test state', async() => {
    const workerHost = await source(
      'desktop/src/main/documentCore/isolatedDocumentSession.ts'
    )

    expect(workerHost).toContain("path.join(__dirname, 'documentSessionWorker.js')")
    expect(workerHost).not.toContain('process.env.VITEST')
    expect(workerHost).not.toContain('documentSessionWorker.ts')
    expect(workerHost).not.toContain("execArgv: ['--import', 'tsx']")
    expect(workerHost).not.toContain('rehomeWorkerBytesForTest')
  })
})

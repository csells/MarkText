import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(__dirname, '../../../../')

async function source(relativePath: string): Promise<string> {
  return await readFile(path.join(repositoryRoot, relativePath), 'utf8')
}

describe('document session authority absence', () => {
  it('has one Desktop host options contract with an attached session only', async() => {
    const host = await source(
      'desktop/src/renderer/src/components/editorWithTabs/' +
      'documentCoreDesktopEditor.ts'
    )

    expect(host).toContain('export interface DocumentHostOptions')
    expect(host).toContain('readonly session: IDocumentCoreViewSession')
    expect(host).not.toContain('DocumentCoreDesktopEditorOptions')
    expect(host).not.toContain('DocumentCoreViewSessionFactory')
    expect(host).not.toContain('sessionFactory')
    expect(host).not.toContain('readonly source: SourceSnapshot')
    expect(host).not.toContain('readonly parseConfiguration:')
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
})

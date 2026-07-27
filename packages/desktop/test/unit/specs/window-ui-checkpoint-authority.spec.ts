import { describe, expect, it } from 'vitest'
import { authorizeWindowUiCheckpoint } from 'main_renderer/editorBufferStore/windowUiCheckpointAuthority'

const intent = (
  documentIds: readonly string[],
  currentDocumentId: string | null = documentIds[0] ?? null
) => ({
  schema: 'document-core-window-ui-intent-1' as const,
  currentDocumentId,
  tabs: documentIds.map((documentId, index) => ({
    documentId,
    scrollTop: 10 + index
  })),
  layout: {
    rightColumn: 'files',
    showSideBar: true,
    showTabBar: true,
    sideBarWidth: 280
  }
})

describe('main-owned window UI checkpoint authority', () => {
  it('derives the project root and document identities from main authority', () => {
    expect(authorizeWindowUiCheckpoint(
      intent(['document:2', 'document:1'], 'document:2'),
      {
        rootDirectory: '/main/project',
        retainedDocumentIds: ['document:1', 'document:2']
      }
    )).toEqual({
      schema: 'document-core-window-ui-1',
      currentDocumentId: 'document:2',
      tabs: [
        { documentId: 'document:2', scrollTop: 10 },
        { documentId: 'document:1', scrollTop: 11 }
      ],
      project: {
        rootDirectory: '/main/project'
      },
      layout: {
        rightColumn: 'files',
        showSideBar: true,
        showTabBar: true,
        sideBarWidth: 280
      }
    })
  })

  it.each([
    ['adds a forged document', ['document:1', 'document:forged']],
    ['drops an admitted document', ['document:1']],
    ['replaces the admitted set', ['document:forged', 'document:other']]
  ])('rejects an intent that %s', (_label, documentIds) => {
    expect(() => authorizeWindowUiCheckpoint(
      intent(documentIds),
      {
        rootDirectory: '/main/project',
        retainedDocumentIds: ['document:1', 'document:2']
      }
    )).toThrow(/exact permutation/i)
  })

  it('requires an admitted selection whenever tabs exist', () => {
    expect(() => authorizeWindowUiCheckpoint(
      intent(['document:1'], null),
      {
        rootDirectory: '/main/project',
        retainedDocumentIds: ['document:1']
      }
    )).toThrow(/selected/i)
  })
})

import type {
  ExternalResourceTarget,
  StaticOutputRevealRequest
} from '@shared/types/presentationEffects'

export async function openExternalResource(
  target: ExternalResourceTarget
): Promise<boolean> {
  return await window.electron.ipcRenderer.invoke(
    'mt::external-resource::open',
    {
      schema: 'external-resource-open-1',
      target
    }
  )
}

export async function revealDocument(
  documentId: string
): Promise<boolean> {
  return await window.electron.ipcRenderer.invoke(
    'mt::document::reveal',
    {
      schema: 'document-reveal-1',
      documentId
    }
  )
}

export async function revealProjectEntry(
  entrySegments: readonly string[]
): Promise<boolean> {
  return await window.electron.ipcRenderer.invoke(
    'mt::project::reveal',
    {
      schema: 'project-reveal-1',
      entrySegments
    }
  )
}

export async function openConfiguredImageFolder(): Promise<boolean> {
  return await window.electron.ipcRenderer.invoke(
    'mt::image-folder::open',
    {
      schema: 'image-folder-open-1'
    }
  )
}

export async function revealStaticOutput(
  request: Omit<StaticOutputRevealRequest, 'schema'>
): Promise<boolean> {
  return await window.electron.ipcRenderer.invoke(
    'mt::static-output::reveal',
    {
      schema: 'static-output-reveal-1',
      ...request
    }
  )
}

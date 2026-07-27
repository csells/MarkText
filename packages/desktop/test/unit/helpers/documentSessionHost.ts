import type { DocumentSessionJournalStorage } from '@marktext/document-core'
import { resolve } from 'node:path'
import {
  createDocumentCoreMainSessionHost,
  type DocumentCoreMainSessionHost
} from 'main_renderer/documentCore/mainSessionHost'
import type {
  IsolatedDocumentSession
} from 'main_renderer/documentCore/isolatedDocumentSession'

const sourceWorkerLaunch = Object.freeze({
  entry: resolve(
    import.meta.dirname,
    '../../../src/main/documentCore/documentSessionWorker.ts'
  ),
  execArgv: Object.freeze(['--import', 'tsx'])
})

export function createTestDocumentCoreMainSessionHost(
  storage: DocumentSessionJournalStorage,
  observeExecution?: (execution: IsolatedDocumentSession) => void
): DocumentCoreMainSessionHost {
  return createDocumentCoreMainSessionHost(
    storage,
    observeExecution,
    Object.freeze({ workerLaunch: sourceWorkerLaunch })
  )
}

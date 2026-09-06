import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CoreRecoveryDraftInput, CoreRecoveryDraftRecord } from '../shared/types/coreRecoveryDraft'

const validId = (id: string): boolean => /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/.test(id)

/** Separate from saved-tab buffers: canonical saves and buffer cleanup never touch drafts. */
export function createCoreRecoveryDraftStore(root: string) {
  const syncDirectory = (): void => {
    // Windows does not expose directory handles through this Node API. Files
    // are flushed on every platform; POSIX also flushes the published entry.
    if (process.platform === 'win32') return
    const descriptor = openSync(root, 'r')
    try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
  }
  const writeExclusive = (path: string, content: string): void => {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    const descriptor = openSync(path, 'wx', 0o600)
    try {
      writeFileSync(descriptor, content, 'utf8')
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
  }
  return Object.freeze({
    preserve(input: CoreRecoveryDraftInput): CoreRecoveryDraftRecord {
      if (!input || typeof input.documentId !== 'string' || typeof input.visibleText !== 'string' ||
          typeof input.reason !== 'string' || !Number.isSafeInteger(input.generation) ||
          !Number.isSafeInteger(input.revision)) throw new Error('Invalid recovered draft')
      const id = randomUUID()
      const record = { ...input, id, createdAt: new Date().toISOString(), artifactPath: join(root, `${id}.json`) }
      // Publish only complete records; an interrupted write remains preserved
      // under its pending name rather than breaking the list of valid backups.
      const pendingPath = `${record.artifactPath}.pending`
      writeExclusive(pendingPath, JSON.stringify(record))
      linkSync(pendingPath, record.artifactPath)
      syncDirectory()
      return record
    },
    list(): CoreRecoveryDraftRecord[] {
      if (!existsSync(root)) return []
      const artifacts = new Map<string, string>()
      for (const name of readdirSync(root)) {
        const id = name.replace(/\.json(?:\.pending)?$/, '')
        if (!validId(id) || id === name) continue
        // A published hard link and its pending file are the same backup.
        // Orphans remain discoverable after a crash, even if their JSON is partial.
        if (!artifacts.has(id) || name.endsWith('.json')) artifacts.set(id, name)
      }
      return [...artifacts].filter(([id]) => !existsSync(join(root, `${id}.archived`)))
        .map(([id, name]) => {
          const artifactPath = join(root, name)
          try {
            const record = JSON.parse(readFileSync(artifactPath, 'utf8')) as CoreRecoveryDraftRecord
            if (record.id !== id || typeof record.visibleText !== 'string' ||
                typeof record.createdAt !== 'string' || typeof record.documentId !== 'string' ||
                typeof record.reason !== 'string' || !Number.isSafeInteger(record.generation) ||
                !Number.isSafeInteger(record.revision) ||
                (record.pathname !== undefined && typeof record.pathname !== 'string')) {
              throw new Error('Invalid draft record')
            }
            return { ...record, artifactPath }
          } catch (error) {
            return {
              id,
              artifactPath,
              documentId: name,
              createdAt: '',
              generation: 0,
              revision: 0,
              visibleText: '',
              reason: 'Unreadable draft',
              nativeState: undefined,
              nativeIntent: undefined,
              acknowledgedView: undefined,
              readError: error instanceof Error ? error.message : String(error)
            }
          }
        }).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    },
    archive(id: string): void {
      if (!validId(id) || (!existsSync(join(root, `${id}.json`)) &&
          !existsSync(join(root, `${id}.json.pending`)))) throw new Error('Unknown recovered draft')
      const marker = join(root, `${id}.archived`)
      if (!existsSync(marker)) {
        writeExclusive(marker, JSON.stringify({ archivedAt: new Date().toISOString() }))
        syncDirectory()
      }
    }
  })
}

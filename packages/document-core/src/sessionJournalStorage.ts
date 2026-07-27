import type {
  DocumentSessionJournalContent,
  DocumentSessionJournalMutation,
  DocumentSessionJournalStorage,
  DocumentSessionJournalValue
} from './documentSession.js'

/**
 * Coordinator-restart storage test double.
 *
 * It makes no process, filesystem, fsync, or power-loss claim. Production
 * durability is supplied by injecting a host-owned implementation of the same
 * atomic compare/exchange seam.
 */
export function createMemoryDocumentSessionJournalStorage():
DocumentSessionJournalStorage {
  interface MemoryJournalValue {
    readonly revision: number
    readonly data: string
    readonly contents: ReadonlyMap<string, string>
  }
  const values = new Map<string, MemoryJournalValue>()
  const freezeContent = (
    id: string,
    data: string
  ): DocumentSessionJournalContent => Object.freeze({ id, data })
  return Object.freeze({
    async read(key: string): Promise<DocumentSessionJournalValue | null> {
      const value = values.get(key)
      return value === undefined
        ? null
        : Object.freeze({
          revision: value.revision,
          data: value.data,
          contents: Object.freeze(
            [...value.contents].map(([id, data]) => freezeContent(id, data))
          )
        })
    },

    async compareExchange(
      key: string,
      expectedRevision: number | null,
      mutation: DocumentSessionJournalMutation
    ): Promise<Readonly<{ revision: number }> | null> {
      const current = values.get(key)
      if ((current?.revision ?? null) !== expectedRevision) {
        return null
      }
      const retained = new Set(mutation.retainedContentIds)
      if (retained.size !== mutation.retainedContentIds.length) {
        throw new TypeError('Document session journal retained duplicate content ids')
      }
      const contents = new Map(current?.contents ?? [])
      for (const content of mutation.contents) {
        const existing = contents.get(content.id)
        if (existing !== undefined && existing !== content.data) {
          throw new Error('Document session journal content id changed data')
        }
        contents.set(content.id, content.data)
      }
      for (const id of retained) {
        if (!contents.has(id)) {
          throw new Error('Document session journal retained missing content')
        }
      }
      for (const id of contents.keys()) {
        if (!retained.has(id)) contents.delete(id)
      }
      const next = Object.freeze({
        revision: (current?.revision ?? 0) + 1,
        data: mutation.data,
        contents
      })
      values.set(key, next)
      return Object.freeze({ revision: next.revision })
    }
  })
}

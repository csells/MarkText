import type { CanonicalLineEnding } from './canonicalEolIndex'

export interface CoreDocumentReloadInput {
  readonly documentId: string
  readonly source: string
  readonly lineEnding: CanonicalLineEnding
}

export type CoreDocumentReloadHandler = (
  input: CoreDocumentReloadInput
) => Promise<() => void>

export interface CoreDocumentReloadAuthority {
  register(documentId: string, handler: CoreDocumentReloadHandler): () => void
  has(documentId: string): boolean
  replace(input: CoreDocumentReloadInput, publishSource: () => void): Promise<void> | undefined
}

export const canonicalCoreLineEnding = (lineEnding: string): CanonicalLineEnding => {
  switch (lineEnding.toLowerCase()) {
    case 'crlf': return '\r\n'
    case 'cr': return '\r'
    default: return '\n'
  }
}

const createCoreDocumentReloadAuthority = (): CoreDocumentReloadAuthority => {
  const handlers = new Map<string, CoreDocumentReloadHandler>()

  return Object.freeze({
    register(documentId: string, handler: CoreDocumentReloadHandler): () => void {
      if (!documentId || handlers.has(documentId)) {
        throw new Error('Core document reload authority is already registered')
      }
      handlers.set(documentId, handler)
      let registered = true
      return () => {
        if (!registered) return
        registered = false
        if (handlers.get(documentId) === handler) handlers.delete(documentId)
      }
    },
    has(documentId: string): boolean {
      return handlers.has(documentId)
    },
    replace(input: CoreDocumentReloadInput, publishSource: () => void): Promise<void> | undefined {
      const handler = handlers.get(input.documentId)
      if (handler === undefined) return undefined
      try {
        return Promise.resolve(handler(Object.freeze({ ...input }))).then(publishView => {
          publishSource()
          publishView()
        })
      } catch (error) {
        return Promise.reject(error)
      }
    }
  })
}

export const coreDocumentReloadAuthority = createCoreDocumentReloadAuthority()

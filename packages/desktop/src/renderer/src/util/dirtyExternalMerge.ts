import {
  mergeMarkdownThreeWay,
  type MergeInput,
  type ThreeWayMergeResult
} from './threeWayMerge'

type DirtyExternalMergeWorkerResponse =
  | { ok: true; result: ThreeWayMergeResult }
  | { ok: false; message: string }

// Both envelope arms are field-validated: `ok: true` alone proves nothing
// about `result`, and resolving an unchecked payload would surface as a
// TypeError far from this boundary instead of the loud reject here.
const isThreeWayMergeResult = (value: unknown): value is ThreeWayMergeResult => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ThreeWayMergeResult>
  return typeof candidate.mergedMarkdown === 'string' && Array.isArray(candidate.conflicts)
}

export const mergeDirtyExternalMarkdown = (input: MergeInput): Promise<ThreeWayMergeResult> => {
  if (typeof Worker === 'undefined') {
    return Promise.resolve().then(() => mergeMarkdownThreeWay(input))
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./dirtyExternalMerge.worker.ts', import.meta.url), {
      type: 'module'
    })

    // The worker speaks exactly one protocol: the { ok } envelope. Any other
    // shape means the worker and this bridge are out of sync — fail loudly
    // rather than guess at the payload.
    worker.onmessage = (event: MessageEvent<DirtyExternalMergeWorkerResponse>) => {
      worker.terminate()
      const data: unknown = event.data
      if (typeof data === 'object' && data !== null && 'ok' in data) {
        const reply = data as DirtyExternalMergeWorkerResponse
        if (reply.ok === true && isThreeWayMergeResult(reply.result)) {
          resolve(reply.result)
          return
        }
        if (reply.ok === false && typeof reply.message === 'string') {
          reject(new Error(reply.message))
          return
        }
      }
      reject(new Error('Malformed dirty-external-merge worker reply'))
    }

    worker.onerror = (event) => {
      worker.terminate()
      reject(event instanceof ErrorEvent ? event.error ?? new Error(event.message) : event)
    }

    worker.postMessage(input)
  })
}

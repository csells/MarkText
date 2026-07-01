import {
  mergeMarkdownThreeWay,
  type MergeInput,
  type ThreeWayMergeResult
} from './threeWayMerge'

type DirtyExternalMergeWorkerResponse =
  | { ok: true; result: ThreeWayMergeResult }
  | { ok: false; message: string }

const isMergeResult = (value: unknown): value is ThreeWayMergeResult =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { mergedMarkdown?: unknown }).mergedMarkdown === 'string' &&
  Array.isArray((value as { conflicts?: unknown }).conflicts)

export const mergeDirtyExternalMarkdown = (input: MergeInput): Promise<ThreeWayMergeResult> => {
  if (typeof Worker === 'undefined') {
    return Promise.resolve().then(() => mergeMarkdownThreeWay(input))
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./dirtyExternalMerge.worker.ts', import.meta.url), {
      type: 'module'
    })

    worker.onmessage = (event: MessageEvent<DirtyExternalMergeWorkerResponse | ThreeWayMergeResult>) => {
      worker.terminate()
      if (isMergeResult(event.data)) {
        resolve(event.data)
        return
      }
      if (event.data.ok) {
        resolve(event.data.result)
      } else {
        reject(new Error(event.data.message))
      }
    }

    worker.onerror = (event) => {
      worker.terminate()
      reject(event instanceof ErrorEvent ? event.error ?? new Error(event.message) : event)
    }

    worker.postMessage(input)
  })
}

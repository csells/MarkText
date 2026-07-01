import {
  mergeMarkdownThreeWay,
  type MergeInput,
  type ThreeWayMergeResult
} from './threeWayMerge'

type DirtyExternalMergeWorkerMessage =
  | { ok: true; result: ThreeWayMergeResult }
  | { ok: false; message: string }

self.onmessage = (event: MessageEvent<MergeInput>): void => {
  try {
    const result = mergeMarkdownThreeWay(event.data)
    self.postMessage({ ok: true, result } satisfies DirtyExternalMergeWorkerMessage)
  } catch (error) {
    self.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    } satisfies DirtyExternalMergeWorkerMessage)
  }
}

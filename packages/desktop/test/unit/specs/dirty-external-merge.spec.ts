import { afterEach, describe, expect, it, vi } from 'vitest'
import { mergeDirtyExternalMarkdown } from '../../../src/renderer/src/util/dirtyExternalMerge'

describe('mergeDirtyExternalMarkdown', () => {
  const originalWorker = globalThis.Worker

  afterEach(() => {
    globalThis.Worker = originalWorker
    vi.restoreAllMocks()
  })

  // Speaks the real worker protocol: the { ok } envelope the production
  // worker posts (dirtyExternalMerge.worker.ts). The bridge accepts nothing
  // else — an unexpected reply shape must fail loudly, not resolve.
  const workerReplying = (reply: unknown, posted: unknown[] = []) => {
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null

      postMessage(message: unknown): void {
        posted.push(message)
        this.onmessage?.({ data: reply } as MessageEvent)
      }

      terminate = vi.fn()
    }
    return FakeWorker as unknown as typeof Worker
  }

  const INPUT = { base: 'base\n', local: 'local\n', remote: 'remote\n' }

  it('uses a Web Worker when one is available', async() => {
    const posted: unknown[] = []
    globalThis.Worker = workerReplying(
      { ok: true, result: { mergedMarkdown: 'merged\n', conflicts: [] } },
      posted
    )

    await expect(mergeDirtyExternalMarkdown(INPUT)).resolves.toEqual({
      mergedMarkdown: 'merged\n',
      conflicts: []
    })
    expect(posted).toEqual([INPUT])
  })

  it('rejects when the worker reports a failure', async() => {
    globalThis.Worker = workerReplying({ ok: false, message: 'merge exploded' })

    await expect(mergeDirtyExternalMarkdown(INPUT)).rejects.toThrow('merge exploded')
  })

  it('rejects a malformed worker reply instead of guessing at its shape', async() => {
    // The pre-envelope protocol (a bare merge result) must not be quietly
    // accepted — a shape mismatch here means the worker and bridge are out
    // of sync, which should fail loudly.
    globalThis.Worker = workerReplying({ mergedMarkdown: 'merged\n', conflicts: [] })

    await expect(mergeDirtyExternalMarkdown(INPUT)).rejects.toThrow(/malformed/i)
  })
})

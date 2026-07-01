import { afterEach, describe, expect, it, vi } from 'vitest'
import { mergeDirtyExternalMarkdown } from '../../../src/renderer/src/util/dirtyExternalMerge'

describe('mergeDirtyExternalMarkdown', () => {
  const originalWorker = globalThis.Worker

  afterEach(() => {
    globalThis.Worker = originalWorker
    vi.restoreAllMocks()
  })

  it('uses a Web Worker when one is available', async() => {
    const posted: unknown[] = []
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null

      postMessage(message: unknown): void {
        posted.push(message)
        this.onmessage?.({
          data: {
            mergedMarkdown: 'merged\n',
            conflicts: []
          }
        } as MessageEvent)
      }

      terminate = vi.fn()
    }
    globalThis.Worker = FakeWorker as unknown as typeof Worker

    await expect(mergeDirtyExternalMarkdown({
      base: 'base\n',
      local: 'local\n',
      remote: 'remote\n'
    })).resolves.toEqual({
      mergedMarkdown: 'merged\n',
      conflicts: []
    })
    expect(posted).toEqual([
      {
        base: 'base\n',
        local: 'local\n',
        remote: 'remote\n'
      }
    ])
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createLatestViewRefresh } from '../../../src/renderer/src/documentConsumers/latestViewRefresh'

const deferred = <T>() => {
  let resolvePromise!: (value: T) => void
  let rejectPromise!: (error: Error) => void
  const promise = new Promise<T>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

describe('latest asynchronous view refresh', () => {
  it('keeps stale Review disabled and publishes the fresh read while the older read is still held', async() => {
    const publish = vi.fn()
    const pending = vi.fn()
    const refresh = createLatestViewRefresh<string>({ publish, pending, fault: vi.fn() })
    const oldReply = deferred<string>()
    const old = refresh.request(async() => oldReply.promise)
    refresh.invalidate()
    expect(pending).toHaveBeenLastCalledWith(true)
    await refresh.request(async() => 'current range')
    expect(publish).toHaveBeenCalledExactlyOnceWith('current range')
    expect(pending).toHaveBeenLastCalledWith(false)
    oldReply.resolve('old range')
    await old
    expect(publish).toHaveBeenCalledExactlyOnceWith('current range')
    expect(pending).toHaveBeenLastCalledWith(false)
  })

  it('lets a superseded settle skip its expensive projection and suppresses stale failures', async() => {
    const settle = deferred<void>()
    const projection = vi.fn(async() => 'old')
    const fault = vi.fn()
    const pending = vi.fn()
    const refresh = createLatestViewRefresh<string>({ publish: vi.fn(), pending, fault })
    const old = refresh.request(async current => {
      await settle.promise
      if (!current()) return undefined
      return projection()
    })
    refresh.invalidate()
    settle.resolve()
    await old
    expect(projection).not.toHaveBeenCalled()
    expect(pending).toHaveBeenLastCalledWith(true)
    const failed = deferred<string>()
    const stale = refresh.request(async() => failed.promise)
    refresh.invalidate()
    failed.reject(new Error('outgoing generation'))
    await stale
    expect(fault).not.toHaveBeenCalled()
    expect(pending).toHaveBeenLastCalledWith(true)
  })

  it('invalidates in-flight work at handoff and cannot refresh after disposal', async() => {
    const reply = deferred<string>()
    const publish = vi.fn()
    const pending = vi.fn()
    const fault = vi.fn()
    const refresh = createLatestViewRefresh<string>({ publish, pending, fault })
    const reading = refresh.request(async() => reply.promise)
    refresh.dispose()
    reply.resolve('outgoing document')
    await reading
    const next = vi.fn(async() => 'new document')
    refresh.invalidate()
    await refresh.request(next)
    expect(next).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    expect(fault).not.toHaveBeenCalled()
    expect(pending).toHaveBeenLastCalledWith(false)
  })
})

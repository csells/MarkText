import { describe, expect, it, vi } from 'vitest'

import { createTableShapeDialogRequest } from '@/components/editorWithTabs/tableShapeDialogRequest'

describe('table shape dialog request', () => {
  it('returns only a frozen, valid table shape', async () => {
    const open = vi.fn()
    const close = vi.fn()
    const request = createTableShapeDialogRequest({ open, close })
    const controller = new AbortController()

    const result = request.request(controller.signal)
    expect(open).toHaveBeenCalledOnce()

    request.confirm({ rows: 1, columns: 1 })

    await expect(result).resolves.toEqual({ rows: 1, columns: 1 })
    expect(Object.isFrozen(await result)).toBe(true)
    expect(close).toHaveBeenCalledOnce()
  })

  it('cancels on abort and closes the open dialog', async () => {
    const close = vi.fn()
    const request = createTableShapeDialogRequest({
      open: vi.fn(),
      close
    })
    const controller = new AbortController()

    const result = request.request(controller.signal)
    controller.abort()

    await expect(result).resolves.toBeNull()
    expect(close).toHaveBeenCalledOnce()
    expect(request.hasPendingRequest()).toBe(false)
  })

  it('cancels the prior request instead of retargeting it', async () => {
    const request = createTableShapeDialogRequest({
      open: vi.fn(),
      close: vi.fn()
    })
    const first = request.request(new AbortController().signal)
    const second = request.request(new AbortController().signal)

    await expect(first).resolves.toBeNull()
    request.confirm({ rows: 4, columns: 3 })
    await expect(second).resolves.toEqual({ rows: 4, columns: 3 })
  })

  it.each([
    { rows: 0, columns: 1 },
    { rows: 31, columns: 1 },
    { rows: 1, columns: 0 },
    { rows: 1, columns: 21 },
    { rows: 1.5, columns: 1 },
    { rows: 1, columns: Number.NaN }
  ])('cancels an invalid response without mutation authority: %j', async shape => {
    const request = createTableShapeDialogRequest({
      open: vi.fn(),
      close: vi.fn()
    })
    const result = request.request(new AbortController().signal)

    request.confirm(shape)

    await expect(result).resolves.toBeNull()
  })
})

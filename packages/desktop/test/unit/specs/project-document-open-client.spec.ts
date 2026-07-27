import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  reportAsyncFailure: vi.fn()
}))

vi.mock('@marktext/document-view', () => ({
  reportAsyncFailure: mocks.reportAsyncFailure
}))

const { requestProjectDocumentOpen } = await import(
  '@/services/projectDocumentOpen'
)

describe('project-document open renderer client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        ipcRenderer: {
          invoke: mocks.invoke
        }
      }
    })
  })

  it('accepts only a strict main receipt', async() => {
    mocks.invoke.mockResolvedValue({
      schema: 'project-document-open-receipt-1',
      disposition: 'admitted',
      pathname: '/project/notes.md'
    })

    await expect(requestProjectDocumentOpen('/project/notes.md'))
      .resolves.toBe(true)
    expect(mocks.reportAsyncFailure).not.toHaveBeenCalled()
  })

  it('reports and rejects a malformed main receipt', async() => {
    mocks.invoke.mockResolvedValue({
      disposition: 'admitted',
      pathname: '/project/notes.md',
      options: {}
    })

    await expect(requestProjectDocumentOpen('/project/notes.md'))
      .resolves.toBe(false)
    expect(mocks.reportAsyncFailure).toHaveBeenCalledWith(
      expect.any(TypeError),
      'Project document open'
    )
  })
})

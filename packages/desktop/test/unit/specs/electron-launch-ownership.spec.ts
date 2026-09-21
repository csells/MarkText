// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ launch: vi.fn() }))
vi.mock('playwright', () => ({ _electron: { launch: fixture.launch } }))
vi.mock('@playwright/test', () => ({ expect: () => ({ toBe: vi.fn(), toHaveCount: vi.fn() }) }))

import { launchElectron, launchWithDoc, launchWithMarkdown } from '../../e2e/helpers'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('MARKTEXT_PACKAGED_APP', '/fixture/marktext')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

it.each(['window', 'document', 'markdown'] as const)(
  'terminates its own process when %s initialization rejects',
  async(stage) => {
    const failure = new Error('Renderer did not become ready')
    const page = {
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockRejectedValue(failure)
    }
    const process = { kill: vi.fn() }
    const app = {
      evaluate: vi.fn().mockResolvedValue(true),
      firstWindow:
        stage === 'window' ? vi.fn().mockRejectedValue(failure) : vi.fn().mockResolvedValue(page),
      process: () => process,
      close: vi.fn().mockResolvedValue(undefined)
    }
    fixture.launch.mockResolvedValue(app)
    const operation =
      stage === 'window'
        ? launchElectron()
        : stage === 'document'
          ? launchWithDoc('fixture.md')
          : launchWithMarkdown('fixture\n')
    const rejected = expect(operation).rejects.toBe(failure)
    await vi.runAllTimersAsync()
    await rejected
    expect(process.kill).toHaveBeenCalledOnce()
    expect(app.close).toHaveBeenCalledOnce()
  }
)

it('leaves a successfully initialized application under the caller’s ownership', async() => {
  const page = { waitForLoadState: vi.fn().mockResolvedValue(undefined) }
  const process = { kill: vi.fn() }
  const app = {
    evaluate: vi.fn().mockResolvedValue(true),
    firstWindow: vi.fn().mockResolvedValue(page),
    process: () => process,
    close: vi.fn()
  }
  fixture.launch.mockResolvedValue(app)
  const operation = launchElectron()
  await vi.runAllTimersAsync()
  expect(await operation).toEqual({ app, page })
  expect(process.kill).not.toHaveBeenCalled()
  expect(app.close).not.toHaveBeenCalled()
})

it.each([
  { packaged: true, explicitControls: false, expected: undefined },
  { packaged: true, explicitControls: true, expected: '1' },
  { packaged: false, explicitControls: false, expected: '1' }
])(
  'launches with test controls=$expected for packaged=$packaged, explicit=$explicitControls',
  async({ packaged, explicitControls, expected }) => {
    vi.stubEnv('MARKTEXT_PACKAGED_APP', packaged ? '/fixture/marktext' : undefined)
    vi.stubEnv('MARKTEXT_DOCUMENT_CORE_MODE', '0')
    vi.stubEnv('MARKTEXT_DOCUMENT_CORE_SHADOW', '1')
    vi.stubEnv('MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS', '1')
    const page = { waitForLoadState: vi.fn().mockResolvedValue(undefined) }
    fixture.launch.mockResolvedValue({
      evaluate: vi.fn().mockResolvedValue(true),
      firstWindow: vi.fn().mockResolvedValue(page)
    })
    const env = explicitControls
      ? {
        MARKTEXT_DOCUMENT_CORE_MODE: '1',
        MARKTEXT_DOCUMENT_CORE_SHADOW: '0',
        MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS: '1'
      }
      : undefined
    const operation = launchElectron([], { env })
    await vi.runAllTimersAsync()
    await operation
    expect(fixture.launch).toHaveBeenCalledOnce()
    const launched = fixture.launch.mock.calls[0]?.[0].env
    expect(launched.MARKTEXT_DOCUMENT_CORE_TEST_CONTROLS).toBe(expected)
    expect(launched.MARKTEXT_DOCUMENT_CORE_MODE).toBe(
      explicitControls ? '1' : packaged ? undefined : '0'
    )
    expect(launched.MARKTEXT_DOCUMENT_CORE_SHADOW).toBe(
      explicitControls ? '0' : packaged ? undefined : '1'
    )
  }
)

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((
      channel: string,
      handler: (...args: unknown[]) => unknown
    ) => handlers.set(channel, handler))
  }
}))

const { registerUploaderConfigurationHandlers } =
  await import('main_renderer/ipc/uploaderConfiguration')

function dependencies() {
  return {
    resolveWindow: vi.fn(() => ({ id: 19 })),
    chooseExecutable: vi.fn(
      async(): Promise<string | null> => '/native/chosen-uploader'
    ),
    verifyExecutable: vi.fn(async() => '/canonical/chosen-uploader'),
    persistSelection: vi.fn(async() => {}),
    persistExecutable: vi.fn(async() => {})
  }
}

describe('uploader configuration IPC effect gate', () => {
  beforeEach(() => handlers.clear())

  it('rejects renderer executable authority before settings effects', async() => {
    const deps = dependencies()
    registerUploaderConfigurationHandlers(deps)

    await expect(handlers.get('mt::uploader::select')?.(
      { sender: { id: 7 } },
      {
        schema: 'uploader-selection-1',
        kind: 'custom-cli',
        executablePath: '/tmp/attacker'
      }
    )).rejects.toThrow(/closed|field/i)

    expect(deps.persistSelection).not.toHaveBeenCalled()
    expect(deps.chooseExecutable).not.toHaveBeenCalled()
    expect(deps.persistExecutable).not.toHaveBeenCalled()
  })

  it('rejects arguments on the native chooser before presentation or persistence', async() => {
    const deps = dependencies()
    registerUploaderConfigurationHandlers(deps)

    await expect(
      handlers.get('mt::uploader::choose-custom-executable')?.(
        { sender: { id: 7 } },
        '/tmp/attacker'
      )
    ).rejects.toThrow(/argument|closed/i)

    expect(deps.resolveWindow).not.toHaveBeenCalled()
    expect(deps.chooseExecutable).not.toHaveBeenCalled()
    expect(deps.verifyExecutable).not.toHaveBeenCalled()
    expect(deps.persistExecutable).not.toHaveBeenCalled()
  })

  it('persists only a canonical executable returned by native presentation', async() => {
    const deps = dependencies()
    registerUploaderConfigurationHandlers(deps)
    const sender = { id: 41 }

    await expect(
      handlers.get('mt::uploader::choose-custom-executable')?.({ sender })
    ).resolves.toEqual({
      schema: 'uploader-custom-executable-receipt-1',
      selected: true,
      executablePath: '/canonical/chosen-uploader'
    })

    expect(deps.resolveWindow).toHaveBeenCalledWith(sender)
    expect(deps.chooseExecutable).toHaveBeenCalledWith({ id: 19 })
    expect(deps.verifyExecutable).toHaveBeenCalledWith(
      '/native/chosen-uploader'
    )
    expect(deps.persistExecutable).toHaveBeenCalledWith(
      '/canonical/chosen-uploader'
    )
  })

  it('does not touch the filesystem or store when native selection is cancelled', async() => {
    const deps = dependencies()
    deps.chooseExecutable.mockResolvedValue(null)
    registerUploaderConfigurationHandlers(deps)

    await expect(
      handlers.get('mt::uploader::choose-custom-executable')?.({
        sender: { id: 41 }
      })
    ).resolves.toEqual({
      schema: 'uploader-custom-executable-receipt-1',
      selected: false,
      executablePath: null
    })

    expect(deps.verifyExecutable).not.toHaveBeenCalled()
    expect(deps.persistExecutable).not.toHaveBeenCalled()
  })
})

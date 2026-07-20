import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  ipcListeners,
  fromWebContents,
  showSaveDialog,
  writeFile,
  logError
} = vi.hoisted(() => ({
  ipcListeners: new Map<string, (...args: unknown[]) => unknown>(),
  fromWebContents: vi.fn(),
  showSaveDialog: vi.fn(),
  writeFile: vi.fn(),
  logError: vi.fn()
}))

vi.mock('electron', () => ({
  app: { quit: vi.fn() },
  BrowserWindow: { fromWebContents },
  dialog: {
    showMessageBox: vi.fn(),
    showErrorBox: vi.fn(),
    showOpenDialog: vi.fn(),
    showSaveDialog
  },
  ipcMain: {
    on: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcListeners.set(channel, handler)
    }),
    emit: vi.fn()
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
    showItemInFolder: vi.fn()
  }
}))

vi.mock('electron-log', () => ({
  default: { error: logError, info: vi.fn(), warn: vi.fn() }
}))
vi.mock('fs-extra', () => ({ rename: vi.fn() }))
vi.mock('common/filesystem', () => ({
  exists: vi.fn(() => Promise.resolve(false)),
  isDirectory: vi.fn(() => false),
  isFile: vi.fn(() => false)
}))
vi.mock('common/filesystem/paths', () => ({
  MARKDOWN_EXTENSIONS: ['md'],
  isDangerousExecutableFile: vi.fn(() => false),
  isMarkdownFile: vi.fn(() => false)
}))
vi.mock('main_renderer/menu/actions/marktext', () => ({
  checkUpdates: vi.fn(),
  userSetting: vi.fn()
}))
vi.mock('main_renderer/menu/actions/view', () => ({ showTabBar: vi.fn() }))
vi.mock('main_renderer/commands', () => ({ COMMANDS: {} }))
vi.mock('main_renderer/config', () => ({
  EXTENSION_HASN: { pdf: '.pdf' },
  PANDOC_EXTENSIONS: [],
  URL_REG: /$a/
}))
vi.mock('main_renderer/filesystem', () => ({
  normalizeAndResolvePath: vi.fn((value: string) => value),
  writeFile
}))
vi.mock('main_renderer/filesystem/markdown', () => ({ writeMarkdownFile: vi.fn() }))
vi.mock('main_renderer/utils', () => ({
  getPath: vi.fn(() => '/tmp'),
  getRecommendTitleFromMarkdownString: vi.fn(() => '')
}))
vi.mock('main_renderer/utils/pandoc', () => ({
  default: Object.assign(vi.fn(), { exists: vi.fn(() => false) })
}))
vi.mock('main_renderer/i18n', () => ({ t: vi.fn((key: string) => key) }))

await import('main_renderer/menu/actions/file')

const exportHandler = (): ((...args: unknown[]) => Promise<void>) => {
  const handler = ipcListeners.get('mt::response-export')
  if (!handler) throw new Error('mt::response-export handler was not registered')
  return handler as (...args: unknown[]) => Promise<void>
}

const printHandler = (): ((...args: unknown[]) => Promise<void>) => {
  const handler = ipcListeners.get('mt::response-print')
  if (!handler) throw new Error('mt::response-print handler was not registered')
  return handler as (...args: unknown[]) => Promise<void>
}

describe('production print and PDF IPC contracts', () => {
  beforeEach(() => {
    fromWebContents.mockReset()
    showSaveDialog.mockReset()
    writeFile.mockReset()
    logError.mockReset()
  })

  it('clears the temporary print document when PDF generation fails', async() => {
    const send = vi.fn()
    const printToPDF = vi.fn(() => Promise.reject(new Error('Chromium PDF failure')))
    const win = { webContents: { send, printToPDF } }
    const sender = {}
    fromWebContents.mockReturnValue(win)
    showSaveDialog.mockResolvedValue({
      filePath: '/tmp/review.pdf',
      canceled: false
    })

    await exportHandler()(
      { sender },
      { type: 'pdf', pathname: '/tmp/review.md', title: 'Review' }
    )

    expect(printToPDF).toHaveBeenCalledWith({
      printBackground: true,
      generateTaggedPDF: true,
      generateDocumentOutline: true
    })
    expect(send).toHaveBeenCalledWith('mt::print-service-clearup')
    expect(send.mock.calls.filter(([channel]) =>
      channel === 'mt::print-service-clearup')).toHaveLength(1)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('clears the temporary print document when PDF generation throws before returning a promise', async() => {
    const send = vi.fn()
    const printToPDF = vi.fn(() => {
      throw new Error('destroyed webContents')
    })
    const win = { webContents: { send, printToPDF } }
    const sender = {}
    fromWebContents.mockReturnValue(win)
    showSaveDialog.mockResolvedValue({
      filePath: '/tmp/review.pdf',
      canceled: false
    })

    await exportHandler()(
      { sender },
      { type: 'pdf', pathname: '/tmp/review.md', title: 'Review' }
    )

    expect(send).toHaveBeenCalledWith('mt::print-service-clearup')
    expect(send.mock.calls.filter(([channel]) =>
      channel === 'mt::print-service-clearup')).toHaveLength(1)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('settles the export response and clears the temporary print document when the save dialog fails', async() => {
    const send = vi.fn()
    const printToPDF = vi.fn()
    const win = { webContents: { send, printToPDF } }
    const sender = {}
    fromWebContents.mockReturnValue(win)
    showSaveDialog.mockRejectedValue(new Error('save dialog unavailable'))

    await expect(exportHandler()(
      { sender },
      { type: 'pdf', pathname: '/tmp/review.md', title: 'Review' }
    )).resolves.toBeUndefined()

    expect(printToPDF).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('mt::print-service-clearup')
    expect(send).toHaveBeenCalledWith('mt::show-notification', {
      title: 'Export failure',
      type: 'error',
      message: 'save dialog unavailable'
    })
    expect(send.mock.calls.filter(([channel]) =>
      channel === 'mt::print-service-clearup')).toHaveLength(1)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('settles PDF export when cleanup cannot reach a destroyed renderer', async() => {
    const send = vi.fn((channel: string) => {
      if (channel === 'mt::print-service-clearup') {
        throw new Error('destroyed renderer')
      }
    })
    const printToPDF = vi.fn(() => Promise.reject(new Error('Chromium PDF failure')))
    const win = { webContents: { send, printToPDF } }
    const sender = {}
    fromWebContents.mockReturnValue(win)
    showSaveDialog.mockResolvedValue({
      filePath: '/tmp/review.pdf',
      canceled: false
    })

    await expect(exportHandler()(
      { sender },
      { type: 'pdf', pathname: '/tmp/review.md', title: 'Review' }
    )).resolves.toBeUndefined()

    expect(send.mock.calls.filter(([channel]) =>
      channel === 'mt::print-service-clearup')).toHaveLength(1)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('settles a failed PDF export when no notification can reach the destroyed renderer', async() => {
    const send = vi.fn((_channel: string, _payload?: unknown) => {
      throw new Error('destroyed renderer')
    })
    const printToPDF = vi.fn(() => Promise.reject(new Error('Chromium PDF failure')))
    const win = { webContents: { send, printToPDF } }
    const sender = {}
    fromWebContents.mockReturnValue(win)
    showSaveDialog.mockResolvedValue({
      filePath: '/tmp/review.pdf',
      canceled: false
    })

    await expect(exportHandler()(
      { sender },
      { type: 'pdf', pathname: '/tmp/review.md', title: 'Review' }
    )).resolves.toBeUndefined()

    expect(send).toHaveBeenCalledWith('mt::show-notification', {
      title: 'Export failure',
      type: 'error',
      message: 'Chromium PDF failure'
    })
    expect(send.mock.calls.filter(([channel]) =>
      channel === 'mt::print-service-clearup')).toHaveLength(1)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('settles a completed PDF export when its success notification loses the renderer', async() => {
    const send = vi.fn((_channel: string, _payload?: unknown) => {
      throw new Error('destroyed renderer')
    })
    const pdf = new Uint8Array([37, 80, 68, 70])
    const printToPDF = vi.fn(() => Promise.resolve(pdf))
    const win = { webContents: { send, printToPDF } }
    const sender = {}
    fromWebContents.mockReturnValue(win)
    showSaveDialog.mockResolvedValue({
      filePath: '/tmp/review.pdf',
      canceled: false
    })

    await expect(exportHandler()(
      { sender },
      { type: 'pdf', pathname: '/tmp/review.md', title: 'Review' }
    )).resolves.toBeUndefined()

    expect(writeFile).toHaveBeenCalledWith('/tmp/review.pdf', pdf, '.pdf', 'binary')
    expect(send).toHaveBeenCalledWith('mt::export-success', {
      type: 'pdf',
      filePath: '/tmp/review.pdf'
    })
    expect(send).not.toHaveBeenCalledWith(
      'mt::show-notification',
      expect.anything()
    )
    expect(send.mock.calls.filter(([channel]) =>
      channel === 'mt::print-service-clearup')).toHaveLength(1)
  })

  it('prints background graphics and clears the temporary document after Electron finishes', async() => {
    const send = vi.fn()
    const print = vi.fn()
    const webContents = { send, print }
    const sender = {}
    fromWebContents.mockReturnValue({ webContents })

    await printHandler()({ sender })

    expect(print).toHaveBeenCalledWith(
      { printBackground: true },
      expect.any(Function)
    )
    expect(send).not.toHaveBeenCalledWith('mt::print-service-clearup')

    const completion = print.mock.calls[0]?.[1] as
      | ((success: boolean, failureReason: string) => void)
      | undefined
    completion?.(false, 'printer unavailable')

    expect(send).toHaveBeenCalledWith('mt::print-service-clearup')
    expect(send.mock.calls.filter(([channel]) =>
      channel === 'mt::print-service-clearup')).toHaveLength(1)
  })

  it('settles the print response and clears the temporary document when native printing throws', async() => {
    const send = vi.fn()
    const print = vi.fn(() => {
      throw new Error('destroyed webContents')
    })
    const webContents = { send, print }
    const sender = {}
    fromWebContents.mockReturnValue({ webContents })

    await expect(printHandler()({ sender })).resolves.toBeUndefined()

    expect(send.mock.calls.filter(([channel]) =>
      channel === 'mt::print-service-clearup')).toHaveLength(1)
  })

  it('contains a late cleanup failure after native printing completes', async() => {
    const send = vi.fn((channel: string) => {
      if (channel === 'mt::print-service-clearup') {
        throw new Error('destroyed renderer')
      }
    })
    const print = vi.fn()
    const webContents = { send, print }
    const sender = {}
    fromWebContents.mockReturnValue({ webContents })

    await printHandler()({ sender })

    const completion = print.mock.calls[0]?.[1] as
      | ((success: boolean, failureReason: string) => void)
      | undefined
    expect(() => completion?.(true, '')).not.toThrow()
    expect(send.mock.calls.filter(([channel]) =>
      channel === 'mt::print-service-clearup')).toHaveLength(1)
  })
})

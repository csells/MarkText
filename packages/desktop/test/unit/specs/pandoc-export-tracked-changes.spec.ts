import { execFileSync, spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// End to end with the installed pandoc: the renderer builds the
// payload from Core, the main process converts it, and the files are read back.

const { handlers, showSaveDialog, sent } = vi.hoisted(() => {
  type StubWindow = {
    path?: { sep: string; dirname: (p: string) => string; basename: (p: string) => string }
    electron?: Record<string, unknown>
  }
  const w = globalThis as unknown as { window?: StubWindow }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p, basename: (p: string) => p }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {} }
  }
  return {
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    showSaveDialog: vi.fn(),
    sent: [] as Array<{ channel: string; payload: Record<string, unknown> }>
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener)
    },
    handle: () => {},
    emit: () => {}
  },
  dialog: { showSaveDialog },
  BrowserWindow: {
    fromWebContents: () => ({
      id: 1,
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, payload: Record<string, unknown>) => {
          sent.push({ channel, payload })
        }
      }
    }),
    getAllWindows: () => []
  },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
  app: { getPath: () => os.tmpdir(), getVersion: () => '0.0.0' }
}))
vi.mock('electron-log', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('electron-updater', () => ({ autoUpdater: { on: vi.fn(), checkForUpdates: vi.fn() } }))
// `main/filesystem` reaches the native `ced` addon, built for Electron's ABI, not this Node.
vi.mock('ced', () => ({ default: () => 'UTF-8' }))
vi.mock('main_renderer/i18n', () => ({
  t: (key: string) => key,
  getCurrentLanguage: () => 'en'
}))
vi.mock('@/services/notification', () => ({ default: { notify: vi.fn(), name: 'notify' } }))

await import('main_renderer/menu/actions/file')
const { useEditorStore } = await import('@/store/editor')

const pandocVersion = spawnSync(process.env.MARKTEXT_PANDOC || 'pandoc', ['--version'], {
  encoding: 'utf8'
})
const pandocMissing = pandocVersion.status !== 0

const DOCUMENT = [
  'Keep {++added++} and {--removed--} then {~~old~>new~~}.',
  '',
  'A {==marked==}{>>why<<} phrase, a {==lit==} word and a remark{>>note<<} here.',
  ''
].join('\n')

const exportAs = async(target: string, dir: string, extension: string): Promise<string> => {
  const outputPath = path.join(dir, `note${extension}`)
  showSaveDialog.mockResolvedValue({ filePath: outputPath, canceled: false })
  const send = vi.spyOn(window.electron.ipcRenderer, 'send')
  const store = useEditorStore()
  store.currentFile = { id: 'note', pathname: path.join(dir, 'note.md'), markdown: DOCUMENT } as never
  await store.EXPORT_PANDOC(target)
  const payload = send.mock.calls.find((call) => call[0] === 'mt::response-pandoc-export')?.[1]
  send.mockRestore()
  if (payload === undefined) throw new Error('The renderer sent no pandoc export')
  const handler = handlers.get('mt::response-pandoc-export')
  if (handler === undefined) throw new Error('The pandoc export handler is not registered')
  await handler({ sender: {} }, payload)
  const failure = sent.find((entry) => entry.channel === 'mt::show-notification')
  if (failure !== undefined) throw new Error(String(failure.payload.message))
  return outputPath
}

const docxPart = (docx: string, part: string): string =>
  execFileSync('unzip', ['-p', docx, part], { encoding: 'utf8' })

describe.skipIf(pandocMissing)('pandoc export of tracked changes (installed pandoc)', () => {
  let dir: string

  beforeEach(() => {
    setActivePinia(createPinia())
    sent.length = 0
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-pandoc-tracked-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('writes suggestions as Word tracked changes and comments as Word comments', async() => {
    const docx = await exportAs('docx', dir, '.docx')
    const xml = docxPart(docx, 'word/document.xml')
    const inserted = [...xml.matchAll(/<w:ins [^>]*>([\s\S]*?)<\/w:ins>/g)].map((match) =>
      [...match[1]!.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((text) => text[1]).join('')
    )
    const deleted = [...xml.matchAll(/<w:del [^>]*>([\s\S]*?)<\/w:del>/g)].map((match) =>
      [...match[1]!.matchAll(/<w:delText[^>]*>([^<]*)<\/w:delText>/g)].map((text) => text[1]).join('')
    )
    expect(inserted).toEqual(['added', 'new'])
    expect(deleted).toEqual(['removed', 'old'])
    expect(xml.match(/<w:commentRangeStart /g)).toHaveLength(2)
    expect(xml.match(/<w:commentRangeEnd /g)).toHaveLength(2)
    // The commented range covers exactly the highlighted text.
    expect(xml).toMatch(/<w:commentRangeStart w:id="0" \/>[\s\S]*?>marked<[\s\S]*?<w:commentRangeEnd w:id="0" \/>/)
    expect(xml).toMatch(/<w:highlight w:val="yellow" \/>[\s\S]*?>lit</)
    expect(xml).not.toMatch(/\{\+\+|\+\+\}|\{--|\{~~|~>|\{==|\{>>|<<\}/)

    const comments = docxPart(docx, 'word/comments.xml')
    const bodies = [...comments.matchAll(/<w:comment [^>]*>([\s\S]*?)<\/w:comment>/g)].map((match) =>
      [...match[1]!.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((text) => text[1]).join('')
    )
    expect(bodies).toEqual(['why', 'note'])
    expect(comments.match(/w:author="unknown"/g)).toHaveLength(2)
  })

  it('writes the Revised text to every other format', async() => {
    const rst = fs.readFileSync(await exportAs('rst', dir, '.rst'), 'utf8')
    expect(rst.replace(/\s+/g, ' ').trim()).toBe(
      'Keep added and then new. A marked phrase, a lit word and a remark here.'
    )
  })
})

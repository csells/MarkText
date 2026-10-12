import type * as childProcess from 'child_process'
import { execFileSync, spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Plan 0012 G40, end to end with the installed pandoc: the renderer builds the
// Pandoc AST from Core, the main process converts it, and the files are read
// back. pandoc must never be handed Markdown to read.

const { handlers, showSaveDialog, sent, spawned } = vi.hoisted(() => {
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
    sent: [] as Array<{ channel: string; payload: Record<string, unknown> }>,
    spawned: [] as string[][]
  }
})

// Every pandoc argv is recorded, so the readers it was asked to use can be checked.
vi.mock('child_process', async(importOriginal) => {
  const actual = await importOriginal<typeof childProcess>()
  const spawn = ((command: string, args: readonly string[] = [], options?: object) => {
    spawned.push([command, ...args])
    return actual.spawn(command, args as string[], options ?? {})
  }) as typeof actual.spawn
  return { ...actual, default: { ...actual, spawn }, spawn }
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
const { usePreferencesStore } = await import('@/store/preferences')

const pandocMissing = spawnSync(process.env.MARKTEXT_PANDOC || 'pandoc', ['--version']).status !== 0

const ORDINARY = [
  '---',
  'title: Field *notes*',
  '---',
  '',
  '# Survey results',
  '',
  'Some *emphasis*, **strong**, ~~gone~~ and `code`, with a [link](https://example.com "Site")',
  'and a note[^1].',
  '',
  '1) first',
  '2) second',
  '',
  '- [x] done',
  '',
  '| Left | Right |',
  '|:-----|------:|',
  '| a    | b     |',
  '',
  '```python',
  'print("hi")',
  '```',
  '',
  '$$',
  'E=mc^2',
  '$$',
  '',
  '[^1]: The footnote.',
  ''
].join('\n')

const REVIEWED = [
  '# Plan {++v2++}',
  '',
  'Keep {++added++} {--removed--} {~~old~>new~~} {==marked==}{>>why<<} {==lit==} end{>>note<<}.',
  '',
  'Nested {++outer {--inner--} text++} here.',
  '',
  'Cross {--gone',
  '',
  'still gone--} after.',
  ''
].join('\n')

const exportAs = async(source: string, target: string, dir: string, extension: string): Promise<string> => {
  const outputPath = path.join(dir, `note-${target}${extension}`)
  showSaveDialog.mockResolvedValue({ filePath: outputPath, canceled: false })
  const send = vi.spyOn(window.electron.ipcRenderer, 'send')
  const store = useEditorStore()
  store.currentFile = { id: 'note', pathname: path.join(dir, 'note.md'), markdown: source } as never
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

const zipPart = (file: string, part: string): string =>
  execFileSync('unzip', ['-p', file, part], { encoding: 'utf8' })

const text = (markup: string): string =>
  markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

/** Every reader pandoc was started with; the export may only use JSON and native. */
const readers = (): string[] =>
  spawned.flatMap((argv) => argv.flatMap((arg, index) => (arg === '-f' ? [argv[index + 1]!] : [])))

describe.skipIf(pandocMissing)('pandoc export built from Core (installed pandoc)', () => {
  let dir: string

  beforeEach(() => {
    setActivePinia(createPinia())
    usePreferencesStore().footnote = true
    sent.length = 0
    spawned.length = 0
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-pandoc-formats-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('writes an ordinary document to EPUB\'s HTML the way the editor reads it', async() => {
    const epub = await exportAs(ORDINARY, 'epub', dir, '.epub')
    const parts = execFileSync('unzip', ['-Z1', epub], { encoding: 'utf8' }).split('\n')
    const html = parts
      .filter((name) => /text\/ch\d+\.xhtml$/.test(name))
      .map((chapter) => zipPart(epub, chapter))
      .join('\n')
    expect(html).toMatch(/<section id="survey-results"[^>]*>\s*<h1>Survey results<\/h1>/)
    expect(html).toContain('<em>emphasis</em>')
    expect(html).toContain('<del>gone</del>')
    expect(html).toContain('<a href="https://example.com" title="Site">link</a>')
    expect(html).toMatch(/<ol type="1">/)
    expect(html).toContain('<input type="checkbox" checked="" />done')
    expect(html).toMatch(/<td style="text-align: right;">\s*b\s*<\/td>/)
    expect(html).toContain('class="sourceCode python"')
    expect(html).toContain('E=mc^2')
    expect(html).toMatch(/<aside epub:type="footnote"[^>]*>\s*<p>The footnote\.<\/p>/)
    expect(readers().every((reader) => reader === 'json' || reader === 'native')).toBe(true)
  })

  it('writes an ordinary document to docx, rst, LaTeX, ODT and EPUB', async() => {
    const docx = text(zipPart(await exportAs(ORDINARY, 'docx', dir, '.docx'), 'word/document.xml'))
    expect(docx).toContain('Field notes')
    expect(docx).toContain('Survey results')
    expect(docx).toContain('print ( &quot;hi&quot; )')

    const rst = fs.readFileSync(await exportAs(ORDINARY, 'rst', dir, '.rst'), 'utf8')
    expect(rst).toContain('Survey results\n==============')
    expect(rst).toContain('1) first')
    expect(rst).toContain('.. code:: python')

    const latex = fs.readFileSync(await exportAs(ORDINARY, 'latex', dir, '.tex'), 'utf8')
    expect(latex).toContain('\\section{Survey results}\\label{survey-results}')
    expect(latex).toContain('\\footnote{The footnote.}')
    expect(latex).toContain('\\title{Field \\emph{notes}}')

    const odt = text(zipPart(await exportAs(ORDINARY, 'odt', dir, '.odt'), 'content.xml'))
    expect(odt).toContain('Survey results')
    expect(odt).toContain('The footnote.')

    expect(readers().every((reader) => reader === 'json' || reader === 'native')).toBe(true)
  })

  it('writes suggestions, nested and across blocks, as Word tracked changes', async() => {
    const xml = zipPart(await exportAs(REVIEWED, 'docx', dir, '.docx'), 'word/document.xml')
    const runs = (tag: 'ins' | 'del', textTag: string): string[] =>
      [...xml.matchAll(new RegExp(`<w:${tag} [^>]*>([\\s\\S]*?)</w:${tag}>`, 'g'))].map((match) =>
        [...match[1]!.matchAll(new RegExp(`<w:${textTag}[^>]*>([^<]*)</w:${textTag}>`, 'g'))].map((t) => t[1]).join('')
      )
    expect(runs('ins', 't')).toEqual(expect.arrayContaining(['v2', 'added', 'new', 'outer ', ' text']))
    expect(runs('del', 'delText')).toEqual(expect.arrayContaining(['removed', 'old', 'inner', 'gone', 'still gone']))
    expect(xml.match(/<w:commentRangeStart /g)).toHaveLength(2)
    expect(xml).not.toMatch(/\{\+\+|\+\+\}|\{--|\{~~|~>|\{==|\{>>|<<\}/)
  })

  it.each([
    ['rst', '.rst'],
    ['odt', '.odt'],
    ['latex', '.tex'],
    ['epub', '.epub']
  ])('writes the Revised text to %s', async(target, extension) => {
    const file = await exportAs(REVIEWED, target, dir, extension)
    const output =
      target === 'odt'
        ? zipPart(file, 'content.xml')
        : target === 'epub'
          ? execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' })
            .split('\n')
            .filter((name) => /text\/ch\d+\.xhtml$/.test(name))
            .map((chapter) => zipPart(file, chapter))
            .join('\n')
          : fs.readFileSync(file, 'utf8')
    const flat = text(output).replace(/\\[a-z]+\{|[{}]/g, ' ').replace(/\s+/g, ' ')
    for (const kept of ['Plan v2', 'Keep added new marked lit end', 'Nested outer text here', 'Cross after']) {
      expect(flat).toContain(kept)
    }
    for (const gone of ['removed', 'old', 'inner', 'gone', 'why', 'note']) {
      expect(flat).not.toMatch(new RegExp(`\\b${gone}\\b`))
    }
    expect(output).not.toMatch(/\{\+\+|\+\+\}|\{--|\{~~|~>|\{==|\{>>|<<\}/)
  })
})

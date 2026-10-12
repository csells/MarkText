import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.fn()

// `pandoc.ts` reaches `child_process` through a default import, so does the mock.
vi.mock('child_process', () => {
  const spawn = (...args: unknown[]) => spawnMock(...args)
  return { default: { spawn }, spawn }
})

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import pandoc, {
  PANDOC_EXPORT_FORMATS,
  findOnPath,
  formatLinksMedia,
  getPandocLanguage,
  isRemoteMedia,
  listLinkedMedia,
  pandocLocations,
  shouldMirrorMedia,
  toPandocJson,
  type PandocToFileOptions
} from 'main_renderer/utils/pandoc'

/**
 * The ChildProcess `spawn` would hand back; stdin is an emitter so the EPIPE is
 * testable. The command is resolved before the spawn, so `spawned` says when
 * the stub is actually in use rather than polling for it.
 */
const startProcess = () => {
  let inUse!: () => void
  const spawned = new Promise<void>((resolve) => {
    inUse = resolve
  })
  const proc = Object.assign(new EventEmitter(), {
    stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
    stderr: new EventEmitter(),
    stdout: new EventEmitter(),
    spawned: () => spawned
  })
  spawnMock.mockImplementation(() => {
    inUse()
    return proc
  })
  return proc
}

/** The spawn stub plus the pending conversion, stderr emitted before the exit included. */
const runToFile = async(
  to: string,
  outputPath: string,
  { input = 'x', stderr = '', code = 0, ...options }: PandocToFileOptions & {
    input?: string
    stderr?: string
    code?: number
  } = {}
) => {
  const proc = startProcess()
  const done = pandoc.toFile(to, outputPath, input, options)
  await proc.spawned()
  if (stderr) proc.stderr.emit('data', Buffer.from(stderr))
  proc.emit('close', code)
  return { proc, done }
}

/** Throwaway folders the command-lookup specs put a file in; removed after each one. */
const lookupFolders: string[] = []

const makeLookupFolder = (): string => {
  const folder = mkdtempSync(path.join(tmpdir(), 'marktext-pandoc-lookup-'))
  lookupFolders.push(folder)
  return folder
}

describe('pandoc export', () => {
  beforeEach(() => {
    // A real executable, so resolution stops at the override. child_process is
    // mocked here, and a fall-through to the login shell would hang on it.
    process.env.MARKTEXT_PANDOC = process.execPath
  })

  afterEach(() => {
    spawnMock.mockReset()
    delete process.env.MARKTEXT_PANDOC
    for (const folder of lookupFolders.splice(0)) {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  // The formats of #2103/#3917 minus OPML, whose writer puts the document in one attribute.
  it('offers the requested formats', () => {
    const ids = PANDOC_EXPORT_FORMATS.map((f) => f.id)
    expect(ids).toEqual(expect.arrayContaining(['docx', 'odt', 'epub']))
    expect(ids).not.toContain('opml')
  })

  // pandoc ships no `zh`/`zh-CN`/`zh-TW`, and an unresolvable `lang` warns on every export (#5379).
  it('spells the Chinese region as the script subtag pandoc carries', () => {
    expect(getPandocLanguage('zh-CN')).toBe('zh-Hans')
    expect(getPandocLanguage('zh_SG')).toBe('zh-Hans')
    expect(getPandocLanguage('zh-TW')).toBe('zh-Hant')
    expect(getPandocLanguage('zh-Hant')).toBe('zh-Hant')
    expect(getPandocLanguage('en-US')).toBe('en-US')
    expect(getPandocLanguage('ja')).toBe('ja')
  })

  // The argv is asserted because `cwd` is what makes `![](pics/a.png)` resolve, and
  // because pandoc reads only the JSON AST built from Core, never Markdown.
  it('spawns the named binary reading JSON into the target asked for', async() => {
    const { proc, done } = await runToFile('docx', '/tmp/notes.docx', {
      input: '{"blocks":[]}',
      cwd: '/docs/notes'
    })

    await expect(done).resolves.toEqual({ warnings: '' })
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      ['-f', 'json', '-t', 'docx', '-s', '-o', '/tmp/notes.docx'],
      { cwd: '/docs/notes' }
    )
    expect(proc.stdin.end).toHaveBeenCalledWith('{"blocks":[]}')

    await expect(pandoc.exists()).resolves.toBe(true)
  })

  // pandoc splits `--metadata` on the first colon only, so "Q3: plan" survives.
  it('passes metadata on as --metadata key:value, dropping empty values', async() => {
    const { done } = await runToFile('epub3', '/tmp/x.epub', {
      metadata: { title: 'Notes: draft', lang: 'zh-Hans', author: '' }
    })
    await done

    const args = spawnMock.mock.calls.at(-1)?.[1] as string[]
    expect(args).toContain('--metadata=title:Notes: draft')
    expect(args).toContain('--metadata=lang:zh-Hans')
    expect(args.some((arg) => arg.startsWith('--metadata=author'))).toBe(false)
    expect(args.slice(-2)).toEqual(['-o', '/tmp/x.epub'])
  })

  // Exit code 0 is not clean: stderr holds the warnings and names the failing position.
  it('reports the warnings of a run that worked and the stderr of one that did not', async() => {
    const { done } = await runToFile('docx', '/tmp/x.docx', {
      stderr: '[WARNING] Could not fetch resource pics/a.png: replacing image with description\n'
    })
    await expect(done).resolves.toEqual({
      warnings: '[WARNING] Could not fetch resource pics/a.png: replacing image with description'
    })

    const { done: broken } = await runToFile('docx', '/tmp/x.docx', {
      code: 1,
      stderr: 'pandoc: Unknown output format docx\n'
    })
    await expect(broken).rejects.toThrow('Unknown output format docx')

    const { done: quiet } = await runToFile('docx', '/tmp/x.docx', { code: 3 })
    await expect(quiet).rejects.toThrow('pandoc exited with code 3')
  })

  // Without a listener the EPIPE is uncaught; a binary that never starts rejects through `error`.
  it('survives an EPIPE on stdin and a binary that cannot be spawned', async() => {
    const proc = startProcess()
    const pending = pandoc.toFile('docx', '/tmp/x.docx', 'x'.repeat(70 * 1024))
    await proc.spawned()
    expect(() => proc.stdin.emit('error', new Error('write EPIPE'))).not.toThrow()
    proc.stderr.emit('data', Buffer.from('pandoc: Unknown output format broke\n'))
    proc.emit('close', 1)
    await expect(pending).rejects.toThrow('Unknown output format broke')

    const failing = startProcess()
    const missing = pandoc.toFile('docx', '/tmp/x.docx', 'x')
    await failing.spawned()
    failing.emit('error', new Error('spawn pandoc ENOENT'))
    await expect(missing).rejects.toThrow('spawn pandoc ENOENT')
  })

  // `pandoc.exe` sits in a `Pandoc` folder of each: the case the `PATH` check misses.
  it('looks for pandoc where the Windows installers put it', () => {
    const env = {
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      ProgramData: 'C:\\ProgramData',
      USERPROFILE: 'C:\\Users\\me'
    }

    // The package-manager shim dirs are not here: they serve every tool and
    // live in extraPathDirs.
    expect(pandocLocations('win32', env)).toEqual([
      path.join(env.ProgramFiles, 'Pandoc', 'pandoc.exe'),
      path.join(env['ProgramFiles(x86)'], 'Pandoc', 'pandoc.exe'),
      path.join(env.LOCALAPPDATA, 'Pandoc', 'pandoc.exe')
    ])
    expect(pandocLocations('linux', env)).toEqual([])
  })

  // `resolveCommand` names the bare command when PATH holds it, so the pane needs this to
  // turn that name into the file it stands for (#2751). `platform` and `env` pin it, rather
  // than whatever the machine running the suite happens to have installed.
  it('names the file PATH would run for pandoc', () => {
    const folder = makeLookupFolder()
    const binary = path.join(folder, 'pandoc.exe')
    writeFileSync(binary, '')
    chmodSync(binary, 0o755)
    writeFileSync(path.join(folder, 'pandoc.bat'), '')

    expect(findOnPath('pandoc', 'win32', { PATH: folder, PATHEXT: '.exe' })).toBe(binary)
    // A batch file cannot be spawned without a shell, so it is no path to offer.
    expect(findOnPath('pandoc', 'win32', { PATH: folder, PATHEXT: '.BAT' })).toBeNull()
    expect(findOnPath('pandoc', 'win32', { PATH: 'C:\\nowhere' })).toBeNull()
    expect(findOnPath('pandoc', 'win32', {})).toBeNull()
  })

  // The plain-text writers keep `pics/a.png` as a link, so pandoc copies the pictures along.
  it('mirrors the document images next to the export', async() => {
    const { done } = await runToFile('rst', '/tmp/out/notes.rst', {
      cwd: '/docs/notes',
      resourcePath: '/docs/notes',
      mirrorMedia: true
    })
    await done

    const args = spawnMock.mock.calls.at(-1)?.[1] as string[]
    expect(args).toContain('--extract-media=.')
    expect(args).toContain('--resource-path=/docs/notes')
    expect(spawnMock).toHaveBeenLastCalledWith(expect.any(String), args, { cwd: '/tmp/out' })
  })

  // Only a link pandoc reads from disk is mirrored; one that needs the network is left alone.
  it('tells the links that need the network apart from the file links', () => {
    expect(isRemoteMedia('https://example.com/b.png')).toBe(true)
    expect(isRemoteMedia('//example.com/b.png')).toBe(true)
    expect(isRemoteMedia('pics/a.png')).toBe(false)
    expect(isRemoteMedia('C:/docs/pics/a.png')).toBe(false)
    // Two backslashes open a file over SMB, they do not fetch a URL.
    expect(isRemoteMedia('\\\\srv\\pics\\a.png')).toBe(false)
    expect(isRemoteMedia('../outside.png')).toBe(false)
    expect(isRemoteMedia('data:image/png;base64,x')).toBe(false)
    expect(formatLinksMedia('rst')).toBe(true)
    expect(formatLinksMedia('docx')).toBe(false)
  })

  // `--extract-media` replaces a link it cannot read with the alt text, which is exactly what
  // a never-saved document's relative links are — no folder to read them from (#5379).
  it('mirrors only the links the export is able to read', () => {
    const dir = path.dirname(path.resolve('/docs/notes.md'))
    const out = path.resolve('/out/notes.rst')

    expect(shouldMirrorMedia(['pics/a.png'], dir, out)).toBe(true)
    expect(shouldMirrorMedia([path.resolve('/docs/pics/a.png')], dir, out)).toBe(true)
    // No path yet: an absolute link needs no folder to be read from, a relative one does.
    expect(shouldMirrorMedia(['pics/a.png'], undefined, out)).toBe(false)
    expect(shouldMirrorMedia([path.resolve('/docs/pics/a.png')], undefined, out)).toBe(true)
    // A download that fails costs the picture, and the document's own folder needs no copy.
    expect(shouldMirrorMedia(['https://example.com/b.png'], dir, out)).toBe(false)
    expect(shouldMirrorMedia(['pics/a.png'], dir, path.join(dir, 'notes.rst'))).toBe(false)
    // The same folder spelled by hand; `path.join` would resolve the `..` and hide the case.
    expect(shouldMirrorMedia(['pics/a.png'], dir, `${dir}${path.sep}..${path.sep}${path.basename(dir)}${path.sep}notes.rst`)).toBe(false)
  })

  // The list comes from the AST built from Core, with no pandoc run; a raw `<img>` is raw text.
  it('lists the images of the document and its metadata', () => {
    const image = (url: string): unknown => ({ t: 'Image', c: [['', [], []], [], [url, '']] })
    expect(listLinkedMedia({
      meta: { cover: { t: 'MetaInlines', c: [image('cover.png')] } },
      blocks: [
        { t: 'Para', c: [image('pics/a.png'), { t: 'Link', c: [['', [], []], [image('pics/c.png')], ['x.md', '']] }] },
        { t: 'RawBlock', c: ['html', '<img src="pics/b.png">'] }
      ]
    })).toEqual(['pics/a.png', 'pics/c.png', 'cover.png'])
    expect(spawnMock).not.toHaveBeenCalled()
  })

  // pandoc's JSON reader refuses another API version, and only its text readers normalize to NFC.
  it('stamps the running pandoc\'s API version on the document, composed to NFC', async() => {
    const proc = startProcess()
    const pending = toPandocJson({ meta: {}, blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'cafe\u0301' }] }] })
    await proc.spawned()
    proc.stdout.emit('data', Buffer.from('{"pandoc-api-version":[1,23,1],"meta":{},"blocks":[]}'))
    proc.emit('close', 0)

    expect(JSON.parse(await pending)).toEqual({
      'pandoc-api-version': [1, 23, 1],
      meta: {},
      blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'caf\u00e9' }] }]
    })
    // The native reader states the version without reading any Markdown.
    expect(spawnMock).toHaveBeenCalledWith(expect.any(String), ['-f', 'native', '-t', 'json'])
    expect(proc.stdin.end).toHaveBeenCalledWith('[]')
  })
})

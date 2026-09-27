// Copy from https://github.com/utatti/simple-pandoc/blob/master/index.js
import { spawn } from 'child_process'
import path from 'path'
import { isExecutableFile } from 'common/filesystem'
import { resolveCommand } from './resolveCommand'
import type { PandocDocument } from '@shared/types/files'
import type { PandocCommandInfo } from '@shared/types/pandoc'

const pandocCommand = 'pandoc'

/** Targets offered by "File → Convert with Pandoc"; `label` is not translated. */
export interface PandocExportFormat {
  id: string
  label: string
  target: string
  extension: string
}

export const PANDOC_EXPORT_FORMATS: readonly PandocExportFormat[] = Object.freeze([
  { id: 'docx', label: 'Word (.docx)', target: 'docx', extension: '.docx' },
  { id: 'odt', label: 'OpenDocument (.odt)', target: 'odt', extension: '.odt' },
  { id: 'rtf', label: 'RTF (.rtf)', target: 'rtf', extension: '.rtf' },
  { id: 'epub', label: 'EPUB (.epub)', target: 'epub3', extension: '.epub' },
  { id: 'latex', label: 'LaTeX (.tex)', target: 'latex', extension: '.tex' },
  { id: 'rst', label: 'reStructuredText (.rst)', target: 'rst', extension: '.rst' },
  { id: 'org', label: 'Org mode (.org)', target: 'org', extension: '.org' },
  { id: 'mediawiki', label: 'MediaWiki (.wiki)', target: 'mediawiki', extension: '.wiki' },
  { id: 'textile', label: 'Textile (.textile)', target: 'textile', extension: '.textile' }
])

// These writers have no container to inline an image into: pandoc leaves a plain link.
export const formatLinksMedia = (target: string): boolean =>
  ['latex', 'rst', 'org', 'mediawiki', 'textile'].includes(target)

// What pandoc fetches over the network instead of opening: `https:` or its protocol-
// relative form. A path written with backslashes is a file, and mirrors like a local one.
export const isRemoteMedia = (url: string): boolean => /^(https?:)?\/\//i.test(url)

// Whether the export should carry the document's pictures along (`--extract-media`). It
// replaces a link it cannot read with the alt text, so mirror only the links that resolve: a
// saved document reads relative links from its own folder, an absolute link needs no folder,
// a never-saved one has neither, and a remote picture is downloaded instead (a failed fetch
// costs it). Its own folder needs no copy either: `C:/a` and `C:\a` are the same folder.
export const shouldMirrorMedia = (
  links: string[],
  sourceDir: string | undefined,
  outputPath: string
): boolean =>
  !links.some(isRemoteMedia) &&
  (!!sourceDir || links.every((url) => path.isAbsolute(url))) &&
  (sourceDir === undefined || path.relative(sourceDir, path.dirname(outputPath)) !== '')

// pandoc knows no `zh`/`zh-CN` and would warn, so Chinese takes the script subtag.
export const getPandocLanguage = (locale: string): string => {
  const [language, region = ''] = locale.trim().split(/[-_]/)
  if (language?.toLowerCase() !== 'zh') return locale
  return /^(hant|tw|hk|mo)$/i.test(region) ? 'zh-Hant' : 'zh-Hans'
}

// Windows only: the installer can be told not to touch `PATH` and a portable copy never is
// (#2751). These are the folders it writes — the package-manager shim dirs are every
// tool's business and live in `extraPathDirs`. The arguments let a spec pin both.
export const pandocLocations = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] => {
  if (platform !== 'win32') return []
  return [
    env.ProgramFiles && path.join(env.ProgramFiles, 'Pandoc', 'pandoc.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Pandoc', 'pandoc.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Pandoc', 'pandoc.exe')
  ].filter((candidate): candidate is string => !!candidate)
}

/** Node refuses to spawn a `.bat`/`.cmd` without `shell: true` (CVE-2024-27980). */
const isBatchFile = (
  command: string,
  platform: NodeJS.Platform = process.platform
): boolean => platform === 'win32' && /\.(bat|cmd)$/i.test(command.trim())

const resolve = async(): Promise<string | null> => {
  const override = process.env.MARKTEXT_PANDOC
  // Naming a batch file is as unusable as naming one that is not there.
  if (override && isBatchFile(override)) return null
  return resolveCommand(pandocCommand, {
    override,
    preferred: pandocLocations(process.platform, process.env)
  })
}

let found: Promise<string> | undefined

/**
 * The one resolution `exists` and every spawn share — a bare name means PATH
 * found it, which a caller must not confuse with the miss fallback below.
 *
 * A hit is remembered: resolution costs a blocking `command -v`, and one
 * export asks three times (the gate, the media listing, the conversion). A
 * miss is not, or the notice inviting the user to install pandoc would be
 * unanswerable without a restart.
 */
const findCommand = (): Promise<string | null> => {
  found ??= resolve().then((command) => command ?? Promise.reject(new Error('pandoc missing')))
  return found.catch(() => {
    found = undefined
    return null
  })
}

/** The bare name is the fallback, so a miss still spawns and reports why. */
const getCommand = async(): Promise<string> => (await findCommand()) ?? pandocCommand

interface PandocFn {
  (from: string, to: string, ...args: string[]): Promise<string>
  exists: () => Promise<boolean>
  toFile: (
    to: string,
    outputPath: string,
    input: string,
    options?: PandocToFileOptions
  ) => Promise<PandocToFileResult>
}

const pandoc = (async(from: string, to: string, ...args: string[]): Promise<string> => {
  const command = await getCommand()
  const option = ['-s', from, '-t', to].concat(args)
  return new Promise((resolve, reject) => {
    const proc = spawn(command, option)
    proc.on('error', reject)
    let data = ''
    proc.stdout.on('data', (chunk: Buffer | string) => {
      data += chunk.toString()
    })
    proc.stdout.on('end', () => resolve(data))
    proc.stdout.on('error', reject)
    proc.stdin.end()
  })
}) as PandocFn

pandoc.exists = async(): Promise<boolean> => (await findCommand()) !== null

// The file `PATH` would run for `command`, or `null` when it holds none.
export const findOnPath = (
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string | null => {
  const separator = platform === 'win32' ? ';' : ':'
  // Windows runs a bare name by extension, so the `PATHEXT` spellings are what make it one.
  const suffixes =
    platform === 'win32'
      ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : ['']
  for (const folder of (env.PATH ?? '').split(separator)) {
    if (!folder) continue
    for (const suffix of suffixes) {
      const candidate = path.join(folder, `${command}${suffix}`)
      if (!isBatchFile(candidate, platform) && isExecutableFile(candidate)) return candidate
    }
  }
  return null
}

// The binary the preference pane names, which `exists()` cannot: a bare name from
// `resolveCommand` becomes the file PATH resolves it to. When PATH holds nothing spawnable
// the name is still reported — pandoc is installed, so Not found would be wrong (#2751).
export const resolvePandocCommand = async(): Promise<PandocCommandInfo> => {
  const command = await findCommand()
  if (!command) return { command: null }
  return { command: path.isAbsolute(command) ? command : findOnPath(command) ?? command }
}

export interface PandocToFileOptions {
  /** Folder the document's relative links resolve against, or pandoc uses cwd. */
  cwd?: string
  /** Folder the images are read from once they are mirrored; see `mirrorMedia`. */
  resourcePath?: string
  /** Copy the document's images into the output's folder and rewrite the links. */
  mirrorMedia?: boolean
  metadata?: Record<string, string>
}

export interface PandocToFileResult {
  /** Pandoc's stderr from a successful run — the warnings exit code 0 would hide. */
  warnings: string
}

/**
 * Convert `input`, a Pandoc JSON document (see `toPandocJson`), to `outputPath`;
 * the converter above cannot serve binary targets.
 */
pandoc.toFile = async(
  to: string,
  outputPath: string,
  input: string,
  options: PandocToFileOptions = {}
): Promise<PandocToFileResult> => {
  const command = await getCommand()
  return new Promise((resolve, reject) => {
    const { cwd, metadata = {}, resourcePath, mirrorMedia } = options
    const option = ['-f', 'json', '-t', to, '-s']
    // pandoc splits `--metadata` on the first colon only, so "Q3: plan" survives.
    for (const [key, value] of Object.entries(metadata)) {
      if (value) option.push(`--metadata=${key}:${value}`)
    }
    if (mirrorMedia) {
      // `--extract-media=.` copies every image pandoc can read — an absolute link
      // included — to the output's folder and rewrites the link to match.
      option.push('--extract-media=.')
      if (resourcePath) option.push(`--resource-path=${resourcePath}`)
    }
    option.push('-o', outputPath)
    // The links pandoc writes are relative to where it runs, so a mirrored export has
    // to run in the folder it is written to.
    const proc = spawn(command, option, { cwd: mirrorMedia ? path.dirname(outputPath) : cwd })
    let errorOutput = ''
    proc.on('error', reject)
    proc.stderr.on('data', (chunk: Buffer | string) => {
      errorOutput += chunk.toString()
    })
    // An unknown writer exits before draining stdin; the EPIPE would be uncaught.
    proc.stdin.on('error', () => {})
    proc.on('close', (code: number | null) => {
      if (code === 0) {
        resolve({ warnings: errorOutput.trim() })
      } else {
        // stderr names the offending source position, so prefer it to the code.
        reject(new Error(errorOutput.trim() || `pandoc exited with code ${String(code)}`))
      }
    })
    proc.stdin.end(input)
  })
}

// The pictures an export mirrors: every image target, in the document or its
// metadata. A raw HTML `<img>` is raw text to pandoc, so it is not listed.
export const listLinkedMedia = (document: PandocDocument): string[] => {
  const urls: string[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
    } else if (value !== null && typeof value === 'object') {
      const { t, c } = value as { t?: unknown; c?: unknown }
      const target = t === 'Image' && Array.isArray(c) ? c[2] : undefined
      if (Array.isArray(target) && typeof target[0] === 'string') urls.push(target[0])
      visit(c)
    }
  }
  visit(document.blocks)
  visit(Object.values(document.meta))
  return urls
}

/**
 * A document as the JSON pandoc reads. The JSON reader insists on the running
 * pandoc's API version, which an empty document from its native reader states.
 */
export const toPandocJson = async(document: PandocDocument): Promise<string> => {
  const command = await getCommand()
  const envelope = await new Promise<string>((resolve, reject) => {
    const proc = spawn(command, ['-f', 'native', '-t', 'json'])
    let output = ''
    let errorOutput = ''
    proc.on('error', reject)
    proc.stdout.on('data', (chunk: Buffer | string) => {
      output += chunk.toString()
    })
    proc.stderr.on('data', (chunk: Buffer | string) => {
      errorOutput += chunk.toString()
    })
    proc.stdin.on('error', () => {})
    proc.on('close', (code: number | null) => {
      if (code === 0) resolve(output)
      else reject(new Error(errorOutput.trim() || `pandoc exited with code ${String(code)}`))
    })
    proc.stdin.end('[]')
  })
  const { 'pandoc-api-version': version } = JSON.parse(envelope) as { 'pandoc-api-version': unknown }
  // pandoc's text readers normalize their input to NFC and its JSON reader does not.
  return JSON.stringify({ 'pandoc-api-version': version, meta: document.meta, blocks: document.blocks }).normalize('NFC')
}

export default pandoc

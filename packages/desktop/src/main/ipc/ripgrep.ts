import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import path from 'path'
import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import log from 'electron-log'
import { rgPath as bundledRgPath } from '@vscode/ripgrep'
import type {
  ProjectSearchRequest,
  ProjectSearchRequestOptions
} from '@shared/types/projectSearch'
import {
  readProjectSearchAuthority,
  type ProjectSearchSettings
} from '../projectSearch/projectSearchAuthority'
import { decodeProjectSearchRequest } from './projectSearchRuntimeCodec'

const resolveRgPath = (): string => {
  if (process.env.MARKTEXT_RIPGREP_PATH) return process.env.MARKTEXT_RIPGREP_PATH
  return bundledRgPath.replace(/\bapp\.asar\b/, 'app.asar.unpacked')
}

interface ActiveSearch {
  sender: WebContents
  cancel: () => void
}

const activeSearches = new Map<string, ActiveSearch>()

const sendIfAlive = (
  sender: WebContents | null | undefined,
  channel: string,
  ...args: unknown[]
): void => {
  try {
    if (sender && !sender.isDestroyed()) sender.send(channel, ...args)
  } catch {
    /* sender destroyed mid-send */
  }
}

const cleanupAtSenderDestroy = (sender: WebContents | null | undefined): void => {
  if (!sender) return
  const handler = (): void => {
    for (const [id, entry] of activeSearches.entries()) {
      if (entry.sender === sender) {
        entry.cancel()
        activeSearches.delete(id)
      }
    }
  }
  sender.once('destroyed', handler)
}

interface TextInput {
  text?: string
  bytes?: string
}

const getText = (input: TextInput): string =>
  'text' in input && input.text !== undefined
    ? input.text
    : Buffer.from(input.bytes ?? '', 'base64').toString()

const cleanResultLine = (lineText: TextInput): string => {
  const text = getText(lineText)
  return text[text.length - 1] === '\n' ? text.slice(0, -1) : text
}

const getPositionFromColumn = (lines: string[], column: number): [number, number] => {
  let currentLength = 0
  let currentLine = 0
  let previousLength = 0
  while (column >= currentLength) {
    previousLength = currentLength
    currentLength += lines[currentLine].length + 1
    currentLine++
  }
  return [currentLine - 1, column - previousLength]
}

interface RgSubmatch {
  start: number
  end: number
  match: TextInput
}

interface RgMatchData {
  lines: TextInput
  submatches: RgSubmatch[]
  line_number: number
  path: TextInput
}

interface RgMatch {
  matchText: string
  lineText: string
  range: [[number, number], [number, number]]
  leadingContextLines: unknown[]
  trailingContextLines: unknown[]
}

const processUnicodeMatch = (match: RgMatchData): void => {
  const text = getText(match.lines)
  if (text.length === Buffer.byteLength(text)) return
  let remainingBuffer = Buffer.from(text)
  let currentLength = 0
  let previousPosition = 0
  const convertPosition = (position: number): number => {
    const currentBuffer = remainingBuffer.slice(0, position - previousPosition)
    currentLength = currentBuffer.toString().length + currentLength
    remainingBuffer = remainingBuffer.slice(position - previousPosition)
    previousPosition = position
    return currentLength
  }
  for (const submatch of match.submatches) {
    submatch.start = convertPosition(submatch.start)
    submatch.end = convertPosition(submatch.end)
  }
}

const processSubmatch = (
  submatch: RgSubmatch,
  lineText: string,
  offsetRow: number
): { range: [[number, number], [number, number]]; lineText: string } => {
  const lineParts = lineText.split('\n')
  const start = getPositionFromColumn(lineParts, submatch.start)
  const end = getPositionFromColumn(lineParts, submatch.end)
  for (let i = start[0]; i > 0; i--) lineParts.shift()
  while (end[0] < lineParts.length - 1) lineParts.pop()
  start[0] += offsetRow
  end[0] += offsetRow
  return {
    range: [start, end],
    lineText: cleanResultLine({ text: lineParts.join('\n') })
  }
}

const prepareGlobs = (
  globs: readonly string[] | undefined,
  projectRootPath: string,
  sep?: string
): string[] => {
  const output: string[] = []
  for (let pattern of globs || []) {
    pattern = pattern.replace(new RegExp(`\\${sep || path.sep}`, 'g'), '/')
    if (pattern.length === 0) continue
    const projectName = path.basename(projectRootPath)
    if (pattern === projectName) {
      output.push('**/*')
      continue
    }
    if (pattern.startsWith(projectName + '/')) {
      pattern = pattern.slice(projectName.length + 1)
    }
    if (pattern.endsWith('/')) pattern = pattern.slice(0, -1)
    pattern = pattern.startsWith('**/') ? pattern : `**/${pattern}`
    output.push(pattern)
    output.push(pattern.endsWith('/**') ? pattern : `${pattern}/**`)
  }
  return output
}

const prepareRegexp = (regexpStr: string): string => {
  if (regexpStr === '--') return '\\-\\-'
  return regexpStr.replace(/\\\//g, '/')
}

const isMultilineRegexp = (regexpStr: string): boolean => regexpStr.includes('\\n')

interface SearchOptions extends ProjectSearchRequestOptions {
  readonly maxFileSize?: string
  readonly includeHidden?: boolean
  readonly noIgnore?: boolean
  readonly exclusions?: readonly string[]
}

interface ProjectSearchExecutionRequest extends ProjectSearchRequest {
  readonly settings: ProjectSearchSettings
}

export interface RipgrepSearchHandle {
  readonly cancel: () => void
}

const startTextSearch = (
  sender: WebContents,
  searchId: string,
  projectRoot: string,
  pattern: string,
  options: SearchOptions
): RipgrepSearchHandle => {
  const directories = [projectRoot]
  const rgPath = resolveRgPath()
  const children: ChildProcess[] = []
  let cancelled = false
  let pendingPaths = 0
  // Every mt::rg::match envelope is counted so the terminal can promise
  // the stream it ends (G28).
  let matchEnvelopes = 0
  let pendingDirs = directories.length
  let finished = false

  const finishIfDone = (err?: unknown): void => {
    if (finished) return
    if (pendingDirs === 0 || err) {
      finished = true
      activeSearches.delete(searchId)
      if (err) {
        sendIfAlive(sender, 'mt::rg::error', {
          searchId,
          error: err instanceof Error ? err.message : String(err)
        })
      } else {
        sendIfAlive(sender, 'mt::rg::done', { searchId, matchCount: matchEnvelopes })
      }
    }
  }

  const cancel = (): void => {
    cancelled = true
    for (const child of children) {
      try {
        child.kill()
      } catch {
        /* already dead */
      }
    }
    if (!finished) {
      finished = true
      activeSearches.delete(searchId)
      sendIfAlive(sender, 'mt::rg::cancelled', { searchId, matchCount: matchEnvelopes })
    }
  }
  for (const directoryPath of directories) {
    let regexpStr: string | null = null
    let textPattern: string | null = null
    const args = ['--json']
    if (options.isRegexp) {
      regexpStr = prepareRegexp(pattern)
      args.push('--regexp', regexpStr)
    } else {
      args.push('--fixed-strings')
      textPattern = pattern
    }
    if (regexpStr && isMultilineRegexp(regexpStr)) args.push('--multiline')
    if (options.isCaseSensitive) args.push('--case-sensitive')
    else args.push('--ignore-case')
    if (options.isWholeWord) args.push('--word-regexp')
    if (options.maxFileSize) args.push('--max-filesize', options.maxFileSize + '')
    if (options.includeHidden) args.push('--hidden')
    if (options.noIgnore) args.push('--no-ignore')
    if (options.leadingContextLineCount) { args.push('--before-context', String(options.leadingContextLineCount)) }
    if (options.trailingContextLineCount) { args.push('--after-context', String(options.trailingContextLineCount)) }
    for (const inclusion of prepareGlobs(options.inclusions, directoryPath)) { args.push('--iglob', inclusion) }
    for (const exclusion of prepareGlobs(options.exclusions, directoryPath)) { args.push('--iglob', '!' + exclusion) }
    args.push('--')
    if (textPattern) args.push(textPattern)
    args.push(directoryPath)

    let child: ChildProcess
    try {
      child = spawn(rgPath, args, { cwd: directoryPath, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      finishIfDone(err)
      return Object.freeze({ cancel })
    }
    children.push(child)

    let buffer = ''
    let bufferError = ''
    let pendingEvent: { filePath: string; matches: RgMatch[] } | null = null
    let pendingLeadingContext: unknown[] = []
    let pendingTrailingContexts: Set<unknown[]> = new Set()

    child.on('close', (code) => {
      // Exit code 1 is ripgrep's clean no-matches result; anything above it
      // is a real failure. Swallowing it and sending an empty done reported
      // a truncated result as a complete one (G28).
      if (code !== null && code > 1) {
        log.warn('Ripgrep finished with errors (exit code ' + code + '):', bufferError)
        finishIfDone(new Error(
          bufferError || 'ripgrep exited with code ' + code
        ))
        return
      }
      if (buffer && !cancelled) {
        try {
          const message = JSON.parse(buffer)
          if (message.type === 'end' && pendingEvent) {
            pendingPaths++
            sendIfAlive(sender, 'mt::rg::progress', { searchId, num: pendingPaths })
            matchEnvelopes++
            sendIfAlive(sender, 'mt::rg::match', { searchId, payload: pendingEvent })
          }
        } catch {
          /* parse error */
        }
      }
      pendingDirs--
      finishIfDone()
    })
    child.on('error', (err) => finishIfDone(err))
    child.stderr?.on('data', (chunk: Buffer | string) => {
      bufferError += chunk
    })
    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (cancelled) return
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line) continue
        try {
          const message = JSON.parse(line)
          if (message.type === 'begin') {
            pendingEvent = { filePath: getText(message.data.path), matches: [] }
            pendingLeadingContext = []
            pendingTrailingContexts = new Set()
          } else if (message.type === 'match') {
            const trailingContextLines: unknown[] = []
            pendingTrailingContexts.add(trailingContextLines)
            processUnicodeMatch(message.data)
            for (const submatch of message.data.submatches) {
              const { lineText, range } = processSubmatch(
                submatch,
                getText(message.data.lines),
                message.data.line_number - 1
              )
              pendingEvent?.matches.push({
                matchText: getText(submatch.match),
                lineText,
                range,
                leadingContextLines: [...pendingLeadingContext],
                trailingContextLines
              })
            }
          } else if (message.type === 'end') {
            pendingPaths++
            sendIfAlive(sender, 'mt::rg::progress', { searchId, num: pendingPaths })
            matchEnvelopes++
            sendIfAlive(sender, 'mt::rg::match', { searchId, payload: pendingEvent })
            pendingEvent = null
          }
        } catch (err) {
          log.warn('Failed to parse ripgrep output line:', line, err)
        }
      }
    })
  }
  return Object.freeze({ cancel })
}

const startFileSearch = (
  sender: WebContents,
  searchId: string,
  projectRoot: string,
  options: SearchOptions
): RipgrepSearchHandle => {
  const directories = [projectRoot]
  const rgPath = resolveRgPath()
  const children: ChildProcess[] = []
  let cancelled = false
  let pendingPaths = 0
  // Every mt::rg::match envelope is counted so the terminal can promise
  // the stream it ends (G28).
  let matchEnvelopes = 0
  let pendingDirs = directories.length
  let finished = false

  const finishIfDone = (err?: unknown): void => {
    if (finished) return
    if (pendingDirs === 0 || err) {
      finished = true
      activeSearches.delete(searchId)
      if (err) {
        sendIfAlive(sender, 'mt::rg::error', {
          searchId,
          error: err instanceof Error ? err.message : String(err)
        })
      } else {
        sendIfAlive(sender, 'mt::rg::done', { searchId, matchCount: matchEnvelopes })
      }
    }
  }

  const cancel = (): void => {
    cancelled = true
    for (const child of children) {
      try {
        child.kill()
      } catch {
        /* already dead */
      }
    }
    if (!finished) {
      finished = true
      activeSearches.delete(searchId)
      sendIfAlive(sender, 'mt::rg::cancelled', { searchId, matchCount: matchEnvelopes })
    }
  }
  for (const directoryPath of directories) {
    const args = ['--files']
    if (options.includeHidden) args.push('--hidden')
    if (options.noIgnore) args.push('--no-ignore')
    for (const inclusion of prepareGlobs(options.inclusions, directoryPath)) { args.push('--iglob', inclusion) }
    for (const exclusion of prepareGlobs(options.exclusions, directoryPath)) { args.push('--iglob', '!' + exclusion) }
    args.push('--')
    args.push(directoryPath)

    let child: ChildProcess
    try {
      child = spawn(rgPath, args, { cwd: directoryPath, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      finishIfDone(err)
      return Object.freeze({ cancel })
    }
    children.push(child)

    let buffer = ''
    let bufferError = ''
    child.on('close', (code) => {
      if (code !== null && code > 1) {
        finishIfDone(new Error(bufferError))
        return
      }
      pendingDirs--
      finishIfDone()
    })
    child.on('error', (err) => finishIfDone(err))
    child.stderr?.on('data', (chunk: Buffer | string) => {
      bufferError += chunk
    })
    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (cancelled) return
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        pendingPaths++
        sendIfAlive(sender, 'mt::rg::progress', { searchId, num: pendingPaths })
        matchEnvelopes++
        sendIfAlive(sender, 'mt::rg::match', { searchId, payload: line })
      }
    })
  }
  return Object.freeze({ cancel })
}

function safeMainSettings(
  settings: ProjectSearchSettings
): ProjectSearchSettings {
  const exclusions = Array.isArray(settings.exclusions)
    ? settings.exclusions
      .filter(pattern =>
        typeof pattern === 'string' &&
        pattern.length > 0 &&
        pattern.length <= 1024 &&
        !pattern.includes('\0') &&
        !pattern.includes('\n') &&
        !pattern.includes('\r')
      )
      .slice(0, 128)
    : []
  const maxFileSize =
    typeof settings.maxFileSize === 'string' &&
    /^(?:[1-9]\d*)(?:[KMG])?$/iu.test(settings.maxFileSize)
      ? settings.maxFileSize
      : ''
  return Object.freeze({
    exclusions: Object.freeze(exclusions),
    maxFileSize,
    includeHidden: settings.includeHidden === true,
    noIgnore: settings.noIgnore === true
  })
}

const executeProjectSearch = (
  sender: WebContents,
  searchId: string,
  projectRoot: string,
  request: ProjectSearchExecutionRequest
): RipgrepSearchHandle => {
  const options: SearchOptions = {
    ...request.options,
    ...safeMainSettings(request.settings)
  }
  return request.mode === 'files'
    ? startFileSearch(sender, searchId, projectRoot, options)
    : startTextSearch(
      sender,
      searchId,
      projectRoot,
      request.pattern,
      options
    )
}

export interface RipgrepHandlerDependencies {
  readonly resolveProjectRoot: (sender: WebContents) => string | null
  readonly readSettings: (sender: WebContents) => ProjectSearchSettings
  readonly spawnSearch: typeof executeProjectSearch
  readonly createSearchId: () => string
  readonly schedule: (task: () => void) => void
}

const EMPTY_SEARCH_SETTINGS: ProjectSearchSettings = Object.freeze({
  exclusions: Object.freeze([]),
  maxFileSize: '',
  includeHidden: false,
  noIgnore: false
})

const productionDependencies: RipgrepHandlerDependencies = Object.freeze({
  resolveProjectRoot: (sender: WebContents) => {
    const window = BrowserWindow.fromWebContents(sender)
    return window === null
      ? null
      : readProjectSearchAuthority(window.id).root
  },
  readSettings: (sender: WebContents) => {
    const window = BrowserWindow.fromWebContents(sender)
    return window === null
      ? EMPTY_SEARCH_SETTINGS
      : readProjectSearchAuthority(window.id).settings
  },
  spawnSearch: executeProjectSearch,
  createSearchId: randomUUID,
  schedule: (task: () => void) => setImmediate(task)
})

export const registerRipgrepHandlers = (
  dependencies: Partial<RipgrepHandlerDependencies> = {}
): void => {
  const deps = { ...productionDependencies, ...dependencies }
  ipcMain.handle('mt::rg::start', (event, rawRequest: unknown) => {
    // Decode before root/settings lookup, process creation, listener
    // registration, or any other observable effect.
    const request = decodeProjectSearchRequest(rawRequest)
    const projectRoot = deps.resolveProjectRoot(event.sender)
    if (
      typeof projectRoot !== 'string' ||
      projectRoot.length === 0 ||
      !path.isAbsolute(projectRoot) ||
      projectRoot.includes('\0')
    ) {
      throw new Error('Project search requires a retained project root')
    }
    const settings = safeMainSettings(deps.readSettings(event.sender))
    const searchId = deps.createSearchId()
    cleanupAtSenderDestroy(event.sender)

    let implementation: RipgrepSearchHandle | null = null
    let cancelledBeforeStart = false
    const entry: ActiveSearch = {
      sender: event.sender,
      cancel: () => {
        if (implementation) {
          implementation.cancel()
          return
        }
        if (cancelledBeforeStart) return
        cancelledBeforeStart = true
        activeSearches.delete(searchId)
        sendIfAlive(event.sender, 'mt::rg::cancelled', { searchId })
      }
    }
    activeSearches.set(searchId, entry)
    deps.schedule(() => {
      if (cancelledBeforeStart) return
      try {
        implementation = deps.spawnSearch(
          event.sender,
          searchId,
          projectRoot,
          Object.freeze({ ...request, settings })
        )
      } catch (error) {
        activeSearches.delete(searchId)
        sendIfAlive(event.sender, 'mt::rg::error', {
          searchId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    })
    return Object.freeze({ searchId })
  })
  ipcMain.on('mt::rg::cancel', (event, searchId: string) => {
    if (typeof searchId !== 'string') return
    const entry = activeSearches.get(searchId)
    if (entry?.sender === event.sender) entry.cancel()
  })
}

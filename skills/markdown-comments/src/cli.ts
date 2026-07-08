#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import iconv from 'iconv-lite'
import { editCommentReply, patchCommentMetadata, replyToComment, setCommentStatus } from './edit'
import { readMarkdownComments, stableJson } from './parse'
import type { TCommentStatus, TUpdateCommentThreadPatch } from '@muyajs/core/comments'

interface ParsedArgs {
  positional: string[]
  options: Record<string, string>
}

interface MarkdownDocument {
  markdown: string
  encoding: string
  hasBOM: boolean
  originalBytes: Buffer
}

const BOM_ENCODINGS: Array<{ encoding: string; bytes: number[] }> = [
  { encoding: 'utf8', bytes: [0xef, 0xbb, 0xbf] },
  { encoding: 'utf16be', bytes: [0xfe, 0xff] },
  { encoding: 'utf16le', bytes: [0xff, 0xfe] }
]

const usage = `Usage:
  markdown-comments list <file> [--footnote true|false]
  markdown-comments validate <file> [--footnote true|false]
  markdown-comments reply <file> <id> --author <name> --body <text> [--created-at <iso>]
  markdown-comments resolve <file> <id> [--updated-at <iso>]
  markdown-comments reopen <file> <id> [--updated-at <iso>]
  markdown-comments edit <file> <id> [--status open|resolved] [--authors Ada,Grace] [--updated-at <iso>]
  markdown-comments edit <file> <id> --reply-index <zero-based-index> [--body <text>] [--author <name>] [--created-at <iso>] [--updated-at <iso>]

Options:
  --encoding <name> Decode and write a non-BOM legacy file with an iconv-lite encoding such as cp1252 or shiftjis.
  --footnote <bool> Analyze with footnote parsing on, matching an editor whose footnote preference is enabled (default false, the engine default).
`

// Every option this CLI knows takes a value; per-command allowed sets keep a
// typo (or an option the command would silently drop) from passing as valid.
const COMMAND_OPTIONS: Record<string, ReadonlySet<string>> = {
  list: new Set(['encoding', 'footnote']),
  validate: new Set(['encoding', 'footnote']),
  reply: new Set(['encoding', 'author', 'body', 'created-at']),
  resolve: new Set(['encoding', 'updated-at']),
  reopen: new Set(['encoding', 'updated-at']),
  edit: new Set(['encoding', 'status', 'authors', 'updated-at', 'reply-index', 'body', 'author', 'created-at'])
}

function parseArgs(command: string, args: string[]): ParsedArgs {
  const allowed = COMMAND_OPTIONS[command]
  if (!allowed) {
    throw new Error(`Unknown command "${command}".\n${usage}`)
  }

  const positional: string[] = []
  const options: Record<string, string> = {}

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }

    const raw = arg.slice(2)
    const inlineValueIndex = raw.indexOf('=')
    const name = inlineValueIndex >= 0 ? raw.slice(0, inlineValueIndex) : raw
    if (!allowed.has(name)) {
      throw new Error(`Unknown option "--${name}" for "${command}".\n${usage}`)
    }

    if (inlineValueIndex >= 0) {
      options[name] = raw.slice(inlineValueIndex + 1)
      continue
    }

    // Every option takes a value; the value may itself begin with dashes
    // (e.g. --body "--fixed the flag parsing"), so consume the next argument
    // unconditionally and fail loudly when it is absent.
    const next = args[i + 1]
    if (next == null) {
      throw new Error(`Missing value for --${name}.\n${usage}`)
    }

    options[name] = next
    i += 1
  }

  return { positional, options }
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing ${name}.\n${usage}`)
  }
  return value
}

function startsWithBytes(bytes: Buffer, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte)
}

function normalizeEncodingOption(encoding: string | undefined): string | undefined {
  const normalized = encoding?.trim()
  return normalized || undefined
}

function detectFileEncoding(
  bytes: Buffer,
  requestedEncoding?: string
): Pick<MarkdownDocument, 'encoding' | 'hasBOM'> {
  const bomEncoding = BOM_ENCODINGS.find(item => startsWithBytes(bytes, item.bytes))
  if (bomEncoding) {
    return { encoding: bomEncoding.encoding, hasBOM: true }
  }

  if (requestedEncoding) {
    if (!iconv.encodingExists(requestedEncoding)) {
      throw new Error(`Unsupported file encoding: "${requestedEncoding}" is not available.`)
    }
    return { encoding: requestedEncoding, hasBOM: false }
  }

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { encoding: 'utf8', hasBOM: false }
  } catch {
    throw new Error('Unsupported file encoding: markdown-comments supports UTF-8 and BOM-marked UTF-16 Markdown files. Use --encoding for legacy encodings.')
  }
}

function readFile(file: string, requestedEncoding?: string): MarkdownDocument {
  const bytes = fs.readFileSync(path.resolve(file))
  const encoding = detectFileEncoding(bytes, requestedEncoding)
  if (!iconv.encodingExists(encoding.encoding)) {
    throw new Error(`Unsupported file encoding: "${encoding.encoding}" is not available.`)
  }

  return {
    ...encoding,
    markdown: iconv.decode(bytes, encoding.encoding),
    originalBytes: bytes
  }
}

function writeFile(file: string, document: MarkdownDocument, markdown: string): void {
  fs.writeFileSync(path.resolve(file), iconv.encode(markdown, document.encoding, {
    addBOM: document.hasBOM
  }))
}

// A mutation touches one ASCII metadata line, but the write re-encodes the
// whole decoded string. Encodings with duplicate byte sequences (e.g. cp932
// NEC/IBM rows) canonicalize on that round trip, silently rewriting unrelated
// bytes — refuse instead of churning the user's file.
function assertLosslessReencode(document: MarkdownDocument, originalBytes: Buffer): void {
  const roundTrip = iconv.encode(document.markdown, document.encoding, { addBOM: document.hasBOM })
  if (!roundTrip.equals(originalBytes)) {
    throw new Error(
      `Refusing to write: re-encoding this file as "${document.encoding}" would alter bytes ` +
      'outside the edited metadata line (lossy or non-canonical source encoding).'
    )
  }
}

function printJson(value: unknown): void {
  process.stdout.write(stableJson(value))
}

function parseStatus(value: string | undefined): TCommentStatus | undefined {
  if (value == null) return undefined
  if (value !== 'open' && value !== 'resolved') {
    throw new Error('--status must be "open" or "resolved".')
  }
  return value
}

function buildPatch(options: Record<string, string>): TUpdateCommentThreadPatch {
  const status = parseStatus(options.status)
  const authors = options.authors
    ? options.authors.split(',').map(author => author.trim()).filter(Boolean)
    : undefined
  const patch: TUpdateCommentThreadPatch = {
    ...(status ? { status } : {}),
    ...(authors ? { authors } : {}),
    ...(options['updated-at'] ? { updatedAt: options['updated-at'] } : {})
  }

  if (Object.keys(patch).length === 0) {
    throw new Error(`Nothing to edit. Provide --status, --authors, or --updated-at.\n${usage}`)
  }

  return patch
}

// The analyzer's footnote option mirrors the editor preference; anything but
// an explicit true/false is a typo, not a default to guess at.
function parseFootnoteOption(value: string | undefined): { footnote: boolean } | undefined {
  if (value == null) return undefined
  if (value !== 'true' && value !== 'false') {
    throw new Error('--footnote must be "true" or "false".')
  }
  return { footnote: value === 'true' }
}

function parseReplyIndex(value: string | undefined): number | null {
  if (value == null) return null
  if (!/^\d+$/u.test(value)) {
    throw new Error('--reply-index must be a zero-based non-negative integer.')
  }
  return Number(value)
}

function writeAndPrint(file: string, document: MarkdownDocument, markdown: string): void {
  assertLosslessReencode(document, document.originalBytes)
  writeFile(file, document, markdown)
  printJson(readMarkdownComments(markdown))
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2)
  if (!command) {
    throw new Error(usage)
  }
  const { positional, options } = parseArgs(command, rest)
  const file = positional[0]

  if (!file) {
    throw new Error(usage)
  }

  const document = readFile(file, normalizeEncodingOption(options.encoding))
  const { markdown } = document

  if (command === 'list') {
    printJson(readMarkdownComments(markdown, parseFootnoteOption(options.footnote)))
    return
  }

  if (command === 'validate') {
    const parsed = readMarkdownComments(markdown, parseFootnoteOption(options.footnote))
    printJson(parsed.diagnostics)
    process.exitCode = parsed.diagnostics.length ? 1 : 0
    return
  }

  const id = requireValue(positional[1], 'comment id')

  if (command === 'reply') {
    writeAndPrint(file, document, replyToComment(markdown, id, {
      author: requireValue(options.author, '--author'),
      body: requireValue(options.body, '--body'),
      createdAt: options['created-at']
    }))
    return
  }

  if (command === 'resolve' || command === 'reopen') {
    writeAndPrint(
      file,
      document,
      setCommentStatus(markdown, id, command === 'resolve' ? 'resolved' : 'open', options['updated-at'])
    )
    return
  }

  if (command === 'edit') {
    const replyIndex = parseReplyIndex(options['reply-index'])
    if (replyIndex != null) {
      // A reply edit patches one reply; thread-level options would be
      // silently dropped — reject the combination instead.
      for (const threadOnly of ['status', 'authors']) {
        if (options[threadOnly] != null) {
          throw new Error(`--${threadOnly} does not apply to a reply edit (--reply-index).\n${usage}`)
        }
      }
      writeAndPrint(file, document, editCommentReply(markdown, id, replyIndex, {
        author: options.author,
        body: options.body,
        createdAt: options['created-at'],
        updatedAt: options['updated-at']
      }))
      return
    }

    writeAndPrint(file, document, patchCommentMetadata(markdown, id, buildPatch(options)))
    return
  }

  throw new Error(usage)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

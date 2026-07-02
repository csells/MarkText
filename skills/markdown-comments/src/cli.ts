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
}

const BOM_ENCODINGS: Array<{ encoding: string; bytes: number[] }> = [
  { encoding: 'utf8', bytes: [0xef, 0xbb, 0xbf] },
  { encoding: 'utf16be', bytes: [0xfe, 0xff] },
  { encoding: 'utf16le', bytes: [0xff, 0xfe] }
]

const usage = `Usage:
  markdown-comments list <file>
  markdown-comments validate <file>
  markdown-comments reply <file> <id> --author <name> --body <text> [--created-at <iso>]
  markdown-comments resolve <file> <id> [--updated-at <iso>]
  markdown-comments reopen <file> <id> [--updated-at <iso>]
  markdown-comments edit <file> <id> [--status open|resolved] [--authors Ada,Grace] [--updated-at <iso>]
  markdown-comments edit <file> <id> --reply-index <zero-based-index> [--body <text>] [--author <name>] [--created-at <iso>] [--updated-at <iso>]

Options:
  --encoding <name> Decode and write a non-BOM legacy file with an iconv-lite encoding such as cp1252 or shiftjis.
`

function parseArgs(args: string[]): ParsedArgs {
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
    if (inlineValueIndex >= 0) {
      options[raw.slice(0, inlineValueIndex)] = raw.slice(inlineValueIndex + 1)
      continue
    }

    const next = args[i + 1]
    if (next == null || next.startsWith('--')) {
      options[raw] = 'true'
      continue
    }

    options[raw] = next
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
    markdown: iconv.decode(bytes, encoding.encoding)
  }
}

function writeFile(file: string, document: MarkdownDocument, markdown: string): void {
  fs.writeFileSync(path.resolve(file), iconv.encode(markdown, document.encoding, {
    addBOM: document.hasBOM
  }))
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

function parseReplyIndex(value: string | undefined): number | null {
  if (value == null) return null
  if (!/^\d+$/u.test(value)) {
    throw new Error('--reply-index must be a zero-based non-negative integer.')
  }
  return Number(value)
}

function writeAndPrint(file: string, document: MarkdownDocument, markdown: string): void {
  writeFile(file, document, markdown)
  printJson(readMarkdownComments(markdown))
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2)
  const { positional, options } = parseArgs(rest)
  const file = positional[0]

  if (!command || !file) {
    throw new Error(usage)
  }

  const document = readFile(file, normalizeEncodingOption(options.encoding))
  const { markdown } = document

  if (command === 'list') {
    printJson(readMarkdownComments(markdown))
    return
  }

  if (command === 'validate') {
    const parsed = readMarkdownComments(markdown)
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

  throw new Error(`Unknown command "${command}".\n${usage}`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

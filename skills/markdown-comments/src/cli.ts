#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { patchCommentMetadata, replyToComment, setCommentStatus } from './edit'
import { readMarkdownComments, stableJson } from './parse'
import type { TCommentStatus, TUpdateCommentThreadPatch } from './metadata'

interface ParsedArgs {
  positional: string[]
  options: Record<string, string>
}

const usage = `Usage:
  markdown-comments list <file>
  markdown-comments validate <file>
  markdown-comments reply <file> <id> --author <name> --body <text> [--created-at <iso>]
  markdown-comments resolve <file> <id> [--updated-at <iso>]
  markdown-comments reopen <file> <id> [--updated-at <iso>]
  markdown-comments edit <file> <id> [--status open|resolved] [--authors Ada,Grace] [--updated-at <iso>]
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

function readFile(file: string): string {
  return fs.readFileSync(path.resolve(file), 'utf8')
}

function writeFile(file: string, markdown: string): void {
  fs.writeFileSync(path.resolve(file), markdown)
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

function writeAndPrint(file: string, markdown: string): void {
  writeFile(file, markdown)
  printJson(readMarkdownComments(markdown))
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2)
  const { positional, options } = parseArgs(rest)
  const file = positional[0]

  if (!command || !file) {
    throw new Error(usage)
  }

  const markdown = readFile(file)

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
    writeAndPrint(file, replyToComment(markdown, id, {
      author: requireValue(options.author, '--author'),
      body: requireValue(options.body, '--body'),
      createdAt: options['created-at']
    }))
    return
  }

  if (command === 'resolve' || command === 'reopen') {
    writeAndPrint(
      file,
      setCommentStatus(markdown, id, command === 'resolve' ? 'resolved' : 'open', options['updated-at'])
    )
    return
  }

  if (command === 'edit') {
    writeAndPrint(file, patchCommentMetadata(markdown, id, buildPatch(options)))
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

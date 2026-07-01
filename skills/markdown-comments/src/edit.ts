import {
  decodeCommentMetadata,
  encodeCommentMetadata,
  mergeCommentMetadataPatch,
  normalizeCommentMetadata
} from './metadata'
import type {
  ICommentMetadata,
  ICommentReply,
  ICommentReplyInput,
  TCommentStatus,
  TUpdateCommentThreadPatch
} from './metadata'

const METADATA_LINE_REGEXP =
  /^( {0,3}\[MC:([^\]\s]+)\]:\s*)(data:application\/json;base64,\S*)(\s*)$/

interface FenceState {
  marker: '`' | '~'
  length: number
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function getFenceStart(line: string): FenceState | null {
  const match = /^(?: {0,3})(`{3,}|~{3,})/u.exec(line)
  if (!match) return null

  const marker = match[1][0] as '`' | '~'
  return { marker, length: match[1].length }
}

function isFenceEnd(line: string, fence: FenceState): boolean {
  const escapedMarker = fence.marker === '`' ? '`' : '~'
  const regexp = new RegExp(`^(?: {0,3})${escapedMarker}{${fence.length},}\\s*$`, 'u')
  return regexp.test(line)
}

function getHtmlBlockClosing(line: string): RegExp | 'single-line' | null {
  const trimmed = line.trim()
  if (/^<!--/u.test(trimmed)) {
    return /-->/u.test(trimmed) ? 'single-line' : /-->/u
  }

  const tag = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s|>|\/>)/u.exec(trimmed)
  if (!tag) return null
  if (new RegExp(`</${escapeRegExp(tag[1])}\\s*>`, 'iu').test(trimmed) || /\/>\s*$/u.test(trimmed)) {
    return 'single-line'
  }

  return new RegExp(`</${escapeRegExp(tag[1])}\\s*>`, 'iu')
}

export function replaceCommentMetadata(
  markdown: string,
  id: string,
  updater: (metadata: ICommentMetadata) => ICommentMetadata
): string {
  const parts = markdown.split(/(\r\n|\n|\r)/)
  let replaced = false
  let fence: FenceState | null = null
  let frontMatterMarker: string | null = null
  let htmlClosing: RegExp | null = null
  let inMathBlock = false

  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i]
    if (line == null) continue
    const trimmed = line.trim()

    if (frontMatterMarker) {
      if (trimmed === frontMatterMarker) {
        frontMatterMarker = null
      }
      continue
    }

    if (i === 0) {
      const frontMatterStart = /^(---|\+\+\+)[ \t]*$/u.exec(line)
      if (frontMatterStart) {
        frontMatterMarker = frontMatterStart[1]
        continue
      }
    }

    if (fence) {
      if (isFenceEnd(line, fence)) {
        fence = null
      }
      continue
    }

    const fenceStart = getFenceStart(line)
    if (fenceStart) {
      fence = fenceStart
      continue
    }

    if (inMathBlock) {
      if (/^ {0,3}\$\$[ \t]*$/u.test(line)) {
        inMathBlock = false
      }
      continue
    }

    if (/^ {0,3}\$\$[ \t]*$/u.test(line)) {
      inMathBlock = true
      continue
    }

    if (htmlClosing) {
      if (!trimmed || htmlClosing.test(trimmed)) {
        htmlClosing = null
      }
      continue
    }

    const htmlBlockClosing = getHtmlBlockClosing(line)
    if (htmlBlockClosing) {
      if (htmlBlockClosing !== 'single-line') {
        htmlClosing = htmlBlockClosing
      }
      continue
    }

    if (/^(?: {4,}|\t)/u.test(line)) continue

    const match = METADATA_LINE_REGEXP.exec(line)
    if (!match || match[2] !== id) continue

    let currentMetadata: ICommentMetadata
    try {
      currentMetadata = decodeCommentMetadata(match[3])
    } catch {
      continue
    }

    const nextMetadata = normalizeCommentMetadata(updater(currentMetadata))
    parts[i] = `${match[1]}${encodeCommentMetadata(nextMetadata)}${match[4]}`
    replaced = true
    break
  }

  if (!replaced) {
    throw new Error(`No metadata definition found for comment "${id}".`)
  }

  return parts.join('')
}

export function patchCommentMetadata(
  markdown: string,
  id: string,
  patch: TUpdateCommentThreadPatch
): string {
  return replaceCommentMetadata(markdown, id, metadata => mergeCommentMetadataPatch(metadata, patch))
}

export function replyToComment(markdown: string, id: string, reply: ICommentReplyInput): string {
  const createdAt = reply.createdAt ?? new Date().toISOString()
  return replaceCommentMetadata(markdown, id, (metadata) => {
    const authors = metadata.authors ? [...metadata.authors] : []
    if (reply.author && !authors.includes(reply.author)) {
      authors.push(reply.author)
    }

    return mergeCommentMetadataPatch(metadata, {
      authors,
      updatedAt: createdAt,
      replies: [
        ...metadata.replies,
        {
          author: reply.author,
          createdAt,
          body: reply.body
        }
      ]
    })
  })
}

export interface IEditCommentReplyPatch {
  author?: string
  body?: string
  createdAt?: string
  updatedAt?: string
}

export function editCommentReply(
  markdown: string,
  id: string,
  replyIndex: number,
  patch: IEditCommentReplyPatch
): string {
  if (!Number.isInteger(replyIndex) || replyIndex < 0) {
    throw new Error('--reply-index must be a zero-based non-negative integer.')
  }

  const hasReplyPatch = patch.author != null || patch.body != null || patch.createdAt != null
  if (!hasReplyPatch) {
    throw new Error('Reply edit requires --body, --author, or --created-at.')
  }

  return replaceCommentMetadata(markdown, id, (metadata) => {
    const reply = metadata.replies[replyIndex]
    if (!reply) {
      throw new Error(`No reply at index ${replyIndex} for comment "${id}".`)
    }

    const nextReply: ICommentReply = {
      ...reply,
      ...(patch.author != null ? { author: patch.author } : {}),
      ...(patch.body != null ? { body: patch.body } : {}),
      ...(patch.createdAt != null ? { createdAt: patch.createdAt } : {})
    }
    const replies = metadata.replies.map((item, index) => (index === replyIndex ? nextReply : item))
    const authors = metadata.authors ? [...metadata.authors] : []
    if (patch.author && !authors.includes(patch.author)) {
      authors.push(patch.author)
    }

    return mergeCommentMetadataPatch(metadata, {
      ...(authors.length ? { authors } : {}),
      ...(patch.updatedAt ? { updatedAt: patch.updatedAt } : {}),
      replies
    })
  })
}

export function setCommentStatus(
  markdown: string,
  id: string,
  status: TCommentStatus,
  updatedAt = new Date().toISOString()
): string {
  return patchCommentMetadata(markdown, id, { status, updatedAt })
}

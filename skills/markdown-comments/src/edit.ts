import {
  decodeCommentMetadata,
  encodeCommentMetadata,
  mergeCommentMetadataPatch,
  normalizeCommentMetadata
} from './metadata'
import type {
  ICommentMetadata,
  ICommentReplyInput,
  TCommentStatus,
  TUpdateCommentThreadPatch
} from './metadata'

const METADATA_LINE_REGEXP =
  /^( {0,3}\[MC:([^\]\s]+)\]:\s*)(data:application\/json;base64,\S+)(\s*)$/

export function replaceCommentMetadata(
  markdown: string,
  id: string,
  updater: (metadata: ICommentMetadata) => ICommentMetadata
): string {
  const parts = markdown.split(/(\r\n|\n|\r)/)
  let replacements = 0

  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i]
    if (line == null) continue

    const match = METADATA_LINE_REGEXP.exec(line)
    if (!match || match[2] !== id) continue

    const nextMetadata = normalizeCommentMetadata(updater(decodeCommentMetadata(match[3])))
    parts[i] = `${match[1]}${encodeCommentMetadata(nextMetadata)}${match[4]}`
    replacements += 1
  }

  if (replacements === 0) {
    throw new Error(`No metadata definition found for comment "${id}".`)
  }
  if (replacements > 1) {
    throw new Error(`Multiple metadata definitions found for comment "${id}".`)
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

export function setCommentStatus(
  markdown: string,
  id: string,
  status: TCommentStatus,
  updatedAt = new Date().toISOString()
): string {
  return patchCommentMetadata(markdown, id, { status, updatedAt })
}

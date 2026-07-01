import {
  mergeCommentMetadataPatch,
  updateCommentMetadataInMarkdown
} from './metadata'
import type {
  ICommentMetadata,
  ICommentReply,
  ICommentReplyInput,
  TCommentStatus,
  TUpdateCommentThreadPatch
} from './metadata'

export function replaceCommentMetadata(
  markdown: string,
  id: string,
  updater: (metadata: ICommentMetadata) => ICommentMetadata
): string {
  const updated = updateCommentMetadataInMarkdown(markdown, id, updater)
  if (!updated) {
    throw new Error(`No metadata definition found for comment "${id}".`)
  }

  return updated
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

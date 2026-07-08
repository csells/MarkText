import {
  appendCommentReplyMetadata,
  mergeCommentMetadataPatch,
  updateCommentMetadataInMarkdown
} from '@muyajs/core/comments'
import type {
  ICommentMetadata,
  ICommentReply,
  ICommentReplyInput,
  TCommentAnalysisOptions,
  TCommentStatus,
  TUpdateCommentThreadPatch
} from '@muyajs/core/comments'

export function replaceCommentMetadata(
  markdown: string,
  id: string,
  updater: (metadata: ICommentMetadata) => ICommentMetadata,
  options?: TCommentAnalysisOptions
): string {
  const updated = updateCommentMetadataInMarkdown(markdown, id, updater, options)
  if (!updated) {
    throw new Error(`No metadata definition found for comment "${id}".`)
  }

  return updated
}

export function patchCommentMetadata(
  markdown: string,
  id: string,
  patch: TUpdateCommentThreadPatch,
  options?: TCommentAnalysisOptions
): string {
  return replaceCommentMetadata(
    markdown,
    id,
    metadata => mergeCommentMetadataPatch(metadata, patch),
    options
  )
}

export function replyToComment(
  markdown: string,
  id: string,
  reply: ICommentReplyInput,
  options?: TCommentAnalysisOptions
): string {
  return replaceCommentMetadata(
    markdown,
    id,
    metadata => appendCommentReplyMetadata(metadata, reply),
    options
  )
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
  patch: IEditCommentReplyPatch,
  options?: TCommentAnalysisOptions
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

    // Head-level fields record head-level changes only (comment-format.md):
    // a reply-level edit never rewrites the head line. Thread authors are
    // derived from the head plus every reply at read time.
    return mergeCommentMetadataPatch(metadata, {
      ...(patch.updatedAt ? { updatedAt: patch.updatedAt } : {}),
      replies
    })
  }, options)
}

export function setCommentStatus(
  markdown: string,
  id: string,
  status: TCommentStatus,
  updatedAt = new Date().toISOString(),
  options?: TCommentAnalysisOptions
): string {
  return patchCommentMetadata(markdown, id, { status, updatedAt }, options)
}

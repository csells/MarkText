import type { CodeMirrorCoreAdapterOptions } from './codeMirrorCoreAdapter'
import type { CanonicalLineEnding } from './canonicalEolIndex'

/**
 * The renderer store and CodeMirror use an LF-normalized view. The host line
 * ending remains session metadata for a later save barrier and must not shift
 * editor coordinates back into on-disk spelling.
 */
export function sourceCodeCoreAdapterOptions(
  rendererMarkdown: string,
  _hostLineEnding: CanonicalLineEnding,
  canonicalRevision: number
): CodeMirrorCoreAdapterOptions {
  return Object.freeze({
    canonicalSource: rendererMarkdown,
    canonicalRevision,
    insertedLineEnding: '\n',
    projections: () => Object.freeze([])
  })
}

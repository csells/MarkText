import type { CodeMirrorCoreAdapterOptions } from './codeMirrorCoreAdapter'
import type { CanonicalLineEnding } from './canonicalEolIndex'

/**
 * The renderer store and CodeMirror use an LF-normalized view. The host line
 * ending remains session metadata for a later save barrier and must not shift
 * editor coordinates back into on-disk spelling.
 */
export function sourceCodeCoreAdapterOptions(
  rendererMarkdown: string,
  _hostLineEnding: CanonicalLineEnding
): CodeMirrorCoreAdapterOptions {
  return Object.freeze({
    canonicalSource: rendererMarkdown,
    insertedLineEnding: '\n',
    projections: () => Object.freeze([])
  })
}

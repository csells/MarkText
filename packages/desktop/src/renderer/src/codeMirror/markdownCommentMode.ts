import type { ISourceLineDecoration } from '@muyajs/core'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CodeMirrorLike = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any

// The overlay adds MC comment classes over the math-aware Markdown mode. It
// carries NO grammar of its own: per-line decorations come from the batch
// index (the real parser's block/inline tokenization) via `getDecorations`,
// and the overlay just tracks its line number and paints the precomputed
// spans. This is the one owner of "what is an MC marker/definition here" —
// there is no second streaming classifier.
interface CommentModeOptions {
  name: string
  getDecorations?: () => ISourceLineDecoration[]
}

interface OverlayState {
  line: number
}

const registerMarkdownCommentMode = (CodeMirror: CodeMirrorLike): void => {
  if (CodeMirror.modes && Object.prototype.hasOwnProperty.call(CodeMirror.modes, 'markdown-comments')) {
    return
  }

  CodeMirror.defineMode('markdown-comments', function(config: AnyObj, modeOptions: CommentModeOptions) {
    const baseMode = CodeMirror.getMode(config, 'markdown-math')
    const getDecorations = modeOptions?.getDecorations ?? ((): ISourceLineDecoration[] => [])

    const overlay = {
      startState(): OverlayState {
        return { line: -1 }
      },
      copyState(state: OverlayState): OverlayState {
        return { line: state.line }
      },
      // Line numbers advance in lockstep with CodeMirror's line-by-line
      // tokenization (blank lines included), so `state.line` indexes the
      // batch decorations for the line the stream is on.
      blankLine(state: OverlayState) {
        state.line += 1
      },
      token(stream: AnyObj, state: OverlayState) {
        if (stream.sol()) state.line += 1

        const decoration = getDecorations()[state.line]
        if (!decoration || decoration.ignored) {
          stream.skipToEnd()
          return null
        }

        // Every advance loop is guarded by `!stream.eol()`: decorations can
        // be transiently STALE relative to the buffer (a CodeMirror edit
        // re-tokenizes the display before the change handler refreshes them),
        // so a span may reach past the current line's end — `stream.next()`
        // cannot advance past end-of-line, and an unguarded `pos < end` loop
        // would spin forever.
        const col = stream.pos
        const span = decoration.spans.find((s) => col >= s.start && col < s.end)
        if (span) {
          while (!stream.eol() && stream.pos < span.end) stream.next()
          return span.token === 'marker' ? 'mt-comment-marker' : 'mt-comment-metadata'
        }

        // Advance to the next decorated span (or end of line) rather than
        // returning null one character at a time.
        const next = decoration.spans.find((s) => s.start > col)
        if (next && next.start < stream.string.length) {
          while (!stream.eol() && stream.pos < next.start) stream.next()
        } else {
          stream.skipToEnd()
        }
        return null
      }
    }

    return CodeMirror.overlayMode(baseMode, overlay, true)
  })
}

export default registerMarkdownCommentMode

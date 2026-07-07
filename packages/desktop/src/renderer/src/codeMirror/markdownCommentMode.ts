import {
  COMMENT_MARKER_PATTERN,
  createCommentSourceLineState,
  parseCommentMetadataDefinition,
  prepareCommentSourceLine,
  sourceLinePositionInsideInlineCode,
  type ICommentSourceLineState
} from '@muyajs/core'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CodeMirrorLike = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any

const COMMENT_MARKER = new RegExp(`^${COMMENT_MARKER_PATTERN}`, 'u')

const registerMarkdownCommentMode = (CodeMirror: CodeMirrorLike): void => {
  if (CodeMirror.modes && Object.prototype.hasOwnProperty.call(CodeMirror.modes, 'markdown-comments')) {
    return
  }

  CodeMirror.defineMode('markdown-comments', function(config: AnyObj) {
    const baseMode = CodeMirror.getMode(config, 'markdown-math')
    const overlay = {
      startState(): ICommentSourceLineState {
        return createCommentSourceLineState()
      },
      token(stream: AnyObj, state: ICommentSourceLineState) {
        if (stream.sol()) prepareCommentSourceLine(state, stream.string)

        if (state.ignoreLine) {
          stream.skipToEnd()
          return null
        }

        if (sourceLinePositionInsideInlineCode(stream.string, stream.pos)) {
          stream.next()
          return null
        }

        // Definition recognition is the canonical parser's, not a second
        // regex — a line the analyzer treats as metadata must decorate as
        // metadata (leading indentation and malformed payloads included).
        if (stream.sol() && parseCommentMetadataDefinition(stream.string)) {
          stream.skipToEnd()
          return 'mt-comment-metadata'
        }

        if (stream.match(COMMENT_MARKER)) {
          return 'mt-comment-marker'
        }

        stream.next()
        return null
      }
    }

    return CodeMirror.overlayMode(baseMode, overlay, true)
  })
}

export default registerMarkdownCommentMode

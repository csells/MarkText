const COMMENT_MARKER = /^<!--MC:~?\w[\w-]*-->/
const COMMENT_METADATA = /^\[MC:[^\]\s]+\]:\s*data:application\/json;base64,\S+/

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CodeMirrorLike = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any

const registerMarkdownCommentMode = (CodeMirror: CodeMirrorLike): void => {
  if (CodeMirror.modes && Object.prototype.hasOwnProperty.call(CodeMirror.modes, 'markdown-comments')) {
    return
  }

  CodeMirror.defineMode('markdown-comments', function(config: AnyObj) {
    const baseMode = CodeMirror.getMode(config, 'markdown-math')
    const overlay = {
      token(stream: AnyObj) {
        if (stream.sol() && stream.match(COMMENT_METADATA)) {
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

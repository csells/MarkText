import {
  COMMENT_MARKER_PATTERN,
  COMMENT_METADATA_DATA_URI_PREFIX
} from '@muyajs/core'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CodeMirrorLike = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any

interface CommentOverlayState {
  seenFirstLine: boolean
  frontMatterMarker: string | null
  fence: { char: '`' | '~'; length: number } | null
  inMathBlock: boolean
  htmlClosing: RegExp | null
  ignoreLine: boolean
}

const inlineCodeRanges = (line: string): Array<{ start: number; end: number }> => {
  const ranges: Array<{ start: number; end: number }> = []
  let cursor = 0

  while (cursor < line.length) {
    const start = line.indexOf('`', cursor)
    if (start < 0) break

    let tickCount = 1
    while (line[start + tickCount] === '`') tickCount += 1

    const marker = '`'.repeat(tickCount)
    const end = line.indexOf(marker, start + tickCount)
    if (end < 0) break

    ranges.push({ start, end: end + tickCount })
    cursor = end + tickCount
  }

  return ranges
}

const positionInsideInlineCode = (line: string, position: number): boolean =>
  inlineCodeRanges(line).some(range => position >= range.start && position < range.end)

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

const COMMENT_MARKER = new RegExp(`^${COMMENT_MARKER_PATTERN}`, 'u')
const COMMENT_METADATA = new RegExp(
  `^\\[MC:[^\\]\\s]+\\]:\\s*${escapeRegExp(COMMENT_METADATA_DATA_URI_PREFIX)}\\S+`,
  'u'
)
const COMMENT_MARKER_LINE = new RegExp(`^${COMMENT_MARKER_PATTERN}`, 'u')

const prepareLine = (state: CommentOverlayState, line: string): void => {
  const trimmed = line.trim()
  state.ignoreLine = false

  if (!state.seenFirstLine) {
    state.seenFirstLine = true
    const frontMatter = /^(---|\+\+\+)[ \t]*$/.exec(line)
    if (frontMatter) {
      state.frontMatterMarker = frontMatter[1]
      state.ignoreLine = true
      return
    }
  }

  if (state.frontMatterMarker) {
    state.ignoreLine = true
    if (trimmed === state.frontMatterMarker) state.frontMatterMarker = null
    return
  }

  if (state.fence) {
    state.ignoreLine = true
    const closing = /^( {0,3})(`{3,}|~{3,})(?:[ \t]*)$/.exec(line)
    if (
      closing &&
      closing[2][0] === state.fence.char &&
      closing[2].length >= state.fence.length
    ) {
      state.fence = null
    }
    return
  }

  const openingFence = /^( {0,3})(`{3,}|~{3,})/.exec(line)
  if (openingFence) {
    state.fence = {
      char: openingFence[2][0] as '`' | '~',
      length: openingFence[2].length
    }
    state.ignoreLine = true
    return
  }

  if (state.inMathBlock) {
    state.ignoreLine = true
    if (/^ {0,3}\$\$[ \t]*$/.test(line)) state.inMathBlock = false
    return
  }

  if (/^ {0,3}\$\$[ \t]*$/.test(line)) {
    state.inMathBlock = true
    state.ignoreLine = true
    return
  }

  if (state.htmlClosing) {
    state.ignoreLine = true
    if (!trimmed || state.htmlClosing.test(trimmed)) state.htmlClosing = null
    return
  }

  if (/^(?: {4,}|\t)/.test(line)) {
    state.ignoreLine = true
    return
  }

  if (/^<!--/.test(trimmed) && !COMMENT_MARKER_LINE.test(trimmed)) {
    state.ignoreLine = true
    if (!/-->/.test(trimmed)) state.htmlClosing = /-->/
    return
  }

  const tag = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s|>|\/>)/.exec(trimmed)
  if (!tag) return

  state.ignoreLine = true
  if (!new RegExp(`</${escapeRegExp(tag[1])}\\s*>`, 'i').test(trimmed) && !/\/>\s*$/.test(trimmed)) {
    state.htmlClosing = new RegExp(`</${escapeRegExp(tag[1])}\\s*>`, 'i')
  }
}

const registerMarkdownCommentMode = (CodeMirror: CodeMirrorLike): void => {
  if (CodeMirror.modes && Object.prototype.hasOwnProperty.call(CodeMirror.modes, 'markdown-comments')) {
    return
  }

  CodeMirror.defineMode('markdown-comments', function(config: AnyObj) {
    const baseMode = CodeMirror.getMode(config, 'markdown-math')
    const overlay = {
      startState(): CommentOverlayState {
        return {
          seenFirstLine: false,
          frontMatterMarker: null,
          fence: null,
          inMathBlock: false,
          htmlClosing: null,
          ignoreLine: false
        }
      },
      token(stream: AnyObj, state: CommentOverlayState) {
        if (stream.sol()) prepareLine(state, stream.string)

        if (state.ignoreLine) {
          stream.skipToEnd()
          return null
        }

        if (positionInsideInlineCode(stream.string, stream.pos)) {
          stream.next()
          return null
        }

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

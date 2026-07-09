import { describe, expect, it } from 'vitest'
import type { ISourceLineDecoration } from '@muyajs/core'
import registerMarkdownCommentMode from '@/codeMirror/markdownCommentMode'

// The source-mode overlay must terminate even when its decorations are STALE
// relative to the buffer — a CodeMirror edit re-tokenizes the display before
// the change handler refreshes decorations, so a span can reach past the
// current (shorter) line. An unguarded `pos < span.end` loop spins forever
// because stream.next() cannot advance past end-of-line (the discard hang).

// Minimal StringStream over one line, matching the CodeMirror 5 contract the
// overlay relies on: next() returns undefined at EOL without advancing.
class FakeStream {
  pos = 0
  start = 0
  constructor(public string: string) {}
  sol() { return this.pos === 0 }
  eol() { return this.pos >= this.string.length }
  next() {
    if (this.pos < this.string.length) return this.string[this.pos++]
    return undefined
  }

  skipToEnd() { this.pos = this.string.length }
}

type Overlay = {
  startState(): { line: number }
  token(stream: FakeStream, state: { line: number }): string | null
}

const captureOverlay = (getDecorations: () => ISourceLineDecoration[]): Overlay => {
  let overlay: Overlay | null = null
  const CodeMirror = {
    modes: {},
    defineMode(_name: string, factory: (config: unknown, opts: unknown) => unknown) {
      factory({}, { name: 'markdown-comments', getDecorations })
    },
    getMode: () => ({}),
    startState: () => ({}),
    overlayMode: (_base: unknown, o: unknown) => {
      overlay = o as never
      return o
    }
  }
  registerMarkdownCommentMode(CodeMirror as never)
  if (!overlay) throw new Error('overlay was not registered')
  return overlay
}

const runLine = (
  overlay: ReturnType<typeof captureOverlay>,
  line: string
): string[] => {
  const state = overlay.startState()
  const stream = new FakeStream(line)
  const tokens: string[] = []
  let guard = 0
  while (!stream.eol()) {
    if (guard++ > line.length + 5) throw new Error('overlay failed to advance the stream')
    stream.start = stream.pos
    tokens.push(overlay.token(stream, state) ?? '')
  }
  return tokens
}

describe('markdown-comments overlay', () => {
  it('terminates when a decoration span reaches past the (stale-shorter) line', () => {
    // The line is 4 chars; the decoration claims a marker span to column 20 —
    // exactly the stale-decoration case the discard splice produces.
    const decorations: ISourceLineDecoration[] = [
      { ignored: false, spans: [{ start: 0, end: 20, token: 'marker' }] }
    ]
    const overlay = captureOverlay(() => decorations)

    expect(() => runLine(overlay, 'abcd')).not.toThrow()
  })

  it('paints a live marker span and leaves surrounding text undecorated', () => {
    const line = 'A <!--MC:a--> b'
    const decorations: ISourceLineDecoration[] = [
      { ignored: false, spans: [{ start: 2, end: 13, token: 'marker' }] }
    ]
    const overlay = captureOverlay(() => decorations)
    const tokens = runLine(overlay, line)

    // The marker span carries the class; the prose around it does not.
    expect(tokens.some((t) => t === 'mt-comment-marker')).toBe(true)
    expect(tokens[0]).toBe('')
  })

  it('adds no decoration to an ignored (literal-context) line', () => {
    const decorations: ISourceLineDecoration[] = [{ ignored: true, spans: [] }]
    const overlay = captureOverlay(() => decorations)

    expect(runLine(overlay, '<!--MC:x-->code')).toEqual([''])
  })
})

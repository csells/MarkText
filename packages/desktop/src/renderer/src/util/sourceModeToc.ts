import type CodeMirror from 'codemirror'

/** The CodeMirror surface `scrollSourceEditorToLine` needs. */
type ISourceEditor = Pick<CodeMirror.Editor, 'setCursor' | 'heightAtLine'>

/**
 * Scroll the Source Code editor so `line` sits at the TOP of the viewport,
 * animated.
 *
 * The editor runs CodeMirror with `viewportMargin: Infinity`, so CodeMirror
 * renders the whole document at full height and its own `.CodeMirror-scroll`
 * never scrolls — the OUTER `.source-code` container (`scrollContainer`) is the
 * scrollable element. So neither `cm.scrollTo` nor `cm.scrollIntoView` moves
 * anything; we scroll the container directly to the line's local Y, which puts
 * the line at the top (CodeMirror's `scrollIntoView` only scrolled minimally,
 * leaving the heading at the bottom edge with no animation). `setCursor` gets
 * `scroll: false` so its native caret-into-view scroll doesn't fight the
 * animation.
 */
export function scrollSourceEditorToLine(
  editor: ISourceEditor,
  line: number,
  scrollContainer: HTMLElement | null | undefined
): void {
  // `ch` is a positional filler: CodeMirror ignores it when `pos` is an object.
  editor.setCursor({ line, ch: 0 }, undefined, { scroll: false })

  if (!scrollContainer) return
  const top = editor.heightAtLine(line, 'local')
  scrollContainer.scrollTo({ top, behavior: 'smooth' })
}

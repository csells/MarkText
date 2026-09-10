import type CodeMirror from 'codemirror'
import codeMirror from '@/codeMirror'
import 'codemirror/addon/runmode/runmode'
import type { DocumentSourceSyntaxSpan } from '@marktext/document-core'
import type { CoreSourceSyntaxReply } from './coreProtocol'
import type { CodeMirrorCoreAdapter } from './codeMirrorCoreAdapter'

const sourceClasses = (span: DocumentSourceSyntaxSpan): string => {
  switch (span.kind) {
    case 'heading':
      return `cm-header cm-header-${String(span.headingLevel ?? 1)}`
    case 'emphasis':
      return 'cm-em'
    case 'strong':
      return 'cm-strong'
    case 'strikethrough':
      return 'cm-strikethrough'
    case 'inline-code':
    case 'code-block':
    case 'diagram':
      return 'cm-comment'
    case 'inline-math':
      return 'cm-math cm-math-inline'
    case 'math-block':
      return 'cm-math cm-math-block'
    case 'link':
    case 'autolink':
      return 'cm-link'
    case 'image':
      return 'cm-image cm-link'
    case 'blockquote':
      return 'cm-quote'
    case 'list':
    case 'list-item':
      return 'cm-variable-2'
    case 'inline-html':
    case 'html-block':
      return 'cm-tag'
    case 'front-matter':
      return 'cm-meta'
    case 'definition':
    case 'footnote-definition':
    case 'footnote-reference':
      return 'cm-link'
    case 'thematic-break':
      return 'cm-hr'
    case 'addition':
      return 'cm-critic-addition'
    case 'deletion':
      return 'cm-critic-deletion'
    case 'substitution':
      return 'cm-critic-substitution'
    case 'highlight':
      return 'cm-critic-highlight'
    case 'comment':
      return 'cm-critic-comment'
    case 'subscript':
      return 'cm-subscript'
    case 'superscript':
      return 'cm-superscript'
    default:
      return ''
  }
}

/** Source widgets paint the common model's spans; CodeMirror does not parse Markdown. */
export function bindCodeMirrorSourceSyntax(input: {
  editor: CodeMirror.Editor
  adapter: CodeMirrorCoreAdapter
  read: (revision: number) => CoreSourceSyntaxReply
  observe: (refresh: () => void) => () => void
  onFailure: (error: unknown) => void
}): () => void {
  const { editor, adapter } = input
  const doc = editor.getDoc()
  let marks: CodeMirror.TextMarker[] = []
  let disposed = false
  let scheduled = false
  let paintedRevision: number | undefined
  const clear = () => {
    for (const mark of marks) mark.clear()
    marks = []
    paintedRevision = undefined
  }
  const refresh = () => {
    if (disposed) return
    const state = adapter.state()
    if (state.status !== 'ready' || state.lastAcceptedRevision === paintedRevision) return
    const syntax = input.read(state.lastAcceptedRevision)
    if (syntax.revision !== state.lastAcceptedRevision) { throw new Error('Source syntax revision changed') }
    editor.operation(() => {
      clear()
      for (const span of syntax.spans) {
        const className = sourceClasses(span)
        if (className.length === 0) continue
        const info =
          span.literal === undefined ? undefined : codeMirror.findModeByName(span.literal.language)
        const modeName =
          span.literal === undefined ? undefined : (info?.mime ?? span.literal.language)
        const mode = modeName === undefined ? undefined : codeMirror.getMode({}, modeName)
        // Reuse registered embedded modes as before, never a Markdown/GFM parser.
        const highlightLiteral =
          mode !== undefined &&
          !['null', 'markdown', 'gfm', 'markdown-math'].includes(mode.name ?? 'null')
        const outerRanges =
          highlightLiteral && span.kind === 'code-block' && span.literal !== undefined
            ? [
              { start: span.range.start, end: span.literal.range.start },
              { start: span.literal.range.end, end: span.range.end }
            ]
            : [span.range]
        for (const range of outerRanges) {
          if (range.end > range.start) {
            marks.push(
              doc.markText(adapter.sourcePosition(range.start), adapter.sourcePosition(range.end), {
                className
              })
            )
          }
        }
        if (span.literal !== undefined && highlightLiteral) {
          const { range, language } = span.literal
          const from = adapter.sourcePosition(range.start)
          const to = adapter.sourcePosition(range.end)
          codeMirror.runMode(
            doc.getRange(from, to),
            info?.mime ?? language,
            (text: string, style: string | null, line: number, column: number) => {
              if (!style || text === '\n') return
              const ch = column + (line === 0 ? from.ch : 0)
              marks.push(
                doc.markText(
                  { line: from.line + line, ch },
                  { line: from.line + line, ch: ch + text.length },
                  {
                    className: style
                      .split(' ')
                      .map((token) => `cm-${token}`)
                      .join(' ')
                  }
                )
              )
            }
          )
        }
      }
      paintedRevision = syntax.revision
    })
  }
  const schedule = () => {
    if (scheduled || disposed) return
    scheduled = true
    // Source composition deliberately keeps its draft outside accepted source.
    // Await that existing barrier; never tokenize an unaccepted draft separately.
    adapter
      .settled()
      .then(() => {
        scheduled = false
        refresh()
      })
      .catch((error) => {
        scheduled = false
        if (!disposed) input.onFailure(error)
      })
  }
  const change = () => {
    editor.operation(clear)
    schedule()
  }
  editor.setOption('mode', null)
  doc.on('change', change)
  const stop = input.observe(schedule)
  try {
    refresh()
  } catch (error) {
    clear()
    input.onFailure(error)
  }
  return () => {
    disposed = true
    stop()
    doc.off('change', change)
    editor.operation(clear)
  }
}

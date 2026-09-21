import type { DocumentCore, DocumentRevision, DocumentSourceEdit, SourceRange } from './documentCore.js'
import { syntaxPathAt } from './syntaxPath.js'
import { containerContinuationPrefix } from './clipboardMarkdown.js'

/** The selected fence owns both its info string and the next editable body position. */
export function planCodeLanguage(core: DocumentCore, revision: DocumentRevision, selection: SourceRange, language: string): { edits: DocumentSourceEdit[], selection: SourceRange } {
  if (/[\r\n`]/u.test(language)) throw new RangeError('Code language must fit a fence info string')
  const syntax = core.project(revision, 'markup').syntax
  const at = syntax.coordinates.toProjected(selection.start, 'next')
  const ancestors = syntaxPathAt(syntax.ast.root, at)
  const fence = ancestors.find(node => node.kind === 'code-block' || node.kind === 'diagram')
  if (fence === undefined) throw new RangeError('Code language requires an owned fence')
  const { infoStart, infoEnd, contentStart } = fence.attributes
  if (typeof infoStart !== 'number' || typeof infoEnd !== 'number' || typeof contentStart !== 'number') {
    throw new RangeError('Code language requires parser-owned info and body positions')
  }
  const start = syntax.coordinates.toSource(infoStart, 'next')
  const end = syntax.coordinates.toSource(infoEnd, 'previous')
  if (fence.attributes.content === '' && fence.range.end <= contentStart) {
    const markerStart = syntax.coordinates.toSource(fence.range.start, 'next')
    const marker = core.sourceSlice(revision, { start: markerStart, end: start })
    const lineEnding = core.sourceSlice(revision, { start: end, end: revision.sourceLength }).match(/\r\n|\r|\n/u)?.[0] ?? '\n'
    const continuation = containerContinuationPrefix(core, revision, syntax, fence, ancestors)
    const insert = language + lineEnding + continuation + lineEnding + continuation + marker
    const caret = start + language.length + lineEnding.length + continuation.length
    return { edits: [{ start, end, insert }], selection: { start: caret, end: caret } }
  }
  const edits = core.sourceSlice(revision, { start, end }) === language ? [] : [{ start, end, insert: language }]
  const caret = syntax.coordinates.toSource(contentStart, 'next') + (edits.length === 0 ? 0 : language.length - (end - start))
  return { edits, selection: { start: caret, end: caret } }
}

import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, SourceRange } from './documentCore.js'
import { syntaxPathAt } from './syntaxPath.js'
import { containerContinuationPrefix } from './clipboardMarkdown.js'
import { fenceDiagramType, fenceOpenerOwnIndent } from './fenceOpener.js'

/**
 * The selected fence owns both its info string and the next editable body
 * position. With `infoOffset`, the caret stays in the info string at that
 * offset, as it does while the language is typed.
 */
export function planCodeLanguage(core: DocumentCore, revision: DocumentRevision, selection: SourceRange, language: string, infoOffset?: number): { edits: DocumentSourceEdit[], selection: SourceRange } {
  if (/[\r\n`]/u.test(language)) throw new RangeError('Code language must fit a fence info string')
  if (infoOffset !== undefined && !(Number.isInteger(infoOffset) && infoOffset >= 0 && infoOffset <= language.length)) {
    throw new RangeError('Code language caret must be within the language')
  }
  const syntax = core.project(revision, 'markup').syntax
  const at = syntax.coordinates.toProjected(selection.start, 'next')
  const ancestors = syntaxPathAt(syntax.ast.root, at)
  const fence = ancestors.find(node => node.kind === 'code-block' || node.kind === 'diagram')
  if (fence === undefined) throw new RangeError('Code language requires an owned fence')
  if (fence.attributes.provider === 'indented-code') {
    return fenceIndentedCode(core, revision, syntax, fence, language, infoOffset ?? language.length)
  }
  const { infoStart, infoEnd, contentStart } = fence.attributes
  if (typeof infoStart !== 'number' || typeof infoEnd !== 'number' || typeof contentStart !== 'number') {
    throw new RangeError('Code language requires parser-owned info and body positions')
  }
  const start = syntax.coordinates.toSource(infoStart, 'next')
  const end = syntax.coordinates.toSource(infoEnd, 'previous')
  if (fence.attributes.content === '' && fence.range.end <= contentStart) {
    // Upstream's picker replaces the opener line with the block it chose:
    // without the opener's own indentation, and, for a diagram language
    // typed or picked, as a diagram block written with backticks.
    const markerStart = syntax.coordinates.toSource(fence.range.start, 'next')
    const indent = fenceOpenerOwnIndent(core, revision, syntax, ancestors.slice(0, ancestors.indexOf(fence)), markerStart)
    const typed = /^\S*/u.exec(core.sourceSlice(revision, { start, end }).trimStart())?.[0] ?? ''
    const diagram = fenceDiagramType(typed) ?? fenceDiagramType(language)
    const marker = diagram === undefined ? core.sourceSlice(revision, { start: markerStart, end: start }) : '```'
    const info = diagram ?? language
    const lineEnding = core.sourceSlice(revision, { start: end, end: revision.sourceLength }).match(/\r\n|\r|\n/u)?.[0] ?? '\n'
    const prefix = containerContinuationPrefix(core, revision, syntax, fence, ancestors)
    const continuation = prefix.slice(0, prefix.length - indent)
    const from = markerStart - indent
    const insert = marker + info + lineEnding + continuation + lineEnding + continuation + marker
    const caret = from + marker.length + info.length + lineEnding.length + continuation.length
    return { edits: [{ start: from, end, insert }], selection: { start: caret, end: caret } }
  }
  const edits = core.sourceSlice(revision, { start, end }) === language ? [] : [{ start, end, insert: language }]
  const caret = infoOffset !== undefined
    ? start + infoOffset
    : syntax.coordinates.toSource(contentStart, 'next') + (edits.length === 0 ? 0 : language.length - (end - start))
  return { edits, selection: { start: caret, end: caret } }
}

/**
 * Upstream gives indented code a language by writing it afresh as a fenced
 * block: its literal lines within the containers' continuation, between
 * backtick fences. The caret stays in the info string.
 */
function fenceIndentedCode(
  core: DocumentCore, revision: DocumentRevision, syntax: MarkupSyntax, code: MarkdownAstNode, language: string, infoOffset: number
): { edits: DocumentSourceEdit[], selection: SourceRange } {
  const { contentStart, contentEnd, content } = code.attributes
  if (typeof contentStart !== 'number' || typeof contentEnd !== 'number' || typeof content !== 'string') {
    throw new RangeError('Indented code requires parser-owned content')
  }
  const firstText = syntax.coordinates.toSource(contentStart, 'next')
  const preceding = core.sourceSlice(revision, { start: Math.max(0, firstText - 256), end: firstText })
  const lineStart = firstText - preceding.length + Math.max(preceding.lastIndexOf('\n'), preceding.lastIndexOf('\r')) + 1
  // The first line's prefix is the containers' continuation and the code's indentation.
  const continuation = core.sourceSlice(revision, { start: lineStart, end: firstText }).replace(/(?: {1,4}|\t)$/u, '')
  const lineEnding = core.sourceSlice(revision, { start: firstText, end: revision.sourceLength }).match(/\r\n|\r|\n/u)?.[0] ??
    core.sourceSlice(revision, { start: 0, end: firstText }).match(/\r\n|\r|\n/u)?.[0] ?? '\n'
  // The literal value ends with its last line's ending, which the closing fence follows.
  const lines = content.replace(/(?:\r\n|\r|\n)$/u, '').split(/\r\n|\r|\n/u)
  const body = lines.map(line => (line === '' ? continuation.trimEnd() : continuation + line) + lineEnding).join('')
  const start = lineStart + continuation.length
  let end = syntax.coordinates.toSource(contentEnd, 'previous')
  const last = core.sourceSlice(revision, { start: Math.max(0, end - 2), end }).match(/(?:\r\n|\r|\n)$/u)?.[0]
  if (last !== undefined) end -= last.length
  const insert = '```' + language + lineEnding + body + continuation + '```'
  const caret = start + 3 + infoOffset
  return { edits: [{ start, end, insert }], selection: { start: caret, end: caret } }
}

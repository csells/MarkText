import {
  analyzeMarkdownComments,
  createCommentMetadata,
  encodeCommentMetadata,
  nextCommentId,
  serializeCommentMarker,
  serializeCommentMetadataDefinition,
  sourceRangesOverlap,
  type ICommentAnalysis,
  type ICommentSourceIndex,
  type ICommentSourceIndexRange,
  type IParseMarkdownCommentOptions,
  type IParsedMarkdownComments
} from '@muyajs/core'

export type SourceCommentParserOptions = Required<IParseMarkdownCommentOptions>

export interface SourceCommentAnalysis {
  markdown: string
  parserOptionsKey: string
  comments: IParsedMarkdownComments
  ids: ICommentAnalysis['ids']
  sourceIndex: ICommentSourceIndex
  sourceMaps: ICommentAnalysis['sourceMaps']
}

export interface SourceCommentCandidate {
  id: string
  startIndex: number
  endIndex: number
}

export type SourceCommentSyntaxIndexRange = ICommentSourceIndexRange

export const createSourceCommentAnalysis = (
  markdown: string,
  parserOptions: SourceCommentParserOptions
): SourceCommentAnalysis => {
  const analysis = analyzeMarkdownComments(markdown, parserOptions)
  return {
    markdown,
    parserOptionsKey: JSON.stringify(parserOptions),
    comments: analysis.comments,
    ids: analysis.ids,
    sourceIndex: analysis.sourceIndex,
    sourceMaps: analysis.sourceMaps
  }
}

export const sourceCommentIndexRanges = (analysis: SourceCommentAnalysis) =>
  analysis.sourceIndex.commentRanges

export const sourceCommentSyntaxIndexRanges = (analysis: SourceCommentAnalysis) =>
  analysis.sourceIndex.syntaxRanges

export const sourceCommentDiagnosticSyntaxRange = (
  analysis: SourceCommentAnalysis,
  id: string
): SourceCommentSyntaxIndexRange | null => {
  const marker = analysis.sourceIndex.markers.find((marker) => marker.id === id)
  if (marker) {
    return {
      start: marker.start,
      end: marker.end
    }
  }

  return analysis.sourceIndex.metadataDefinitions.find((definition) => definition.id === id) ?? null
}

export const sourceCommentDiscardRanges = (
  analysis: SourceCommentAnalysis,
  id: string
): SourceCommentSyntaxIndexRange[] => {
  const thread = analysis.comments.threads.find((item) => item.id === id)
  if (!thread || thread.status !== 'open' || thread.replies.length) return []

  return analysis.sourceMaps.ranges.find((range) => range.id === id)?.syntaxRemovalRanges ?? []
}

export const activeSourceCommentIds = (
  selectionStart: number,
  selectionEnd: number,
  analysis: SourceCommentAnalysis
): string[] =>
  sourceCommentIndexRanges(analysis)
    .filter((range) => {
      if (selectionStart === selectionEnd) {
        return selectionStart >= range.start && selectionStart <= range.end
      }

      return selectionEnd >= range.start && selectionStart <= range.end
    })
    .map((range) => range.id)

const sourceLineEnding = (markdown: string): string => {
  if (markdown.includes('\r\n')) return '\r\n'
  if (markdown.includes('\r')) return '\r'
  return '\n'
}

export const commentMetadataAppendix = (markdown: string, id: string): string => {
  const lineEnding = sourceLineEnding(markdown)
  const separator =
    markdown.endsWith('\n') || markdown.endsWith('\r') ? lineEnding : `${lineEnding}${lineEnding}`
  const metadata = encodeCommentMetadata(createCommentMetadata({}))
  return `${separator}${serializeCommentMetadataDefinition(id, metadata)}${lineEnding}`
}

export const sourceCommentMarkdown = (
  markdown: string,
  startIndex: number,
  endIndex: number,
  id: string
): string => {
  const openMarker = serializeCommentMarker(id, 'open')
  const closeMarker = serializeCommentMarker(id, 'close')
  const markedMarkdown = [
    markdown.slice(0, startIndex),
    openMarker,
    markdown.slice(startIndex, endIndex),
    closeMarker,
    markdown.slice(endIndex)
  ].join('')

  return `${markedMarkdown}${commentMetadataAppendix(markedMarkdown, id)}`
}

const blockContentStartIndex = (markdown: string, index: number): number => {
  const lineStart = markdown.lastIndexOf('\n', index - 1) + 1
  let lineEnd = markdown.indexOf('\n', lineStart)
  if (lineEnd === -1) lineEnd = markdown.length
  const line = markdown.slice(lineStart, lineEnd)
  const prefix =
    /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?(?:#{1,6}[ \t]+)?/u.exec(
      line
    )
  return lineStart + (prefix ? prefix[0].length : 0)
}

const insertionDemotesBlock = (markdown: string, index: number): boolean =>
  index < blockContentStartIndex(markdown, index)

export const getSourceCommentCandidate = (
  markdown: string,
  startIndex: number,
  endIndex: number,
  parserOptions: SourceCommentParserOptions,
  analysis = createSourceCommentAnalysis(markdown, parserOptions)
): SourceCommentCandidate | null => {
  if (startIndex === endIndex) return null
  if (startIndex > endIndex) { return getSourceCommentCandidate(markdown, endIndex, startIndex, parserOptions, analysis) }
  if (markdown.slice(startIndex, endIndex).trim().length === 0) return null
  if (sourceRangesOverlap(startIndex, endIndex, analysis.sourceIndex.ignoredRanges)) return null
  if (
    sourceCommentSyntaxIndexRanges(analysis).some(
      (syntaxRange) => startIndex < syntaxRange.end && endIndex > syntaxRange.start
    )
  ) {
    return null
  }
  if (insertionDemotesBlock(markdown, startIndex) || insertionDemotesBlock(markdown, endIndex)) {
    return null
  }

  const id = nextCommentId(analysis.ids)
  const proposedAnalysis = analyzeMarkdownComments(
    sourceCommentMarkdown(markdown, startIndex, endIndex, id),
    parserOptions
  )
  if (!proposedAnalysis.comments.ranges.some((commentRange) => commentRange.id === id)) return null
  if (proposedAnalysis.comments.diagnostics.some((diagnostic) => diagnostic.id === id)) return null

  return { id, startIndex, endIndex }
}

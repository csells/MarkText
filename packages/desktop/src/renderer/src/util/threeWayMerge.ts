import { diff3Merge } from 'node-diff3'

export interface ThreeWayMergeConflict {
  id: string
  baseStartLine: number
  baseEndLine: number
  baseText: string
  localText: string
  remoteText: string
  markerText: string
}

export interface ThreeWayMergeResult {
  mergedMarkdown: string
  conflicts: ThreeWayMergeConflict[]
}

export interface MergeInput {
  base: string
  local: string
  remote: string
}

type ConflictChoice = 'local' | 'remote' | 'both'

// Diff3's LCS work is bounded here so a huge external change cannot freeze or
// OOM the renderer. Larger documents degrade to a whole-file conflict instead
// of risking a crash while a dirty buffer is open.
const MERGE_LCS_CELL_BUDGET = 64_000_000

const splitMarkdownLines = (markdown: string): string[] => {
  const lines: string[] = []
  let start = 0

  for (let index = 0; index < markdown.length; index += 1) {
    const char = markdown[index]
    if (char === '\n') {
      lines.push(markdown.slice(start, index + 1))
      start = index + 1
    } else if (char === '\r') {
      const end = markdown[index + 1] === '\n' ? index + 2 : index + 1
      lines.push(markdown.slice(start, end))
      start = end
      index = end - 1
    }
  }

  if (start < markdown.length) {
    lines.push(markdown.slice(start))
  }

  return lines
}

const detectLineEnding = (...texts: string[]): string => {
  for (const text of texts) {
    const match = /\r\n|\n|\r/.exec(text)
    if (match) return match[0]
  }
  return '\n'
}

const endsWithLineEnding = (text: string): boolean => /(?:\r\n|\n|\r)$/.test(text)

const countLines = (lines: string[]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1)
  }
  return counts
}

const countFor = (counts: Map<string, number>, line: string): number => counts.get(line) ?? 0

// A correct positional three-way merge for the case where all three sides have
// the SAME line count: at each index take whichever side changed the line (or
// the common value). node-diff3 needlessly conflicts some of these (e.g. a
// file with no trailing newline, where its last-line diff granularity groups
// unrelated edits), so this handles the common "both sides edited different
// lines" case cleanly. It is NOT sound on its own — equal line counts can mask
// an insert+delete that misaligns positions — so its output, like node-diff3's,
// is validated by mergeViolatesDataPreservation before being accepted.
const mergeAlignedLineEdits = (
  baseLines: string[],
  localLines: string[],
  remoteLines: string[]
): string[] | null => {
  if (baseLines.length !== localLines.length || baseLines.length !== remoteLines.length) {
    return null
  }

  const merged: string[] = []
  for (let index = 0; index < baseLines.length; index += 1) {
    const baseLine = baseLines[index]
    const localLine = localLines[index]
    const remoteLine = remoteLines[index]
    if (localLine === remoteLine) {
      merged.push(localLine)
    } else if (localLine === baseLine) {
      merged.push(remoteLine)
    } else if (remoteLine === baseLine) {
      merged.push(localLine)
    } else {
      return null
    }
  }
  return merged
}

// node-diff3 does the actual general three-way merge (a maintained
// implementation of the diff3 algorithm). It is the merge engine — we do NOT
// re-derive or second-guess its alignment. But diff3 (this library, like others) can
// occasionally emit a CLEAN merge that silently drops a line both sides kept
// when reconciling adjacent edits. So the one thing we add on top is a SOUND
// data-preservation check on its output — not an attempt to reproduce any
// particular diff tool's bytes.
//
// For every distinct line, the accepted merge's copy count must satisfy:
//   count >= min(local, remote)   — nothing BOTH sides retained is dropped
//   count <= local + remote       — nothing is fabricated beyond both sides
// A merged line outside these bounds means the library dropped or invented
// content, so we reject the auto-merge and escalate to a whole-file conflict
// the user resolves. This is a provable invariant, not a heuristic: it cannot
// accept a merge that loses retained content or fabricates content.
const mergeViolatesDataPreservation = (
  localLines: string[],
  remoteLines: string[],
  mergedLines: string[]
): boolean => {
  const localCounts = countLines(localLines)
  const remoteCounts = countLines(remoteLines)
  const mergedCounts = countLines(mergedLines)
  const lines = new Set([
    ...localCounts.keys(),
    ...remoteCounts.keys(),
    ...mergedCounts.keys()
  ])

  for (const line of lines) {
    const local = countFor(localCounts, line)
    const remote = countFor(remoteCounts, line)
    const merged = countFor(mergedCounts, line)
    if (merged < Math.min(local, remote) || merged > local + remote) {
      return true
    }
  }

  return false
}

const createConflictMarker = (
  id: string,
  baseText: string,
  localText: string,
  remoteText: string,
  lineEnding: string
): string => {
  return [
    `<<<<<<< MARKTEXT_LOCAL ${id}${lineEnding}`,
    localText,
    endsWithLineEnding(localText) || localText.length === 0 ? '' : lineEnding,
    `||||||| MARKTEXT_BASE ${id}${lineEnding}`,
    baseText,
    endsWithLineEnding(baseText) || baseText.length === 0 ? '' : lineEnding,
    `=======${lineEnding}`,
    remoteText,
    endsWithLineEnding(remoteText) || remoteText.length === 0 ? '' : lineEnding,
    `>>>>>>> MARKTEXT_REMOTE ${id}${lineEnding}`
  ].join('')
}

const combineConflictTexts = (localText: string, remoteText: string, lineEnding: string): string => {
  if (!localText) return remoteText
  if (!remoteText || endsWithLineEnding(localText) || /^(?:\r\n|\n|\r)/.test(remoteText)) {
    return `${localText}${remoteText}`
  }
  return `${localText}${lineEnding}${remoteText}`
}

export const createWholeFileConflict = (
  base: string,
  local: string,
  remote: string
): ThreeWayMergeResult => {
  const id = 'c1'
  const markerText = createConflictMarker(
    id,
    base,
    local,
    remote,
    detectLineEnding(local, remote, base)
  )
  return {
    mergedMarkdown: markerText,
    conflicts: [
      {
        id,
        baseStartLine: 1,
        baseEndLine: splitMarkdownLines(base).length,
        baseText: base,
        localText: local,
        remoteText: remote,
        markerText
      }
    ]
  }
}

export const resolveConflictMarker = (
  markdown: string,
  conflict: ThreeWayMergeConflict,
  choice: ConflictChoice
): string => {
  const replacement =
    choice === 'local'
      ? conflict.localText
      : choice === 'remote'
        ? conflict.remoteText
        : combineConflictTexts(
          conflict.localText,
          conflict.remoteText,
          detectLineEnding(
            conflict.localText,
            conflict.remoteText,
            conflict.baseText,
            conflict.markerText
          )
        )

  // A function replacement is used so `$`, `$$`, `$&`, `` $` `` etc. inside the
  // chosen document text are inserted literally rather than being interpreted as
  // String.prototype.replace substitution patterns (which corrupted KaTeX math).
  return markdown.replace(conflict.markerText, () => replacement)
}

// True when `markdown` still contains generated conflict scaffolding. Used to
// (a) tell a resolve action its exact-match splice found nothing (e.g. the user
// edited inside the block), and (b) block accepting a result that would write
// literal '<<<<<<< MARKTEXT_LOCAL' markers into the document.
// Match the three id-bearing marker lines createConflictMarker emits (local,
// base, and remote) — any surviving one means a conflict block is unresolved.
// The bare '=======' separator is deliberately NOT matched: it never appears
// without these labelled markers in a generated conflict, and matching it
// would false-positive on legitimate content (a setext H1 underline or a
// 7-equals horizontal rule), blocking a valid merge from ever being accepted.
const CONFLICT_SCAFFOLDING_REGEXP =
  /^(?:<{7} MARKTEXT_LOCAL |\|{7} MARKTEXT_BASE |>{7} MARKTEXT_REMOTE )/m
export const containsConflictScaffolding = (markdown: string): boolean =>
  CONFLICT_SCAFFOLDING_REGEXP.test(markdown)

export const mergeMarkdownThreeWay = ({ base, local, remote }: MergeInput): ThreeWayMergeResult => {
  if (local === remote) {
    return { mergedMarkdown: local, conflicts: [] }
  }
  if (local === base) {
    return { mergedMarkdown: remote, conflicts: [] }
  }
  if (remote === base) {
    return { mergedMarkdown: local, conflicts: [] }
  }

  const baseLines = splitMarkdownLines(base)
  const localLines = splitMarkdownLines(local)
  const remoteLines = splitMarkdownLines(remote)

  if (baseLines.length * Math.max(localLines.length, remoteLines.length) > MERGE_LCS_CELL_BUDGET) {
    return createWholeFileConflict(base, local, remote)
  }

  // Fast path: a positional merge for equal-length inputs, accepted only when
  // it provably preserved data (the same sound check applied to node-diff3).
  const alignedMerge = mergeAlignedLineEdits(baseLines, localLines, remoteLines)
  if (alignedMerge && !mergeViolatesDataPreservation(localLines, remoteLines, alignedMerge)) {
    return {
      mergedMarkdown: alignedMerge.join(''),
      conflicts: []
    }
  }

  const merged: string[] = []
  const conflicts: ThreeWayMergeConflict[] = []

  for (const region of diff3Merge<string>(localLines, baseLines, remoteLines, {
    excludeFalseConflicts: true
  })) {
    if (region.ok) {
      merged.push(...region.ok)
    } else if (region.conflict) {
      const { conflict } = region
      const id = `c${conflicts.length + 1}`
      const baseText = conflict.o.join('')
      const localText = conflict.a.join('')
      const remoteText = conflict.b.join('')
      const markerText = createConflictMarker(
        id,
        baseText,
        localText,
        remoteText,
        detectLineEnding(localText, remoteText, baseText, local, remote, base)
      )
      conflicts.push({
        id,
        baseStartLine: conflict.oIndex + 1,
        baseEndLine: conflict.oIndex + conflict.o.length,
        baseText,
        localText,
        remoteText,
        markerText
      })
      merged.push(markerText)
    }
  }

  const mergedLines = merged

  // node-diff3 produced a clean merge; accept it only if it provably preserved
  // data, otherwise escalate to a whole-file conflict the user resolves.
  if (
    conflicts.length === 0 &&
    mergeViolatesDataPreservation(localLines, remoteLines, mergedLines)
  ) {
    return createWholeFileConflict(base, local, remote)
  }

  return {
    mergedMarkdown: mergedLines.join(''),
    conflicts
  }
}

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

// Repeated lines (blank lines, list bullets, fences) are where line-level
// diff3 is least trustworthy: it can silently keep a copy both sides removed
// or drop one a side added. Rather than "fix" the merged output by splicing
// copies around — a position-blind operation that three review rounds showed
// can relocate a line into content neither side wrote — we only ACCEPT a clean
// auto-merge whose per-line counts are provably safe, and escalate everything
// else to a whole-file conflict the user resolves explicitly. A conflict is
// recoverable; silent corruption or a silently dropped line is not.
//
// A repeated line's merged count is SAFE to auto-accept only when it is
// unambiguously determined by the three inputs — i.e. at most one side changed
// how many times the line occurs, or both sides changed it to the same count —
// AND the merged output already holds exactly that count. When both sides
// changed the count differently (or to the same number but via independent
// vs identical insertions git would resolve differently), the correct count
// is not decidable from counts alone, so we escalate rather than guess. This
// is deliberately conservative: it can escalate a merge git would resolve
// cleanly, but it can never emit a clean merge whose repeated-line count is
// wrong (the silent-corruption class from prior review rounds).
const hasUnsafeRepeatedLineCount = (
  baseLines: string[],
  localLines: string[],
  remoteLines: string[],
  mergedLines: string[]
): boolean => {
  const baseCounts = countLines(baseLines)
  const localCounts = countLines(localLines)
  const remoteCounts = countLines(remoteLines)
  const mergedCounts = countLines(mergedLines)
  const lines = new Set([
    ...baseCounts.keys(),
    ...localCounts.keys(),
    ...remoteCounts.keys()
  ])

  for (const line of lines) {
    const baseCount = countFor(baseCounts, line)
    const localCount = countFor(localCounts, line)
    const remoteCount = countFor(remoteCounts, line)
    const mergedCount = countFor(mergedCounts, line)
    // Only repeated lines suffer the diff3 mis-count: a line appearing at most
    // once everywhere is aligned unambiguously (an edit or move of a unique
    // line is normal diff3 territory, not a count hazard). Skipping them
    // avoids escalating the common "one side edited this unique line" case,
    // which legitimately drops the old text (count 1 -> 0).
    if (Math.max(baseCount, localCount, remoteCount, mergedCount) < 2) {
      continue
    }
    // A line whose count never varies across the inputs cannot be mis-counted.
    if (localCount === baseCount && remoteCount === baseCount) {
      continue
    }
    // The count is unambiguous only when EXACTLY ONE side changed it. When both
    // sides changed it — even to the same number — the result depends on
    // whether the two edits are the same insertion (git collapses them) or
    // independent (git sums them), which line counts cannot distinguish, so we
    // escalate. When one side changed it, git takes that side's count.
    let expected: number
    if (localCount === baseCount) {
      expected = remoteCount
    } else if (remoteCount === baseCount) {
      expected = localCount
    } else {
      return true
    }
    if (mergedCount !== expected) {
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

  const alignedMerge = mergeAlignedLineEdits(baseLines, localLines, remoteLines)
  if (alignedMerge) {
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

  if (
    conflicts.length === 0 &&
    hasUnsafeRepeatedLineCount(baseLines, localLines, remoteLines, mergedLines)
  ) {
    return createWholeFileConflict(base, local, remote)
  }

  return {
    mergedMarkdown: mergedLines.join(''),
    conflicts
  }
}

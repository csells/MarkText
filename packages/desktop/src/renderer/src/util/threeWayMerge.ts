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

const findLongestRun = (lines: string[], line: string): { start: number; length: number } | null => {
  let best: { start: number; length: number } | null = null
  let index = 0
  while (index < lines.length) {
    if (lines[index] !== line) {
      index += 1
      continue
    }

    const start = index
    while (index < lines.length && lines[index] === line) index += 1
    const length = index - start
    if (!best || length > best.length) {
      best = { start, length }
    }
  }
  return best
}

// Where a side inserted `line`, capture the neighbor context (the preceding
// line) of each occurrence the side has beyond base. If local and remote
// inserted `line` with IDENTICAL context multisets, they made the same edit —
// git counts an identical change once, so the merge target must be the max of
// the two sides, never their sum. Summing an identical insertion forced a
// position-blind splice that could relocate a repeated line (e.g. a blank
// line) into content neither side wrote.
const LINE_START_SENTINEL = '\u0000<start>'

const contextBigramsForLine = (lines: string[], line: string): Map<string, number> => {
  const bigrams = new Map<string, number>()
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== line) continue
    const prev = index === 0 ? LINE_START_SENTINEL : lines[index - 1]
    bigrams.set(prev, (bigrams.get(prev) ?? 0) + 1)
  }
  return bigrams
}

const insertedContextBigrams = (
  baseLines: string[],
  sideLines: string[],
  line: string
): Map<string, number> => {
  const base = contextBigramsForLine(baseLines, line)
  const side = contextBigramsForLine(sideLines, line)
  const inserted = new Map<string, number>()
  for (const [context, count] of side) {
    const extra = count - (base.get(context) ?? 0)
    if (extra > 0) inserted.set(context, extra)
  }
  return inserted
}

const occurrenceCount = (lines: string[], line: string): number => {
  let count = 0
  for (const candidate of lines) {
    if (candidate === line) count += 1
  }
  return count
}

const insertedContextsMatch = (
  baseLines: string[],
  localLines: string[],
  remoteLines: string[],
  line: string
): boolean => {
  const local = insertedContextBigrams(baseLines, localLines, line)
  const remote = insertedContextBigrams(baseLines, remoteLines, line)
  if (local.size !== remote.size) return false
  for (const [context, count] of local) {
    if (remote.get(context) !== count) return false
    // The context must pin ONE position: an anchor that repeats (or is the
    // inserted line itself, i.e. a run extension) leaves the alignment
    // ambiguous, and git's positional diff may then treat the two sides'
    // insertions as independent — assume independence there too.
    if (context === line) return false
    if (context !== LINE_START_SENTINEL) {
      if (occurrenceCount(localLines, context) !== 1) return false
      if (occurrenceCount(remoteLines, context) !== 1) return false
    }
  }
  return true
}

const reconcileRepeatedLineCounts = (
  baseLines: string[],
  localLines: string[],
  remoteLines: string[],
  mergedLines: string[]
): string[] | null => {
  const baseCounts = countLines(baseLines)
  const localCounts = countLines(localLines)
  const remoteCounts = countLines(remoteLines)
  const lines = new Set([...baseCounts.keys(), ...localCounts.keys(), ...remoteCounts.keys()])
  const reconciled = [...mergedLines]
  const hasAnyCountDeficit = [...lines].some((line) => {
    const baseCount = countFor(baseCounts, line)
    return countFor(localCounts, line) < baseCount || countFor(remoteCounts, line) < baseCount
  })

  for (const line of lines) {
    const baseCount = countFor(baseCounts, line)
    const localCount = countFor(localCounts, line)
    const remoteCount = countFor(remoteCounts, line)
    if (Math.max(baseCount, localCount, remoteCount) < 2) {
      continue
    }

    const localDeficit = Math.max(0, baseCount - localCount)
    const remoteDeficit = Math.max(0, baseCount - remoteCount)
    const bothInserted = localCount > baseCount && remoteCount > baseCount
    let targetCount: number
    if (localDeficit > 0 && remoteDeficit > 0 && localDeficit !== remoteDeficit) {
      targetCount = Math.max(localCount, remoteCount)
    } else if (
      bothInserted &&
      (!hasAnyCountDeficit || insertedContextsMatch(baseLines, localLines, remoteLines, line))
    ) {
      targetCount = Math.max(localCount, remoteCount)
    } else {
      targetCount = Math.max(0, localCount + remoteCount - baseCount)
    }
    let actualCount = reconciled.filter((candidate) => candidate === line).length
    if (actualCount > targetCount && baseCount < 3) {
      continue
    }

    while (actualCount > targetCount) {
      const run = findLongestRun(reconciled, line)
      if (!run) return null

      reconciled.splice(run.start + run.length - 1, 1)
      actualCount -= 1
    }

    while (actualCount < targetCount) {
      const run = findLongestRun(reconciled, line)
      if (!run) return null

      reconciled.splice(run.start + run.length, 0, line)
      actualCount += 1
    }
  }

  return reconciled
}

const dropsPositiveLineDelta = (
  baseLines: string[],
  localLines: string[],
  remoteLines: string[],
  mergedLines: string[]
): boolean => {
  const baseCounts = countLines(baseLines)
  const localCounts = countLines(localLines)
  const remoteCounts = countLines(remoteLines)
  const mergedCounts = countLines(mergedLines)
  const lines = new Set([...localCounts.keys(), ...remoteCounts.keys()])

  for (const line of lines) {
    const baseCount = countFor(baseCounts, line)
    const localInserted = Math.max(0, countFor(localCounts, line) - baseCount)
    const remoteInserted = Math.max(0, countFor(remoteCounts, line) - baseCount)
    const insertedCount =
      localInserted > 0 &&
      remoteInserted > 0 &&
      insertedContextsMatch(baseLines, localLines, remoteLines, line)
        ? Math.max(localInserted, remoteInserted)
        : localInserted + remoteInserted
    if (insertedCount > 0 && countFor(mergedCounts, line) < baseCount + insertedCount) {
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
const CONFLICT_SCAFFOLDING_REGEXP = /^<{7} MARKTEXT_LOCAL |^={7}$|^>{7} MARKTEXT_REMOTE /m
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

  const reconciled =
    conflicts.length === 0
      ? reconcileRepeatedLineCounts(baseLines, localLines, remoteLines, merged)
      : null
  const mergedLines = reconciled ?? merged

  if (
    conflicts.length === 0 &&
    dropsPositiveLineDelta(baseLines, localLines, remoteLines, mergedLines)
  ) {
    return createWholeFileConflict(base, local, remote)
  }

  return {
    mergedMarkdown: mergedLines.join(''),
    conflicts
  }
}

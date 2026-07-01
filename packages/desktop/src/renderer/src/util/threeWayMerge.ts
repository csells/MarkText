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

// A change to the base document, expressed in BASE line coordinates: base lines
// [oStart, oEnd) are replaced by `lines`. A pure insertion has oStart === oEnd;
// a pure deletion has an empty `lines`. Anchoring every change to base
// coordinates is what lets two sides that both delete the same base line
// collapse to a single deletion instead of silently keeping the line.
interface ChangeRegion {
  oStart: number
  oEnd: number
  lines: string[]
}

interface MergeInput {
  base: string
  local: string
  remote: string
}

type ConflictChoice = 'local' | 'remote' | 'both'

// The base×changed LCS table is O(n·m) memory; two are built per merge. Beyond
// this many cells we refuse to allocate and degrade to a whole-file conflict so
// a huge external change cannot freeze or OOM the renderer. ~64M cells covers
// symmetric merges up to ~8000 lines (a few hundred MB, sub-second); larger
// documents degrade to a whole-file conflict instead of risking a crash.
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

const buildLcsTable = (left: string[], right: string[]): number[][] => {
  const table = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0))

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  return table
}

// The matched (unchanged) line pairs of an LCS alignment of base→side.
const lcsMatches = (base: string[], side: string[]): Array<[number, number]> => {
  const table = buildLcsTable(base, side)
  const matches: Array<[number, number]> = []
  let i = 0
  let j = 0

  while (i < base.length && j < side.length) {
    if (base[i] === side[j]) {
      matches.push([i, j])
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i += 1
    } else {
      j += 1
    }
  }

  return matches
}

// Everything between the LCS anchors is a change region in base coordinates.
const diffRegions = (base: string[], side: string[]): ChangeRegion[] => {
  const regions: ChangeRegion[] = []
  let oi = 0
  let si = 0

  const push = (oEnd: number, sEnd: number): void => {
    if (oi < oEnd || si < sEnd) {
      regions.push({ oStart: oi, oEnd, lines: side.slice(si, sEnd) })
    }
  }

  for (const [mo, ms] of lcsMatches(base, side)) {
    push(mo, ms)
    oi = mo + 1
    si = ms + 1
  }
  push(base.length, side.length)

  return regions
}

// Reconstruct a side's content for base span [start, end), applying that side's
// change regions (including insertions at points inside the span).
const reconstructSide = (
  base: string[],
  regions: ChangeRegion[],
  start: number,
  end: number
): string[] => {
  const out: string[] = []
  let k = start
  let idx = 0
  while (idx < regions.length && regions[idx].oEnd < start) idx += 1

  while (k < end || (idx < regions.length && regions[idx].oStart === k && k <= end)) {
    if (idx < regions.length && regions[idx].oStart === k) {
      out.push(...regions[idx].lines)
      k = Math.max(k, regions[idx].oEnd)
      idx += 1
    } else if (k < end) {
      out.push(base[k])
      k += 1
    } else {
      break
    }
  }

  return out
}

const sameLines = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false
  return left.every((line, index) => line === right[index])
}

const detectLineEnding = (...texts: string[]): string => {
  for (const text of texts) {
    const match = /\r\n|\n|\r/.exec(text)
    if (match) return match[0]
  }
  return '\n'
}

const endsWithLineEnding = (text: string): boolean => /(?:\r\n|\n|\r)$/.test(text)

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

const wholeFileConflict = (base: string, local: string, remote: string): ThreeWayMergeResult => {
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
        : `${conflict.localText}${conflict.remoteText}`

  // A function replacement is used so `$`, `$$`, `$&`, `` $` `` etc. inside the
  // chosen document text are inserted literally rather than being interpreted as
  // String.prototype.replace substitution patterns (which corrupted KaTeX math).
  return markdown.replace(conflict.markerText, () => replacement)
}

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
    return wholeFileConflict(base, local, remote)
  }

  const chA = diffRegions(baseLines, localLines)
  const chB = diffRegions(baseLines, remoteLines)
  const merged: string[] = []
  const conflicts: ThreeWayMergeConflict[] = []
  let oi = 0
  let ai = 0
  let bi = 0

  while (ai < chA.length || bi < chB.length || oi < baseLines.length) {
    const aStart = ai < chA.length ? chA[ai].oStart : Infinity
    const bStart = bi < chB.length ? chB[bi].oStart : Infinity
    const nextChange = Math.min(aStart, bStart)

    if (oi < nextChange) {
      const upto = Math.min(nextChange, baseLines.length)
      merged.push(...baseLines.slice(oi, upto))
      oi = upto
      if (nextChange === Infinity) break
      continue
    }

    // A change begins at oi. Grow the region to cover every local/remote change
    // that overlaps it, so overlapping edits become one conflict/decision.
    const start = oi
    let end = oi
    const aGroup: ChangeRegion[] = []
    const bGroup: ChangeRegion[] = []

    const seedOrOverlap = (region: ChangeRegion): boolean =>
      region.oStart === start || region.oStart < end

    let grew = true
    while (grew) {
      grew = false
      while (ai < chA.length && seedOrOverlap(chA[ai])) {
        aGroup.push(chA[ai])
        end = Math.max(end, chA[ai].oEnd)
        ai += 1
        grew = true
      }
      while (bi < chB.length && seedOrOverlap(chB[bi])) {
        bGroup.push(chB[bi])
        end = Math.max(end, chB[bi].oEnd)
        bi += 1
        grew = true
      }
    }

    const baseSpan = baseLines.slice(start, end)
    const localSpan = reconstructSide(baseLines, aGroup, start, end)
    const remoteSpan = reconstructSide(baseLines, bGroup, start, end)

    if (sameLines(localSpan, remoteSpan)) {
      merged.push(...localSpan)
    } else if (sameLines(localSpan, baseSpan)) {
      merged.push(...remoteSpan)
    } else if (sameLines(remoteSpan, baseSpan)) {
      merged.push(...localSpan)
    } else {
      const id = `c${conflicts.length + 1}`
      const baseText = baseSpan.join('')
      const localText = localSpan.join('')
      const remoteText = remoteSpan.join('')
      const markerText = createConflictMarker(
        id,
        baseText,
        localText,
        remoteText,
        detectLineEnding(localText, remoteText, baseText, local, remote, base)
      )
      conflicts.push({
        id,
        baseStartLine: start + 1,
        baseEndLine: end,
        baseText,
        localText,
        remoteText,
        markerText
      })
      merged.push(markerText)
    }

    oi = end
  }

  return {
    mergedMarkdown: merged.join(''),
    conflicts
  }
}

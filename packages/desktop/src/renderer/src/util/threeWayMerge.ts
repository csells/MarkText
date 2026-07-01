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

interface DiffHunk {
  start: number
  end: number
  lines: string[]
}

interface MergeInput {
  base: string
  local: string
  remote: string
}

type ConflictChoice = 'local' | 'remote' | 'both'

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

const diffAgainstBase = (base: string[], changed: string[]): DiffHunk[] => {
  const table = buildLcsTable(base, changed)
  const hunks: DiffHunk[] = []
  let baseIndex = 0
  let changedIndex = 0
  let current: DiffHunk | null = null

  const ensureHunk = (): DiffHunk => {
    if (!current) {
      current = {
        start: baseIndex,
        end: baseIndex,
        lines: []
      }
    }
    return current
  }

  const flush = (): void => {
    if (current) {
      hunks.push(current)
      current = null
    }
  }

  while (baseIndex < base.length || changedIndex < changed.length) {
    if (
      baseIndex < base.length &&
      changedIndex < changed.length &&
      base[baseIndex] === changed[changedIndex]
    ) {
      flush()
      baseIndex += 1
      changedIndex += 1
      continue
    }

    const hunk = ensureHunk()
    if (
      changedIndex < changed.length &&
      (baseIndex >= base.length ||
        table[baseIndex][changedIndex + 1] >= table[baseIndex + 1][changedIndex])
    ) {
      hunk.lines.push(changed[changedIndex])
      changedIndex += 1
    } else if (baseIndex < base.length) {
      hunk.end += 1
      baseIndex += 1
    }
  }

  flush()
  return hunks
}

const hunksOverlap = (left: DiffHunk, right: DiffHunk): boolean => {
  if (left.start === left.end && right.start === right.end) {
    return left.start === right.start
  }

  return left.start < right.end && right.start < left.end
}

const hunkBefore = (left: DiffHunk, right: DiffHunk): boolean => {
  if (hunksOverlap(left, right)) return false
  if (left.end < right.start) return true
  if (left.end === right.start) {
    return !(left.start === left.end && right.start === right.end)
  }
  return false
}

const applyHunksToRegion = (
  base: string[],
  hunks: DiffHunk[],
  regionStart: number,
  regionEnd: number
): string[] => {
  const result: string[] = []
  let baseIndex = regionStart

  for (const hunk of hunks) {
    if (hunk.end < regionStart || hunk.start > regionEnd) continue
    const start = Math.max(regionStart, hunk.start)
    result.push(...base.slice(baseIndex, start))
    result.push(...hunk.lines)
    baseIndex = Math.max(baseIndex, Math.min(regionEnd, hunk.end))
  }

  result.push(...base.slice(baseIndex, regionEnd))
  return result
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

  return markdown.replace(conflict.markerText, replacement)
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
  const localHunks = diffAgainstBase(baseLines, splitMarkdownLines(local))
  const remoteHunks = diffAgainstBase(baseLines, splitMarkdownLines(remote))
  const mergedLines: string[] = []
  const conflicts: ThreeWayMergeConflict[] = []
  let baseIndex = 0
  let localIndex = 0
  let remoteIndex = 0

  while (localIndex < localHunks.length || remoteIndex < remoteHunks.length) {
    const localHunk = localHunks[localIndex]
    const remoteHunk = remoteHunks[remoteIndex]

    if (!remoteHunk || (localHunk && hunkBefore(localHunk, remoteHunk))) {
      mergedLines.push(...baseLines.slice(baseIndex, localHunk.start), ...localHunk.lines)
      baseIndex = localHunk.end
      localIndex += 1
      continue
    }

    if (!localHunk || hunkBefore(remoteHunk, localHunk)) {
      mergedLines.push(...baseLines.slice(baseIndex, remoteHunk.start), ...remoteHunk.lines)
      baseIndex = remoteHunk.end
      remoteIndex += 1
      continue
    }

    let regionStart = Math.min(localHunk.start, remoteHunk.start)
    let regionEnd = Math.max(localHunk.end, remoteHunk.end)
    const localGroup: DiffHunk[] = []
    const remoteGroup: DiffHunk[] = []
    let expanded = true

    while (expanded) {
      expanded = false
      while (localIndex < localHunks.length && localHunks[localIndex].start <= regionEnd) {
        const hunk = localHunks[localIndex]
        localGroup.push(hunk)
        regionStart = Math.min(regionStart, hunk.start)
        regionEnd = Math.max(regionEnd, hunk.end)
        localIndex += 1
        expanded = true
      }
      while (remoteIndex < remoteHunks.length && remoteHunks[remoteIndex].start <= regionEnd) {
        const hunk = remoteHunks[remoteIndex]
        remoteGroup.push(hunk)
        regionStart = Math.min(regionStart, hunk.start)
        regionEnd = Math.max(regionEnd, hunk.end)
        remoteIndex += 1
        expanded = true
      }
    }

    mergedLines.push(...baseLines.slice(baseIndex, regionStart))

    const baseRegion = baseLines.slice(regionStart, regionEnd)
    const localRegion = applyHunksToRegion(baseLines, localGroup, regionStart, regionEnd)
    const remoteRegion = applyHunksToRegion(baseLines, remoteGroup, regionStart, regionEnd)

    if (sameLines(localRegion, remoteRegion)) {
      mergedLines.push(...localRegion)
    } else {
      const id = `c${conflicts.length + 1}`
      const baseText = baseRegion.join('')
      const localText = localRegion.join('')
      const remoteText = remoteRegion.join('')
      const markerText = createConflictMarker(
        id,
        baseText,
        localText,
        remoteText,
        detectLineEnding(localText, remoteText, baseText, local, remote, base)
      )
      conflicts.push({
        id,
        baseStartLine: regionStart + 1,
        baseEndLine: regionEnd,
        baseText,
        localText,
        remoteText,
        markerText
      })
      mergedLines.push(markerText)
    }

    baseIndex = regionEnd
  }

  mergedLines.push(...baseLines.slice(baseIndex))
  return {
    mergedMarkdown: mergedLines.join(''),
    conflicts
  }
}

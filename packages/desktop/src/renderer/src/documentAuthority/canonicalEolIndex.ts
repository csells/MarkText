import type CodeMirror from 'codemirror'

export type CanonicalLineEnding = '\n' | '\r\n' | '\r'

const PAGE_CAPACITY = 256
const NONE = 0
const LF = 1
const CRLF = 2
const CR = 3
type EndingCode = typeof NONE | typeof LF | typeof CRLF | typeof CR

interface Page {
  readonly kind: 'page'
  readonly contentUnits: Uint32Array
  readonly endings: Uint8Array
  readonly lineCount: number
  readonly canonicalUnits: number
  readonly pageCount: 1
  readonly height: 1
}

interface Branch {
  readonly kind: 'branch'
  readonly left: Node
  readonly right: Node
  readonly lineCount: number
  readonly canonicalUnits: number
  readonly pageCount: number
  readonly height: number
}

type Node = Page | Branch

interface LineRecord {
  readonly contentUnits: number
  readonly ending: EndingCode
}

export interface CanonicalEolIndexInspection {
  readonly buildUnits: number
  readonly nodeVisits: number
  readonly nodeAllocations: number
  readonly maximumDepth: number
  readonly currentHeight: number
  readonly currentPages: number
  readonly currentLines: number
  readonly pageRecordsScanned: number
  readonly pageRecordsCopied: number
}

export interface CanonicalEditPlan {
  readonly start: number
  readonly end: number
  readonly insert: string
}

export interface CanonicalEolIndex {
  offset(position: CodeMirror.Position): number
  position(canonicalOffset: number): CodeMirror.Position
  plan(
    from: CodeMirror.Position,
    to: CodeMirror.Position,
    text: readonly string[],
    insertedLineEnding: CanonicalLineEnding
  ): CanonicalEditPlan
  replace(
    from: CodeMirror.Position,
    to: CodeMirror.Position,
    text: readonly string[],
    insertedLineEnding: CanonicalLineEnding
  ): void
  inspection(): CanonicalEolIndexInspection
}

const endingCodeOf = (ending: CanonicalLineEnding): EndingCode => ending === '\n'
  ? LF
  : ending === '\r\n'
    ? CRLF
    : CR
const endingUnitsOf = (ending: number): number => ending === CRLF
  ? 2
  : ending === NONE
    ? 0
    : 1

export function createCanonicalEolIndex(source: string): CanonicalEolIndex {
  let buildUnits = 0
  let nodeVisits = 0
  let nodeAllocations = 0
  let maximumDepth = 0
  let pageRecordsScanned = 0
  let pageRecordsCopied = 0

  const page = (records: readonly LineRecord[]): Page => {
    if (records.length < 1 || records.length > PAGE_CAPACITY) {
      throw new Error('Canonical line page has invalid size')
    }
    const contentUnits = new Uint32Array(records.length)
    const endings = new Uint8Array(records.length)
    let canonicalUnits = 0
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      if (record === undefined) throw new Error('Canonical line record missing')
      contentUnits[index] = record.contentUnits
      endings[index] = record.ending
      canonicalUnits += record.contentUnits + endingUnitsOf(record.ending)
      pageRecordsCopied += 1
    }
    nodeAllocations += 1
    return Object.freeze({
      kind: 'page',
      contentUnits,
      endings,
      lineCount: records.length,
      canonicalUnits,
      pageCount: 1,
      height: 1
    })
  }
  const branch = (left: Node, right: Node): Branch => {
    if (Math.abs(left.height - right.height) > 1) {
      throw new Error('Canonical line index branch is not AVL balanced')
    }
    nodeAllocations += 1
    return Object.freeze({
      kind: 'branch',
      left,
      right,
      lineCount: left.lineCount + right.lineCount,
      canonicalUnits: left.canonicalUnits + right.canonicalUnits,
      pageCount: left.pageCount + right.pageCount,
      height: Math.max(left.height, right.height) + 1
    })
  }
  const balancedBranch = (left: Node, right: Node): Node => {
    if (left.height > right.height + 1) {
      if (left.kind !== 'branch') throw new Error('Invalid line-index height')
      if (left.left.height >= left.right.height) {
        return branch(left.left, branch(left.right, right))
      }
      if (left.right.kind !== 'branch') throw new Error('Invalid line rotation')
      return branch(
        branch(left.left, left.right.left),
        branch(left.right.right, right)
      )
    }
    if (right.height > left.height + 1) {
      if (right.kind !== 'branch') throw new Error('Invalid line-index height')
      if (right.right.height >= right.left.height) {
        return branch(branch(left, right.left), right.right)
      }
      if (right.left.kind !== 'branch') throw new Error('Invalid line rotation')
      return branch(
        branch(left, right.left.left),
        branch(right.left.right, right.right)
      )
    }
    return branch(left, right)
  }
  const join = (
    left: Node | undefined,
    right: Node | undefined,
    depth: number = 1
  ): Node | undefined => {
    nodeVisits += 1
    maximumDepth = Math.max(maximumDepth, depth)
    if (left === undefined) return right
    if (right === undefined) return left
    if (left.kind === 'page' && right.kind === 'page' &&
      left.lineCount + right.lineCount <= PAGE_CAPACITY) {
      return page([
        ...recordsOfPage(left, 0, left.lineCount),
        ...recordsOfPage(right, 0, right.lineCount)
      ])
    }
    if (left.height > right.height + 1) {
      if (left.kind !== 'branch') throw new Error('Invalid line-index join')
      const joined = join(left.right, right, depth + 1)
      if (joined === undefined) throw new Error('Line-index join lost content')
      return balancedBranch(left.left, joined)
    }
    if (right.height > left.height + 1) {
      if (right.kind !== 'branch') throw new Error('Invalid line-index join')
      const joined = join(left, right.left, depth + 1)
      if (joined === undefined) throw new Error('Line-index join lost content')
      return balancedBranch(joined, right.right)
    }
    return branch(left, right)
  }
  const recordsOfPage = (node: Page, start: number, end: number): LineRecord[] => {
    const records: LineRecord[] = []
    for (let index = start; index < end; index += 1) {
      records.push({
        contentUnits: node.contentUnits[index] ?? 0,
        ending: (node.endings[index] ?? NONE) as EndingCode
      })
      pageRecordsScanned += 1
    }
    return records
  }
  const split = (
    node: Node | undefined,
    lineCount: number,
    depth: number = 1
  ): readonly [Node | undefined, Node | undefined] => {
    if (node === undefined) return [undefined, undefined]
    nodeVisits += 1
    maximumDepth = Math.max(maximumDepth, depth)
    if (lineCount === 0) return [undefined, node]
    if (lineCount === node.lineCount) return [node, undefined]
    if (node.kind === 'page') {
      return [
        page(recordsOfPage(node, 0, lineCount)),
        page(recordsOfPage(node, lineCount, node.lineCount))
      ]
    }
    if (lineCount < node.left.lineCount) {
      const [prefix, remainder] = split(node.left, lineCount, depth + 1)
      return [prefix, join(remainder, node.right)]
    }
    const [prefix, suffix] = split(
      node.right,
      lineCount - node.left.lineCount,
      depth + 1
    )
    return [join(node.left, prefix), suffix]
  }
  const build = (records: readonly LineRecord[]): Node | undefined => {
    const pages: Node[] = []
    const pageCount = Math.ceil(records.length / PAGE_CAPACITY)
    const baseSize = Math.floor(records.length / pageCount)
    let remainder = records.length % pageCount
    let start = 0
    while (start < records.length) {
      const size = baseSize + (remainder > 0 ? 1 : 0)
      remainder -= remainder > 0 ? 1 : 0
      pages.push(page(records.slice(start, start + size)))
      start += size
    }
    const level = (start: number, end: number): Node | undefined => {
      if (start === end) return undefined
      if (end - start === 1) return pages[start]
      const middle = start + Math.floor((end - start) / 2)
      const left = level(start, middle)
      const right = level(middle, end)
      if (left === undefined) return right
      if (right === undefined) return left
      return branch(left, right)
    }
    return level(0, pages.length)
  }
  const records: LineRecord[] = []
  let contentUnits = 0
  for (let index = 0; index < source.length; index += 1) {
    buildUnits += 1
    const unit = source.charCodeAt(index)
    if (unit === 13 && source.charCodeAt(index + 1) === 10) {
      records.push({ contentUnits, ending: CRLF })
      contentUnits = 0
      index += 1
      buildUnits += 1
    } else if (unit === 13) {
      records.push({ contentUnits, ending: CR })
      contentUnits = 0
    } else if (unit === 10) {
      records.push({ contentUnits, ending: LF })
      contentUnits = 0
    } else {
      contentUnits += 1
    }
  }
  records.push({ contentUnits, ending: NONE })
  let root = build(records)

  const locate = (line: number): Readonly<{
    readonly record: LineRecord
    readonly unitsBefore: number
  }> => {
    if (!Number.isSafeInteger(line) || line < 0 || line >= (root?.lineCount ?? 0)) {
      throw new RangeError('Canonical line is out of range')
    }
    let current = root
    let remaining = line
    let unitsBefore = 0
    let depth = 1
    while (current !== undefined) {
      nodeVisits += 1
      maximumDepth = Math.max(maximumDepth, depth)
      if (current.kind === 'page') {
        for (let index = 0; index < remaining; index += 1) {
          pageRecordsScanned += 1
          unitsBefore += (current.contentUnits[index] ?? 0) +
            endingUnitsOf(current.endings[index] ?? NONE)
        }
        pageRecordsScanned += 1
        return Object.freeze({
          unitsBefore,
          record: Object.freeze({
            contentUnits: current.contentUnits[remaining] ?? 0,
            ending: (current.endings[remaining] ?? NONE) as EndingCode
          })
        })
      }
      if (remaining < current.left.lineCount) {
        current = current.left
      } else {
        remaining -= current.left.lineCount
        unitsBefore += current.left.canonicalUnits
        current = current.right
      }
      depth += 1
    }
    throw new Error('Canonical line lookup lost root')
  }

  const updateSingleLine = (
    node: Node,
    line: number,
    fromCh: number,
    toCh: number,
    insertedUnits: number,
    depth: number = 1
  ): Node => {
    nodeVisits += 1
    maximumDepth = Math.max(maximumDepth, depth)
    if (node.kind === 'page') {
      const content = node.contentUnits[line]
      if (content === undefined || fromCh > content || toCh > content) {
        throw new RangeError('Canonical line replacement is out of range')
      }
      const records = recordsOfPage(node, 0, node.lineCount)
      const record = records[line]
      if (record === undefined) throw new Error('Canonical line update missing')
      records[line] = {
        contentUnits: fromCh + insertedUnits + content - toCh,
        ending: record.ending
      }
      return page(records)
    }
    if (line < node.left.lineCount) {
      return branch(
        updateSingleLine(
          node.left,
          line,
          fromCh,
          toCh,
          insertedUnits,
          depth + 1
        ),
        node.right
      )
    }
    return branch(
      node.left,
      updateSingleLine(
        node.right,
        line - node.left.lineCount,
        fromCh,
        toCh,
        insertedUnits,
        depth + 1
      )
    )
  }

  const replaceWithinPage = (
    node: Node,
    startLine: number,
    removedLines: number,
    replacement: readonly LineRecord[],
    depth: number = 1
  ): Node | undefined => {
    nodeVisits += 1
    maximumDepth = Math.max(maximumDepth, depth)
    if (node.kind === 'page') {
      const records = recordsOfPage(node, 0, startLine)
      records.push(...replacement)
      records.push(...recordsOfPage(
        node,
        startLine + removedLines,
        node.lineCount
      ))
      return records.length <= PAGE_CAPACITY ? page(records) : build(records)
    }
    if (startLine + removedLines <= node.left.lineCount) {
      const replaced = replaceWithinPage(
        node.left,
        startLine,
        removedLines,
        replacement,
        depth + 1
      )
      return replaced === undefined ? undefined : join(replaced, node.right)
    }
    if (startLine >= node.left.lineCount) {
      const replaced = replaceWithinPage(
        node.right,
        startLine - node.left.lineCount,
        removedLines,
        replacement,
        depth + 1
      )
      return replaced === undefined ? undefined : join(node.left, replaced)
    }
    return undefined
  }

  return Object.freeze({
    offset(position: CodeMirror.Position): number {
      const located = locate(position.line)
      if (
        !Number.isSafeInteger(position.ch) || position.ch < 0 ||
        position.ch > located.record.contentUnits
      ) {
        throw new RangeError('Canonical line character is out of range')
      }
      return located.unitsBefore + position.ch
    },
    position(canonicalOffset: number): CodeMirror.Position {
      if (
        !Number.isSafeInteger(canonicalOffset) || canonicalOffset < 0 ||
        canonicalOffset > (root?.canonicalUnits ?? 0)
      ) {
        throw new RangeError('Canonical source offset is out of range')
      }
      let current = root
      let remaining = canonicalOffset
      let line = 0
      let depth = 1
      while (current !== undefined) {
        nodeVisits += 1
        maximumDepth = Math.max(maximumDepth, depth)
        if (current.kind === 'branch') {
          if (remaining < current.left.canonicalUnits) {
            current = current.left
          } else {
            remaining -= current.left.canonicalUnits
            line += current.left.lineCount
            current = current.right
          }
          depth += 1
          continue
        }
        for (let index = 0; index < current.lineCount; index += 1) {
          pageRecordsScanned += 1
          const contentUnits = current.contentUnits[index] ?? 0
          const endingUnits = endingUnitsOf(current.endings[index] ?? NONE)
          if (remaining <= contentUnits) {
            return Object.freeze({ line: line + index, ch: remaining })
          }
          if (remaining < contentUnits + endingUnits) {
            throw new RangeError(
              'Canonical source offset splits a normalized line ending'
            )
          }
          remaining -= contentUnits + endingUnits
        }
        if (remaining === 0) {
          const lastLine = line + current.lineCount - 1
          return Object.freeze({
            line: lastLine,
            ch: current.contentUnits[current.lineCount - 1] ?? 0
          })
        }
        break
      }
      throw new RangeError('Canonical source offset is out of range')
    },
    plan(
      from: CodeMirror.Position,
      to: CodeMirror.Position,
      text: readonly string[],
      insertedLineEnding: CanonicalLineEnding
    ): CanonicalEditPlan {
      const startLine = locate(from.line)
      const endLine = locate(to.line)
      let start = startLine.unitsBefore + from.ch
      let end = endLine.unitsBefore + to.ch
      let insert = text.join(insertedLineEnding)
      const prefixEnding = from.ch === 0 && from.line > 0
        ? locate(from.line - 1).record.ending
        : NONE
      const suffixEnding = to.ch === endLine.record.contentUnits
        ? endLine.record.ending
        : NONE
      const insertBeginsLf = insert.startsWith('\n') ||
        (insert.length === 0 && suffixEnding === LF)
      const insertEndsCr = insert.endsWith('\r') ||
        (insert.length === 0 && prefixEnding === CR)
      if (insertBeginsLf && prefixEnding === CR) {
        start -= 1
        insert = `\n${insert}`
      }
      if (insertEndsCr && suffixEnding === LF) {
        end += 1
        insert += '\r'
      }
      return Object.freeze({ start, end, insert })
    },
    replace(
      from: CodeMirror.Position,
      to: CodeMirror.Position,
      text: readonly string[],
      insertedLineEnding: CanonicalLineEnding
    ): void {
      if (from.line === to.line && text.length === 1) {
        if (root === undefined) throw new Error('Canonical line index is empty')
        root = updateSingleLine(
          root,
          from.line,
          from.ch,
          to.ch,
          text[0]?.length ?? 0
        )
        return
      }
      const start = locate(from.line).record
      const end = locate(to.line).record
      if (from.ch > start.contentUnits || to.ch > end.contentUnits) {
        throw new RangeError('Canonical line replacement is out of range')
      }
      const insertedEnding = endingCodeOf(insertedLineEnding)
      const replacement: LineRecord[] = []
      if (text.length === 1) {
        replacement.push({
          contentUnits: from.ch + (text[0]?.length ?? 0) +
            end.contentUnits - to.ch,
          ending: end.ending
        })
      } else {
        replacement.push({
          contentUnits: from.ch + (text[0]?.length ?? 0),
          ending: insertedEnding
        })
        for (let index = 1; index < text.length - 1; index += 1) {
          replacement.push({
            contentUnits: text[index]?.length ?? 0,
            ending: insertedEnding
          })
        }
        replacement.push({
          contentUnits: (text[text.length - 1]?.length ?? 0) +
            end.contentUnits - to.ch,
          ending: end.ending
        })
      }
      const localReplacement = replaceWithinPage(
        root as Node,
        from.line,
        to.line - from.line + 1,
        replacement
      )
      if (localReplacement !== undefined) {
        root = localReplacement
        return
      }
      const [prefix, remainder] = split(root, from.line)
      const [, suffix] = split(remainder, to.line - from.line + 1)
      root = join(join(prefix, build(replacement)), suffix)
    },
    inspection(): CanonicalEolIndexInspection {
      return Object.freeze({
        buildUnits,
        nodeVisits,
        nodeAllocations,
        maximumDepth,
        currentHeight: root?.height ?? 0,
        currentPages: root?.pageCount ?? 0,
        currentLines: root?.lineCount ?? 0,
        pageRecordsScanned,
        pageRecordsCopied
      })
    }
  })
}

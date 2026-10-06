import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction, type MarkdownAstNode } from '../src/index.js'

// Upstream MarkText #5597 reads a GFM task item in an ordered list as a task,
// as it reads one in a bullet list. These cases follow upstream's own
// orderedTaskList.spec.ts and convertToOrderedTaskList.spec.ts.

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
const caret = (at: number) => ({ ranges: [{ anchor: at, focus: at }], primary: 0 })

const firstList = (source: string): MarkdownAstNode => {
  const core = createDocumentCore()
  const list = core.project(core.open(source), 'markup').syntax.ast.root.children[0]
  if (list?.kind !== 'list') throw new Error('Expected a list')
  return list
}

const apply = (source: string, action: DocumentInputAction): { source: string, caret: number } => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  if (edits === undefined) throw new Error('Expected untracked edits')
  const commit = core.apply(previous, edits)
  const selection = core.reconcileInput(previous, plan, commit, action).selection
  if (selection === undefined || !('ranges' in selection)) throw new Error('Expected a text selection')
  return { source: commit.revision.source, caret: selection.ranges[selection.primary]?.anchor ?? -1 }
}

describe('ordered task lists (upstream #5597)', () => {
  it('reads `1. [x] …` as an ordered list of checked and unchecked tasks', () => {
    const list = firstList('1. [x] Open\n2. [ ] Close\n')
    expect(list.attributes).toMatchObject({ ordered: true, taskList: true, start: 1, delimiter: '.' })
    expect(list.children.map(item => [item.attributes.task, item.attributes.checked])).toEqual([[true, true], [true, false]])
  })

  it('keeps the start number and the delimiter', () => {
    expect(firstList('5. [x] a\n6. [ ] b\n').attributes).toMatchObject({ ordered: true, taskList: true, start: 5 })
    expect(firstList('1) [x] a\n2) [ ] b\n').attributes).toMatchObject({ ordered: true, taskList: true, delimiter: ')' })
  })

  it('reads an ordered item holding only its task marker as an empty task', () => {
    const list = firstList('1. [ ] \n2. [ ] \n')
    expect(list.children.map(item => item.attributes.task)).toEqual([true, true])
    for (const item of list.children) {
      const paragraph = item.children[0]
      expect(paragraph?.kind).toBe('paragraph')
      expect(paragraph?.range.start).toBe(paragraph?.range.end)
    }
  })

  it('continues an ordered task item with the next number and an unchecked task on Enter', () => {
    const source = '1. [x] aaa\n'
    const at = source.indexOf('\n')
    expect(apply(source, { selection: caret(at), range: { start: at, end: at }, inputType: 'insertParagraph', data: null, options }))
      .toEqual({ source: '1. [x] aaa\n2. [ ] \n', caret: '1. [x] aaa\n2. [ ] '.length })
  })

  it('keeps an ordered task list in its source order when a task is checked', () => {
    const source = '1. [ ] a\n2. [ ] b\n'
    const at = source.indexOf('a')
    const action = { kind: 'command', command: 'setTaskChecked', checked: true, autoCheck: false, autoMoveCheckedToEnd: true, selection: caret(at), options } as unknown as DocumentInputAction
    expect(apply(source, action).source).toBe('1. [x] a\n2. [ ] b\n')
  })
})

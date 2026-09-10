import { taskCheckedChanges, taskListOrder } from '@marktext/input-policy'
import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax } from './documentCore.js'
import { positionAfter } from './sourcePosition.js'
import { listItemGroups } from './documentListGroups.js'
import { markupReplacementRange } from './markupEditOwnership.js'

/** Checkbox targets and marker intervals belong to the current parser tree. */
export function planTaskChecked(core: DocumentCore, revision: DocumentRevision, syntax: MarkupSyntax, ancestors: readonly MarkdownAstNode[], position: number, checked: boolean, autoCheck: boolean, autoMoveCheckedToEnd: boolean) {
  const target = [...ancestors].reverse().find(node => node.kind === 'list-item' && node.attributes.task === true)
  if (target === undefined) throw new RangeError('Checkbox action requires a task item')
  const parents = new Map<MarkdownAstNode, MarkdownAstNode>()
  const visit = (node: MarkdownAstNode): void => {
    for (const child of node.children) { parents.set(child, node); visit(child) }
  }
  visit(syntax.ast.root)
  const taskGroups = (node: MarkdownAstNode | undefined) => listItemGroups(node).filter(group => group[0]?.attributes.task === true)
  const siblings = (node: MarkdownAstNode) => taskGroups(parents.get(node)).find(group => group.includes(node)) ?? []
  const changes = taskCheckedChanges(target, checked, autoCheck, {
    checked: node => node.attributes.checked === true,
    children: node => taskGroups([...node.children].reverse().find(child => child.kind === 'list' && child.children.some(item => item.attributes.task === true))).at(-1) ?? [],
    siblings,
    parent: node => {
      const parent = parents.get(parents.get(node)!)
      return parent?.kind === 'list-item' && parent.attributes.task === true ? parent : undefined
    }
  })
  const edits: DocumentSourceEdit[] = []
  for (const [node, value] of changes) {
    const start = node.attributes.taskStateStart
    const end = node.attributes.taskStateEnd
    if (typeof start !== 'number' || typeof end !== 'number') throw new RangeError('Task item has no owned checkbox state')
    edits.push({ start: syntax.coordinates.toSource(start, 'next'), end: syntax.coordinates.toSource(end, 'previous'), insert: value ? 'x' : ' ' })
  }
  edits.sort((left, right) => left.start - right.start)
  const list = parents.get(target)
  if (autoMoveCheckedToEnd && list?.kind === 'list') {
    const group = siblings(target)
    const ordered = taskListOrder(group, node => changes.get(node) ?? node.attributes.checked === true)
    if (ordered.some((node, index) => node !== group[index])) {
      const slots = group.map(node => {
        const range = markupReplacementRange(core, revision, {
          start: syntax.coordinates.toSource(node.range.start, 'next'),
          end: syntax.coordinates.toSource(node.range.end, 'next'),
          insert: ''
        }, 'structure')
        if (range === undefined) throw new RangeError('Moved task has no owned source interval')
        return { node, range }
      })
      const slotByNode = new Map(slots.map(slot => [slot.node, slot]))
      let caret = position
      const moved: DocumentSourceEdit[] = []
      for (const [index, node] of ordered.entries()) {
        const from = slotByNode.get(node)!
        const to = slots[index]!
        let insert = core.sourceSlice(revision, from.range)
        const local = edits.filter(edit => from.range.start <= edit.start && edit.end <= from.range.end)
        for (const edit of [...local].reverse()) insert = insert.slice(0, edit.start - from.range.start) + edit.insert + insert.slice(edit.end - from.range.start)
        if (node === target) caret = to.range.start + positionAfter(local, position, false) - from.range.start
        if (core.sourceSlice(revision, to.range) !== insert) moved.push({ ...to.range, insert })
      }
      const destination = slots[ordered.indexOf(target)]!
      caret += moved.filter(edit => edit.start < destination.range.start).reduce((delta, edit) => delta + edit.insert.length - edit.end + edit.start, 0)
      const external = edits.filter(edit => !slots.some(slot => slot.range.start <= edit.start && edit.end <= slot.range.end))
      const result = [...external, ...moved].sort((left, right) => left.start - right.start)
      caret += external.filter(edit => edit.end <= destination.range.start).reduce((delta, edit) => delta + edit.insert.length - edit.end + edit.start, 0)
      return { edits: result, selection: { start: caret, end: caret } }
    }
  }
  const caret = positionAfter(edits, position, false)
  return { edits, selection: { start: caret, end: caret } }
}

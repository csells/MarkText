import type { MarkdownAstNode } from './documentCore.js'

/** Native list widgets group adjacent task items separately from ordinary items. */
export function listItemGroups(list: MarkdownAstNode | undefined): readonly (readonly MarkdownAstNode[])[] {
  const groups: MarkdownAstNode[][] = []
  if (list?.kind !== 'list') return groups
  for (const item of list.children) {
    let group = groups.at(-1)
    if (group === undefined || (group[0]?.attributes.task === true) !== (item.attributes.task === true)) {
      group = []
      groups.push(group)
    }
    group.push(item)
  }
  return groups
}

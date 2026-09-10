export interface TaskTree<Item> {
  checked: (item: Item) => boolean
  children: (item: Item) => readonly Item[]
  siblings: (item: Item) => readonly Item[]
  parent: (item: Item) => Item | undefined
}

/** Checked tasks follow unchecked tasks; each group's relative order survives. */
export function taskListOrder<Item>(items: readonly Item[], checked: (item: Item) => boolean): readonly Item[] {
  const pending: Item[] = []
  const complete: Item[] = []
  for (const item of items) (checked(item) ? complete : pending).push(item)
  return [...pending, ...complete]
}

/** Native task toggles cascade down, then derive ancestors until one is unchanged. */
export function taskCheckedChanges<Item>(item: Item, checked: boolean, autoCheck: boolean, tree: TaskTree<Item>): ReadonlyMap<Item, boolean> {
  const changes = new Map<Item, boolean>()
  const current = (node: Item) => changes.get(node) ?? tree.checked(node)
  const set = (node: Item, value: boolean) => { if (current(node) !== value) changes.set(node, value) }
  set(item, checked)
  if (autoCheck) {
    const descend = (node: Item): void => {
      for (const child of tree.children(node)) { set(child, checked); descend(child) }
    }
    descend(item)
    let child = item
    for (let parent = tree.parent(child); parent !== undefined; parent = tree.parent(child)) {
      const computed = tree.siblings(child).every(current)
      if (current(parent) === computed) break
      set(parent, computed)
      child = parent
    }
  }
  return changes
}

export interface KeyedTocNode {
  key: string
  label: unknown
  nodeId: string
  children: KeyedTocNode[]
}

interface TocLike {
  label?: unknown
  nodeId?: unknown
  children?: TocLike[]
}

// Parser NodeId is both the tree key and the click-to-scroll payload. It is
// already unique within the document, so the sidebar does not manufacture a
// second identity from heading text or document order.
export function deriveKeyedToc(nodes: TocLike[]): KeyedTocNode[] {
  const assign = (list: TocLike[]): KeyedTocNode[] =>
    list.map((node) => {
      if (typeof node.nodeId !== 'string' || node.nodeId.length === 0) {
        throw new TypeError('TOC node requires a parser NodeId')
      }
      return {
        key: node.nodeId,
        label: node.label,
        nodeId: node.nodeId,
        children: assign(node.children ?? [])
      }
    })
  return assign(nodes)
}

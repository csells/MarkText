// Cursor-based tree assertions. The adversarial review showed that
// `/Outer\(.*Inner.*\)/` regexes over tree.toString() are sibling-blind
// (`.*` spans closing parens), so containment must be checked on ranges.

export function nodes (parser, doc) {
  const out = []
  const cursor = parser.parse(doc).cursor()
  do {
    out.push({ name: cursor.name, from: cursor.from, to: cursor.to })
  } while (cursor.next())
  return out
}

export function find (parser, doc, name) {
  return nodes(parser, doc).filter((n) => n.name === name)
}

// True when some `inner` node lies strictly within some `outer` node's range.
export function contains (parser, doc, outerName, innerName) {
  const all = nodes(parser, doc)
  const outers = all.filter((n) => n.name === outerName)
  const inners = all.filter((n) => n.name === innerName)
  return outers.some((o) =>
    inners.some((i) => i.from >= o.from && i.to <= o.to && !(i.from === o.from && i.to === o.to))
  )
}

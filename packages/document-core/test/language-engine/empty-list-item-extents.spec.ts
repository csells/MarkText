import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

const CONFIGURATION: ParseConfiguration = Object.freeze({
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: Object.freeze({
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  }),
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: Object.freeze({
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  })
})

interface Extent {
  readonly kind: string
  readonly start: number
  readonly end: number
  readonly children: readonly Extent[]
}

const extents = (source: string): Extent => {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete revision')
  }
  const read = (node: {
    kind: string
    range: { start: number; end: number }
    childCount: number
    childAt: (ordinal: number) => never
  }): Extent => Object.freeze({
    kind: node.kind,
    start: node.range.start,
    end: node.range.end,
    children: Object.freeze(
      Array.from({ length: node.childCount }, (_, ordinal) =>
        read(node.childAt(ordinal)))
    )
  })
  return read(revision.projection('editing').markdown.root as never)
}

// Every child must lie inside its parent and follow its previous sibling: the
// live-plan wire decoder rejects a violation outright ('child topology is
// outside or unordered in its parent'), which surfaced as a wall of renderer
// errors while backspacing a list down to a single empty item.
const assertWellFormed = (node: Extent, parent?: Extent): void => {
  if (parent !== undefined) {
    expect(
      node.start >= parent.start && node.end <= parent.end,
      `${node.kind}[${node.start},${node.end}] escapes ` +
      `${parent.kind}[${parent.start},${parent.end}]`
    ).toBe(true)
  }
  let previousEnd = -1
  for (const child of node.children) {
    expect(
      child.start >= previousEnd,
      `${child.kind}[${child.start},${child.end}] precedes its sibling`
    ).toBe(true)
    previousEnd = child.end
    assertWellFormed(child, node)
  }
}

describe('container extents cover markers opened on their line', () => {
  it.each([
    { name: 'a trailing empty item', source: '- one\n- \n' },
    { name: 'only an empty item', source: '- \n' },
    { name: 'an empty item after two', source: '- one\n- two\n- \n' },
    { name: 'a nested empty item', source: '- one\n  - \n' },
    { name: 'an ordered trailing empty item', source: '1. one\n2. \n' },
    { name: 'a blockquote opened in a list', source: '- one\n- > quoted\n' },
    { name: 'an empty item between two', source: '- one\n- \n- three\n' }
  ])('keeps the plan well formed with $name', ({ source }) => {
    assertWellFormed(extents(source))
  })

  it('contains the empty item inside its list', () => {
    const root = extents('- one\n- \n')
    const list = root.children.find(child => child.kind === 'list')
    if (list === undefined) throw new Error('Expected a list')
    const items = list.children.filter(child => child.kind === 'list-item')
    expect(items).toHaveLength(2)
    const last = items[1]!
    expect(last.end).toBeLessThanOrEqual(list.end)
    expect(last.start).toBeGreaterThanOrEqual(list.start)
  })
})

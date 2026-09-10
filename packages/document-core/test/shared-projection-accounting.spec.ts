import { expect, it } from 'vitest'
import { parseProfile1Document } from '../src/internal/profile1Document.js'

it.each([
  { source: 'x', tape: 1, markdown: 4 },
  { source: 'x\n', tape: 2, markdown: 4 },
  { source: 'x\n\n', tape: 3, markdown: 6 }
])('accounts shared projection storage once and distinct editing nodes individually: $source', ({ source, tape, markdown }) => {
  const parsed = parseProfile1Document(source, {
    limitsProfile: 'desktop-v1', accountingSchema: 'syntax-accounting-1'
  }, undefined, undefined, true)
  if (parsed.kind !== 'complete') throw new Error('Expected complete small-document parse')
  // Plain text owns its canonical root, projected root, paragraph and text.
  // An editable trailing blank adds a paragraph and a distinct document root,
  // while reader/editing views still retain the same projection segments.
  expect(parsed.accountingCounts).toEqual([tape, markdown, 0, 0, 0, tape])
  const segments = parsed.accountingTrace?.events.filter(event => event.kind === 'ProjectionSegment')
  expect(segments).toHaveLength(tape)
  expect(parsed.editing().markdown.root.childCount).toBe(markdown === 6 ? 2 : 1)
  expect(parsed.original.markdown.root.childCount).toBe(1)
})

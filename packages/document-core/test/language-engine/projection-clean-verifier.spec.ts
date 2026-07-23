import { describe, expect, it } from 'vitest'
import {
  parseMarkdownDocument
} from '../../src/internal/profile1/markdownParser.js'
import {
  verifyCleanProjectedMarkdownV1
} from '../../src/internal/profile1Document.js'

describe('Profile 1 clean projection verifier', () => {
  it('rejects a clean Markdown tree that differs from retained arm meaning', () => {
    const source = '`a`'
    const retained = parseMarkdownDocument({
      source,
      matchingScopes: [{ id: 1, start: 0, end: 1, depth: 0 }]
    }).document
    const clean = parseMarkdownDocument({ source }).document

    expect(retained.root.childAt(0).childAt(0).kind).toBe('text')
    expect(clean.root.childAt(0).childAt(0).kind).toBe('inline-code')
    expect(() => verifyCleanProjectedMarkdownV1(retained, clean))
      .toThrow(/clean projection Markdown mismatch/i)
  })
})

import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPOSITORY_ROOT = resolve(__dirname, '../../../..')
const PACKAGE_SOURCE = 'packages/document-core/src'

const trackedSourceFiles = (): readonly string[] =>
  execFileSync('git', ['ls-files', '-z', PACKAGE_SOURCE], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8'
  })
    .split('\0')
    .filter(path => path.endsWith('.ts'))

const definitionsOf = (symbol: string): readonly string[] =>
  trackedSourceFiles().filter((path) => {
    const text = readFileSync(resolve(REPOSITORY_ROOT, path), 'utf8')
    return (
      text.includes(`function ${symbol}(`) ||
      text.includes(`const ${symbol} = `)
    )
  })

// G3: the escape rule decides which bytes MarkText writes on the user's behalf,
// and ADR-0015 makes that a narrow, auditable authority. Two copies cannot both
// be it — they already disagreed on which closers they accept, so a payload
// containing a Comment closer was escapable in one module and unrepresentable
// in the other. One definition per symbol keeps that decision reviewable in a
// single place.
describe('source authorship has one implementation', () => {
  it.each([
    'escapeCriticPayload',
    'CRITIC_OPENERS'
  ])('defines %s exactly once across document-core', (symbol) => {
    expect(definitionsOf(symbol)).toHaveLength(1)
  })

  it('defines one opaque-range merge rather than one per caller', () => {
    const merges = trackedSourceFiles().filter((path) => {
      const text = readFileSync(resolve(REPOSITORY_ROOT, path), 'utf8')
      return /function merge(?:OpaqueRanges|TextRanges)\(/u.test(text)
    })
    expect(merges).toHaveLength(1)
  })
})

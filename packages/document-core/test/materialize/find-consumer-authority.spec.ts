import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findConsumerMatches } from '@marktext/document-core'

const PACKAGE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..'
)

// G19: the consumer policy declares the find projection; production only
// routes. A direct call to the projection-specific matchers outside the
// policy and the search module itself is a second answer to the declared
// question.
describe('find consumer has one declared authority', () => {
  it('routes every production match discovery through the policy', () => {
    const tracked = execFileSync('git', ['ls-files', '-z', 'src'], {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8'
    })
      .split('\0')
      .filter(path => path.endsWith('.ts'))
    const offenders: string[] = []
    for (const path of tracked) {
      if (
        path.endsWith('src/search.ts') ||
        path.endsWith('materialize/consumerPolicy.ts')
      ) {
        continue
      }
      const text = readFileSync(resolve(PACKAGE_ROOT, path), 'utf8')
      for (const matcher of [
        'findMarkupSearchMatches(',
        'findSearchMatches('
      ]) {
        if (text.includes(matcher)) {
          offenders.push(`${path}: ${matcher}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('declares the exact raw source for a SourceOnly revision', () => {
    // The source-only branch matches raw syntax the markup projection
    // hides — the declaration, not the caller, decides that. The
    // complete-revision branch's visible-projection semantics are pinned
    // by the replace suite's match-discovery rows.
    const query = Object.freeze({
      schema: 'document-search-query-1' as const,
      text: '{==seen==}',
      syntax: 'literal' as const,
      caseSensitive: true,
      wholeWord: false
    })
    const matches = findConsumerMatches(
      Object.freeze({
        kind: 'source-only' as const,
        source: 'A {==seen==}{>>unseen note<<} tail.\n'
      }),
      query
    )
    expect(matches.length).toBe(1)
  })
})

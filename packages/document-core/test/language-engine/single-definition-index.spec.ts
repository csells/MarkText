import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'
import {
  __referenceDefinitionIndexBuildsV1,
  __resetReferenceDefinitionIndexBuildsV1
} from '../../src/internal/profile1/markdownLaneState.js'

/**
 * Reference definitions are staged as canonical facts during the intrinsic
 * source progression. Fork-AST selections filter and resolve those shared
 * facts by canonical identity; they never build an index from projected text.
 */

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: {
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

function indexBuildsFor(source: string): number {
  __resetReferenceDefinitionIndexBuildsV1()
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  expect(revision.kind).toBe('complete')
  return __referenceDefinitionIndexBuildsV1()
}

describe('canonical reference-definition facts', () => {
  it('builds no projected-text index when there are no definitions', () => {
    expect(indexBuildsFor('# Title\n\nHello *world*.\n')).toBe(0)
  })

  it('stages later definitions without a projected-text index', () => {
    expect(indexBuildsFor('[a]: /x\n\nSee [a].\n')).toBe(0)
  })

  it('preserves reference-link resolution from canonical facts', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('[a]: /x\n\nSee [a].\n'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }
    const revised = revision.projection('revised')
    expect(revised.source).toBe('[a]: /x\n\nSee [a].\n')
    expect(revised.markdown.root.childCount).toBeGreaterThan(0)
  })
})

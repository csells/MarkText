import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type LanguageEngine,
  type ParseConfiguration
} from '@marktext/document-core'

const CONFIGURATION: ParseConfiguration = {
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

describe('LanguageEngine interface completeness', () => {
  // A capability reached through an instance-keyed side channel is invisible
  // to module-graph analysis, which is how single syntax-decision ownership
  // must be derived. Everything a caller may reach is an interface member.
  it('declares every capability a caller may reach', () => {
    const engine: LanguageEngine = createLanguageEngine()

    expect(typeof engine.open).toBe('function')
    expect(typeof engine.reopen).toBe('function')
    expect(typeof engine.inspectChangedCriticMarkerJoins).toBe('function')
    expect(typeof engine.nextExecutionStage).toBe('function')
  })

  it('inspects changed CriticMarkup joins through the declared member', () => {
    const engine = createLanguageEngine()
    const inspection = engine.inspectChangedCriticMarkerJoins(
      createSourceSnapshot('a{++new++}b'),
      CONFIGURATION,
      [1]
    )

    expect(inspection.kind).toBe('inspected')
  })
})

import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

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
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

describe('DocumentSession open defaults', () => {
  // Every field with exactly one legal value today defaults; a host states
  // only what genuinely varies (source and parse profile). Before this,
  // every adapter restated the identical four-field incantation.
  it('opens a markup session from source and parse configuration alone', async() => {
    const session = await createDocumentSession({
      source: createSourceSnapshot('# Title\n\nHello {++world++}.\n'),
      parseConfiguration: TEST_CONFIGURATION
    })

    const snapshot = session.snapshot()
    expect(snapshot.kind).toBe('complete')
    expect(snapshot.configuration.authoringTextPolicy).toBe(
      'nearest-owner-eol-v1'
    )
    const selection = snapshot.revision.selection
    if (selection === null) {
      throw new Error('Expected the default zero-caret selection')
    }
    expect(selection.anchor).toMatchObject({ offset: 0 })
    expect(selection.focus).toMatchObject({ offset: 0 })
    expect(selection.view).toBe('markup')
  })

  it('still honors explicit options when a host states them', async() => {
    const session = await createDocumentSession({
      source: createSourceSnapshot('abc\n'),
      parseConfiguration: TEST_CONFIGURATION,
      initialSelection: {
        anchor: { offset: 2, affinity: 'next' },
        focus: { offset: 2, affinity: 'next' }
      }
    })

    const selection = session.snapshot().revision.selection
    if (selection === null) {
      throw new Error('Expected the explicit selection')
    }
    expect(selection.anchor.offset).toBe(2)
  })
})

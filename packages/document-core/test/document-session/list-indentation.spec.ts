import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type DocumentSession,
  type InitialModelSelection,
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
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

function selection(start: number): InitialModelSelection {
  return Object.freeze({
    anchor: Object.freeze({ offset: start, affinity: 'next' as const }),
    focus: Object.freeze({ offset: start, affinity: 'next' as const })
  })
}

async function open(source: string, at: number): Promise<DocumentSession> {
  return createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: TEST_CONFIGURATION,
    initialSelection: selection(at)
  })
}

async function indent(
  source: string,
  at: number,
  direction: 'increase' | 'decrease'
): Promise<Readonly<{ kind: string; source: string }>> {
  const session = await open(source, at)
  const target = session.snapshot().revision.selection
  if (target === null) {
    throw new Error('Expected an editable selection')
  }
  const result = await session.dispatch({
    kind: 'set-list-indentation',
    target,
    direction
  }).completion
  const snapshot = session.snapshot()
  if (snapshot.kind !== 'complete') {
    throw new Error('Expected a complete snapshot')
  }
  return Object.freeze({
    kind: result.kind,
    source: snapshot.revision.source
  })
}

// G40: the nesting step is the preceding sibling's emitted marker-segment
// width, and sibling/ancestor come from the emitted tree — no expression
// scans source lines for markers.
describe('list indentation over emitted structure', () => {
  it('nests under an unordered sibling by its marker width', async() => {
    const source = '- one\n- two\n'
    const result = await indent(source, source.indexOf('two'), 'increase')
    expect(result.kind).toBe('committed')
    expect(result.source).toBe('- one\n  - two\n')
  })

  it('nests under an ordered sibling by three and renumbers to 1', async() => {
    const source = '1. one\n2. two\n'
    const result = await indent(source, source.indexOf('two'), 'increase')
    expect(result.kind).toBe('committed')
    expect(result.source).toBe('1. one\n   1. two\n')
  })

  it('refuses to nest the first item of a list', async() => {
    const source = '- one\n- two\n'
    const result = await indent(source, source.indexOf('one'), 'increase')
    expect(result.kind).toBe('rejected')
    expect(result.source).toBe(source)
  })

  it('outdents a nested item by its ancestor marker width', async() => {
    const source = '1. one\n   - two\n'
    const result = await indent(source, source.indexOf('two'), 'decrease')
    expect(result.kind).toBe('committed')
    expect(result.source).toBe('1. one\n- two\n')
  })

  it('refuses to outdent a top-level item', async() => {
    const source = '- one\n- two\n'
    const result = await indent(source, source.indexOf('two'), 'decrease')
    expect(result.kind).toBe('rejected')
    expect(result.source).toBe(source)
  })
})

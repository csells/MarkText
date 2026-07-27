import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

const DESKTOP_CONFIGURATION: ParseConfiguration = {
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

describe('SourceOnly document session', () => {
  it('retains and leases exact source while semantic consumers are unavailable', async() => {
    const source = `${'> '.repeat(129)}text\r\n`
    const session = await createDocumentSession({
      source: createSourceSnapshot(source),
      parseConfiguration: DESKTOP_CONFIGURATION
    })

    const snapshot = session.snapshot()
    if (snapshot.kind !== 'source-only') {
      throw new Error('Expected the over-budget source to open in SourceOnly mode')
    }
    expect(snapshot).toMatchObject({
      kind: 'source-only',
      revision: {
        kind: 'source-only',
        source,
        fatalDiagnostic: {
          code: 'CM_RESOURCE_MARKDOWN_DEPTH_EXCEEDED'
        }
      },
      view: 'source'
    })
    expect('livePlan' in snapshot).toBe(false)
    expect('editingDocument' in snapshot).toBe(false)

    const persistence = await session.preparePersistence('save').completion
    expect(persistence.kind).toBe('flushed')
    if (persistence.kind !== 'flushed') {
      throw new Error('SourceOnly persistence unexpectedly blocked')
    }
    let leased = ''
    for await (const chunk of persistence.source.readChunks()) {
      leased += chunk.text
    }
    expect(leased).toBe(source)
    expect(await persistence.source.release('consumer-finished').completion)
      .toMatchObject({ kind: 'released' })
  })

  it('selects and edits raw source coordinates, then undoes exactly', async() => {
    const source = `${'> '.repeat(129)}text\r\n`
    const session = await createDocumentSession({
      source: createSourceSnapshot(source),
      parseConfiguration: DESKTOP_CONFIGURATION
    })

    const caret = {
      anchor: { offset: source.length, affinity: 'next' as const },
      focus: { offset: source.length, affinity: 'next' as const }
    }
    session.select(caret)
    const target = session.snapshot().revision.selection
    if (target === null || target.view !== 'source') {
      throw new Error('Expected a raw Source selection')
    }

    const inserted = await session.dispatch({
      kind: 'insert-text',
      target,
      text: '!'
    }).completion
    expect(inserted.kind).toBe('committed')
    const afterInsert = session.snapshot()
    expect(afterInsert).toMatchObject({
      kind: 'source-only',
      view: 'source',
      revision: {
        kind: 'source-only',
        source: `${source}!`,
        selection: {
          view: 'source',
          anchor: { offset: source.length + 1 },
          focus: { offset: source.length + 1 }
        }
      }
    })

    expect((await session.dispatch({ kind: 'undo' }).completion).kind)
      .toBe('committed')
    const undone = session.snapshot()
    expect(undone).toMatchObject({
      kind: 'source-only',
      revision: {
        kind: 'source-only',
        source,
        selection: {
          view: 'source',
          anchor: { offset: source.length },
          focus: { offset: source.length }
        }
      }
    })
  })

  it('returns to a complete semantic session when a raw edit becomes admissible', async() => {
    const source = `${'> '.repeat(129)}text\r\n`
    const session = await createDocumentSession({
      source: createSourceSnapshot(source),
      parseConfiguration: DESKTOP_CONFIGURATION
    })
    session.select({
      anchor: { offset: 0, affinity: 'next' },
      focus: { offset: 2, affinity: 'previous' }
    })
    const target = session.snapshot().revision.selection
    if (target === null || target.view !== 'source') {
      throw new Error('Expected a raw Source selection')
    }

    const deleted = await session.dispatch({
      kind: 'delete-text',
      target
    }).completion
    expect(deleted.kind).toBe('committed')
    const recovered = session.snapshot()
    if (recovered.kind !== 'complete') {
      throw new Error('Expected the admissible edit to restore semantic products')
    }
    expect(recovered).toMatchObject({
      view: 'markup',
      revision: {
        kind: 'complete',
        source: source.slice(2),
        selection: {
          view: 'markup'
        }
      }
    })
    expect(recovered.livePlan.runs.map((run) => run.text).join(''))
      .toBe(source.slice(2))
    expect(recovered.editingDocument.source).toBe(source.slice(2))

    expect((await session.dispatch({ kind: 'undo' }).completion).kind)
      .toBe('committed')
    const restored = session.snapshot()
    expect(restored).toMatchObject({
      kind: 'source-only',
      view: 'source',
      revision: {
        source,
        selection: {
          view: 'source',
          anchor: { offset: 0 },
          focus: { offset: 2 }
        }
      }
    })
    expect('livePlan' in restored).toBe(false)
    expect('editingDocument' in restored).toBe(false)
  })
})

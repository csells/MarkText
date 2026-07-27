import { describe, expect, it } from 'vitest'
import {
  createDocumentSearchQuery,
  createDocumentSession,
  createSourceSnapshot,
  DocumentExecutionCancelledError,
  type DocumentSearchQueryOptions,
  type DocumentSession,
  type ParseConfiguration,
  type ParseExecutionControl
} from '@marktext/document-core'
import { completeSnapshot } from '../helpers/completeSnapshot.js'

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

async function openSession(
  source: string,
  trackChanges = false,
  parseConfiguration = TEST_CONFIGURATION,
  executionControl?: ParseExecutionControl
): Promise<DocumentSession> {
  return createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration,
    configuration: { authoringTextPolicy: 'nearest-owner-eol-v1' },
    initialView: 'markup',
    trackChanges,
    initialSelection: {
      anchor: { offset: 0, affinity: 'next' },
      focus: { offset: 0, affinity: 'next' }
    },
    ...(executionControl === undefined ? {} : { executionControl })
  })
}

async function replaceCurrentMatches(
  session: DocumentSession,
  query: string,
  replacement: string,
  options: DocumentSearchQueryOptions = Object.freeze({})
): Promise<void> {
  const target = session.snapshot().revision.selection
  if (target === null) {
    throw new Error('Expected an authenticated current selection')
  }
  const completion = await session.dispatch({
    kind: 'replace-current-matches',
    target,
    query: createDocumentSearchQuery(query, options),
    replacement
  }).completion
  expect(completion).toMatchObject({ kind: 'committed' })
}

describe('replace current matches', () => {
  it('replaces every current visible match in one revision and one Undo', async() => {
    const source = 'one two one three one\n'
    const session = await openSession(source)
    const before = session.snapshot().revision.id

    await replaceCurrentMatches(session, 'one', 'many')

    expect(completeSnapshot(session).revision.source)
      .toBe('many two many three many\n')
    expect(session.snapshot().revision.id).not.toBe(before)

    expect((await session.dispatch({ kind: 'undo' }).completion).kind)
      .toBe('committed')
    expect(completeSnapshot(session).revision.source).toBe(source)
  })

  it('uses the same default case-insensitive query semantics as Find', async() => {
    const session = await openSession('Apple and apple\n')

    await replaceCurrentMatches(session, 'apple', 'pear')

    expect(completeSnapshot(session).revision.source).toBe('pear and pear\n')
  })

  it('rejects an empty-width regexp before mutating the document', async() => {
    const source = 'apple\n'
    const session = await openSession(source)
    const target = session.snapshot().revision.selection
    if (target === null) {
      throw new Error('Expected an authenticated current selection')
    }

    expect(() => session.dispatch({
      kind: 'replace-current-matches',
      target,
      query: {
        schema: 'document-search-query-1',
        text: '(?=a)',
        syntax: 'regexp',
        caseSensitive: false,
        wholeWord: false
      },
      replacement: 'pear'
    })).toThrow('Editor intent')
    expect(completeSnapshot(session).revision.source).toBe(source)
  })

  it('rejects a pathological regexp before mutating the document', async() => {
    const source = `${'a'.repeat(8_192)}!\n`
    const session = await openSession(source)
    const before = session.snapshot().revision
    const target = before.selection
    if (target === null) {
      throw new Error('Expected an authenticated current selection')
    }

    expect(() => session.dispatch({
      kind: 'replace-current-matches',
      target,
      query: {
        schema: 'document-search-query-1',
        text: '(a+)+$',
        syntax: 'regexp',
        caseSensitive: true,
        wholeWord: false
      },
      replacement: 'safe'
    })).toThrow('Editor intent')
    expect(session.snapshot().revision.id).toBe(before.id)
    expect(completeSnapshot(session).revision.source).toBe(source)
    expect(session.historyState()).toMatchObject({
      canUndo: false,
      canRedo: false
    })
  })

  it('rejects a match set beyond the fixed search budget atomically', async() => {
    const source = `${'> '.repeat(129)}x\n${'a '.repeat(16_385)}`
    const session = await openSession(source, false, {
      ...TEST_CONFIGURATION,
      executionBudget: {
        limitsProfile: 'desktop-v1',
        accountingSchema: 'syntax-accounting-1'
      }
    })
    expect(session.snapshot().kind).toBe('source-only')
    const before = session.snapshot().revision
    const target = before.selection
    if (target === null) {
      throw new Error('Expected an authenticated current selection')
    }

    const completion = await session.dispatch({
      kind: 'replace-current-matches',
      target,
      query: createDocumentSearchQuery('a'),
      replacement: 'b'
    }).completion

    expect(completion).toMatchObject({
      kind: 'rejected',
      reason: 'invalid-command-argument'
    })
    expect(session.snapshot().revision.id).toBe(before.id)
    expect(session.snapshot().revision.source).toBe(source)
    expect(session.historyState()).toMatchObject({
      canUndo: false,
      canRedo: false
    })
  })

  it('rejects replacement output beyond the fixed search budget atomically', async() => {
    const source = `${'> '.repeat(129)}needle\n`
    const session = await openSession(source, false, {
      ...TEST_CONFIGURATION,
      executionBudget: {
        limitsProfile: 'desktop-v1',
        accountingSchema: 'syntax-accounting-1'
      }
    })
    expect(session.snapshot().kind).toBe('source-only')
    const before = session.snapshot().revision
    const target = before.selection
    if (target === null) {
      throw new Error('Expected an authenticated current selection')
    }

    expect(() => session.dispatch({
      kind: 'replace-current-matches',
      target,
      query: createDocumentSearchQuery('needle'),
      replacement: 'x'.repeat(1_048_577)
    })).toThrow('Editor intent')
    expect(session.snapshot().revision.id).toBe(before.id)
    expect(session.snapshot().revision.source).toBe(source)
    expect(session.historyState()).toMatchObject({
      canUndo: false,
      canRedo: false
    })
  })

  it('cancels match discovery cooperatively before any mutation', async() => {
    const source = 'a'.repeat(12_288)
    let cancellationArmed = false
    let cancellationCheckpoints = 0
    const executionControl: ParseExecutionControl = Object.freeze({
      checkpoint: Object.freeze((): void => {
        if (!cancellationArmed) return
        cancellationCheckpoints += 1
        throw new DocumentExecutionCancelledError()
      })
    })
    const session = await openSession(
      source,
      false,
      TEST_CONFIGURATION,
      executionControl
    )
    expect(session.snapshot().kind).toBe('complete')
    const before = session.snapshot().revision
    const target = before.selection
    if (target === null) {
      throw new Error('Expected an authenticated current selection')
    }

    cancellationArmed = true
    const completion = await session.dispatch({
      kind: 'replace-current-matches',
      target,
      query: createDocumentSearchQuery('needle'),
      replacement: 'replacement'
    }).completion

    expect(completion).toMatchObject({
      kind: 'cancelled',
      reason: 'cancelled'
    })
    expect(cancellationCheckpoints).toBeGreaterThan(0)
    expect(session.snapshot().revision.id).toBe(before.id)
    expect(session.snapshot().revision.source).toBe(source)
    expect(session.historyState()).toMatchObject({
      canUndo: false,
      canRedo: false
    })
  })

  it('uses regexp match discovery for the atomic replacement set', async() => {
    const source = 'Apple apricot APPLE\n'
    const session = await openSession(source)

    await replaceCurrentMatches(session, 'ap(ple|ricot)', 'fruit', {
      syntax: 'regexp'
    })

    expect(completeSnapshot(session).revision.source)
      .toBe('fruit fruit fruit\n')
    expect((await session.dispatch({ kind: 'undo' }).completion).kind)
      .toBe('committed')
    expect(completeSnapshot(session).revision.source).toBe(source)
  })

  it('replaces only Unicode whole-word matches', async() => {
    const session = await openSession('猫 猫咪 猫\n')

    await replaceCurrentMatches(session, '猫', '犬', {
      wholeWord: true
    })

    expect(completeSnapshot(session).revision.source).toBe('犬 猫咪 犬\n')
  })

  it('owns match discovery inside the core visible-text projection', async() => {
    const session = await openSession('a {++one++} b one\n')

    await replaceCurrentMatches(session, 'one', 'many')

    expect(completeSnapshot(session).revision.source)
      .toBe('a {++many++} b many\n')
  })

  it('records all replacements as substitutions under Track Changes', async() => {
    const source = 'one two one\n'
    const session = await openSession(source, true)

    await replaceCurrentMatches(session, 'one', 'many')

    expect(completeSnapshot(session).revision.source)
      .toBe('{~~one~>many~~} two {~~one~>many~~}\n')
    expect((await session.dispatch({ kind: 'undo' }).completion).kind)
      .toBe('committed')
    expect(completeSnapshot(session).revision.source).toBe(source)
  })

  it('does not expose orphaned Markdown syntax when a visible match crosses inline nodes', async() => {
    const source = '**o**ne\n'
    const session = await openSession(source)

    await replaceCurrentMatches(session, 'one', 'many')

    expect(completeSnapshot(session).revision.source).toBe('**many**\n')
    expect((await session.dispatch({ kind: 'undo' }).completion).kind)
      .toBe('committed')
    expect(completeSnapshot(session).revision.source).toBe(source)
  })

  it('removes a later inline wrapper consumed by a cross-node match', async() => {
    const source = 'o**ne**\n'
    const session = await openSession(source)

    await replaceCurrentMatches(session, 'one', 'many')

    expect(completeSnapshot(session).revision.source).toBe('many\n')
    expect((await session.dispatch({ kind: 'undo' }).completion).kind)
      .toBe('committed')
    expect(completeSnapshot(session).revision.source).toBe(source)
  })

  it('recomputes literal matches in exact raw source while SourceOnly', async() => {
    const source = `${'> '.repeat(129)}one one\n`
    const session = await openSession(source, false, {
      ...TEST_CONFIGURATION,
      executionBudget: {
        limitsProfile: 'desktop-v1',
        accountingSchema: 'syntax-accounting-1'
      }
    })
    expect(session.snapshot().kind).toBe('source-only')

    await replaceCurrentMatches(session, 'one', 'many')

    const replaced = session.snapshot()
    expect(replaced.kind).toBe('source-only')
    expect(replaced.revision.source).toBe(source.replaceAll('one', 'many'))
    expect((await session.dispatch({ kind: 'undo' }).completion).kind)
      .toBe('committed')
    expect(session.snapshot().revision.source).toBe(source)
  })

  it('rejects a stale authenticated target before recomputing or mutating', async() => {
    const session = await openSession('one one\n')
    const stale = session.snapshot().revision.selection
    if (stale === null) throw new Error('Expected an authenticated selection')
    expect((await session.dispatch({
      kind: 'insert-text',
      target: stale,
      text: 'x'
    }).completion).kind).toBe('committed')
    const sourceBeforeRejectedIntent =
      completeSnapshot(session).revision.source

    const rejected = await session.dispatch({
      kind: 'replace-current-matches',
      target: stale,
      query: createDocumentSearchQuery('one'),
      replacement: 'many'
    }).completion

    expect(rejected).toMatchObject({
      kind: 'rejected',
      reason: 'stale-selection'
    })
    expect(completeSnapshot(session).revision.source)
      .toBe(sourceBeforeRejectedIntent)
  })
})

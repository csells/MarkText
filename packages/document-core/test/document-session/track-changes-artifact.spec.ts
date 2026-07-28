import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type DocumentSession,
  type EditorIntent,
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

interface ArtifactRow {
  readonly intent: string
  readonly form: string
  readonly arm: string
  readonly carrier: string
  readonly precondition: string
  readonly expected_transform: string
  readonly expected_undo: string
}

function artifactRows(): readonly ArtifactRow[] {
  const path = fileURLToPath(new URL(
    '../../../../specs/migration/track-changes-interactions.tsv',
    import.meta.url
  ))
  const [header, ...lines] = readFileSync(path, 'utf8').trim().split('\n')
  const columns = header?.split('\t') ?? []
  return Object.freeze(lines.map((line) => {
    const values = line.split('\t')
    return Object.freeze(Object.fromEntries(
      columns.map((column, index) => [column, values[index] ?? ''])
    )) as unknown as ArtifactRow
  }))
}

function rowKey(
  row: Pick<ArtifactRow, 'intent' | 'form' | 'arm' | 'carrier'>
): string {
  return [row.intent, row.form, row.arm, row.carrier].join('/')
}

function selection(start: number, end = start): InitialModelSelection {
  return Object.freeze({
    anchor: Object.freeze({ offset: start, affinity: 'next' as const }),
    focus: Object.freeze({
      offset: end,
      affinity: end === start ? 'next' as const : 'previous' as const
    })
  })
}

function sessionTarget(session: DocumentSession) {
  const target = session.snapshot().revision.selection
  if (target === null) {
    throw new Error('Expected an editable Markup selection')
  }
  return target
}

interface TrackFixture {
  readonly source: string
  readonly initialSelection: InitialModelSelection
  readonly expected?: string
  readonly rejection?: string
  readonly intent: (session: DocumentSession) => EditorIntent
}

const FIXTURES = new Map<string, TrackFixture>([
  ['insert/none/none/plain', {
    source: 'ab',
    initialSelection: selection(1),
    expected: 'a{++x++}b',
    intent: (session) => ({
      kind: 'insert-text',
      target: sessionTarget(session),
      text: 'x'
    })
  }],
  ['insert/addition/content/pending-revised', {
    source: '{++ab++}',
    initialSelection: selection(1),
    expected: '{++axb++}',
    intent: (session) => ({
      kind: 'insert-text',
      target: sessionTarget(session),
      text: 'x'
    })
  }],
  ['insert/deletion/content/pending-original', {
    source: '{--ab--}',
    initialSelection: selection(1),
    rejection: 'read-only-change-arm',
    intent: (session) => ({
      kind: 'insert-text',
      target: sessionTarget(session),
      text: 'x'
    })
  }],
  ['delete/none/none/plain', {
    source: 'abc',
    initialSelection: selection(1, 2),
    expected: 'a{--b--}c',
    intent: (session) => ({
      kind: 'delete-text',
      target: sessionTarget(session)
    })
  }],
  ['delete/addition/content/pending-revised', {
    source: '{++abc++}',
    initialSelection: selection(1, 2),
    expected: '{++ac++}',
    intent: (session) => ({
      kind: 'delete-text',
      target: sessionTarget(session)
    })
  }],
  ['delete/highlight/content/stable-carrier', {
    source: '{==abc==}',
    initialSelection: selection(1, 2),
    expected: '{==ac==}',
    intent: (session) => ({
      kind: 'delete-text',
      target: sessionTarget(session)
    })
  }],
  ['replace/none/none/plain', {
    source: 'abc',
    initialSelection: selection(1, 2),
    expected: 'a{~~b~>x~~}c',
    intent: (session) => ({
      kind: 'replace-text',
      target: sessionTarget(session),
      text: 'x'
    })
  }],
  ['replace/substitution/old/pending-original', {
    source: '{~~old~>new~~}',
    initialSelection: selection(1, 2),
    rejection: 'read-only-change-arm',
    intent: (session) => ({
      kind: 'replace-text',
      target: sessionTarget(session),
      text: 'x'
    })
  }],
  ['replace/substitution/new/pending-revised', {
    source: '{~~old~>new~~}',
    initialSelection: selection(4, 5),
    expected: '{~~old~>nxw~~}',
    intent: (session) => ({
      kind: 'replace-text',
      target: sessionTarget(session),
      text: 'x'
    })
  }],
  ['format/none/none/plain', {
    source: 'abc',
    initialSelection: selection(1, 2),
    expected: 'a{++**++}b{++**++}c',
    intent: (session) => ({
      kind: 'format-text',
      target: sessionTarget(session),
      format: 'strong'
    })
  }],
  ['format/addition/content/pending-revised', {
    source: '{++abc++}',
    initialSelection: selection(1, 2),
    expected: '{++a**b**c++}',
    intent: (session) => ({
      kind: 'format-text',
      target: sessionTarget(session),
      format: 'strong'
    })
  }],
  ['structure/none/none/block', {
    source: 'old',
    initialSelection: selection(0, 3),
    expected: '{--old--}{++new++}',
    intent: (session) => ({
      kind: 'replace-structure',
      target: sessionTarget(session),
      replacement: 'new'
    })
  }],
  ['structure/highlight/content/stable-carrier', {
    source: '{==old==}',
    initialSelection: selection(0, 3),
    expected: '{=={--old--}{++new++}==}',
    intent: (session) => ({
      kind: 'replace-structure',
      target: sessionTarget(session),
      replacement: 'new'
    })
  }],
  ['paste/none/none/plain', {
    source: 'ab',
    initialSelection: selection(1),
    expected: 'a{++X++}b',
    intent: (session) => ({
      kind: 'paste-text',
      target: sessionTarget(session),
      text: 'X',
      source: 'external-text'
    })
  }],
  ['paste/addition/content/pending-revised', {
    source: '{++ab++}',
    initialSelection: selection(1),
    expected: '{++a*x*b++}',
    intent: (session) => ({
      kind: 'paste-text',
      target: sessionTarget(session),
      text: '*x*',
      source: 'raw-source-import'
    })
  }],
  ['ime/none/none/plain', {
    source: 'ab',
    initialSelection: selection(1),
    expected: 'a{++文++}b',
    intent: (session) => ({
      kind: 'commit-composition',
      target: sessionTarget(session),
      text: '文'
    })
  }],
  ['ime/addition/content/pending-revised', {
    source: '{++ab++}',
    initialSelection: selection(1),
    expected: '{++a文b++}',
    intent: (session) => ({
      kind: 'commit-composition',
      target: sessionTarget(session),
      text: '文'
    })
  }]
])

describe('DocumentSession Track Changes artifact', () => {
  it('covers the frozen typed-intent matrix below Electron with exact undo', async() => {
    const rows = artifactRows()
    expect(new Set(FIXTURES.keys())).toEqual(
      new Set(rows.map((row) => rowKey(row)))
    )

    for (const row of rows) {
      const key = rowKey(row)
      const fixture = FIXTURES.get(key)
      if (fixture === undefined) {
        throw new Error(`Missing Track Changes fixture: ${key}`)
      }
      expect(row.precondition, key).not.toBe('')
      expect(row.expected_transform, key).not.toBe('')
      expect(row.expected_undo, key).not.toBe('')

      const session = await createDocumentSession({
        source: createSourceSnapshot(fixture.source),
        parseConfiguration: TEST_CONFIGURATION,
        trackChanges: true,
        initialSelection: fixture.initialSelection
      })
      const before = session.snapshot()
      const result = await session.dispatch(fixture.intent(session)).completion
      if (fixture.rejection !== undefined) {
        expect(result, key).toMatchObject({
          kind: 'rejected',
          reason: fixture.rejection
        })
        expect(session.snapshot().revision.source, key).toBe(fixture.source)
        await expect(
          session.dispatch({ kind: 'undo' }).completion,
          `${key} history`
        ).resolves.toMatchObject({
          kind: 'rejected',
          reason: 'nothing-to-undo'
        })
        continue
      }

      expect(result, key).toMatchObject({
        kind: 'committed',
        transition: {
          cause: 'source-edit',
          history: 'record'
        }
      })
      expect(session.snapshot().revision.source, key).toBe(fixture.expected)
      const afterSelection = session.snapshot().revision.selection
      await expect(
        session.dispatch({ kind: 'undo' }).completion,
        `${key} undo`
      ).resolves.toMatchObject({ kind: 'committed' })
      expect(session.snapshot().revision.source, `${key} undo`)
        .toBe(fixture.source)
      expect(session.snapshot().revision.selection, `${key} undo`)
        .toMatchObject({
          anchor: before.revision.selection?.anchor,
          focus: before.revision.selection?.focus
        })
      await expect(
        session.dispatch({ kind: 'redo' }).completion,
        `${key} redo`
      ).resolves.toMatchObject({ kind: 'committed' })
      expect(session.snapshot().revision.source, `${key} redo`)
        .toBe(fixture.expected)
      expect(session.snapshot().revision.selection, `${key} redo`)
        .toMatchObject({
          anchor: afterSelection?.anchor,
          focus: afterSelection?.focus
        })
    }
  })
})

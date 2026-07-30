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

function selection(start: number, end = start): InitialModelSelection {
  return Object.freeze({
    anchor: Object.freeze({ offset: start, affinity: 'next' as const }),
    focus: Object.freeze({
      offset: end,
      affinity: end === start ? 'next' as const : 'previous' as const
    })
  })
}

async function open(
  source: string,
  initialSelection: InitialModelSelection
): Promise<DocumentSession> {
  return createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: TEST_CONFIGURATION,
    initialSelection
  })
}

function sourceOf(session: DocumentSession): string {
  const snapshot = session.snapshot()
  if (snapshot.kind !== 'complete') {
    throw new Error('Expected a complete snapshot')
  }
  return snapshot.revision.source
}

function targetOf(session: DocumentSession) {
  const target = session.snapshot().revision.selection
  if (target === null) {
    throw new Error('Expected an editable selection')
  }
  return target
}

// Profile 1 E4 / ADR-0015: a Markup-mode edit whose candidate would make the
// document newly begin with U+FEFF encodes it as `&#xFEFF;` — a bare U+FEFF
// at offset zero reads as a BOM everywhere, so committing it would silently
// reinterpret the author's character. An opened BOM stays a bare exact
// U+FEFF; only an edit-introduced leading position is encoded (G38).
describe('edit-introduced leading U+FEFF encoding', () => {
  it('encodes the newly leading code unit on an ordinary deletion', async() => {
    const source = 'X﻿rest\n'
    const session = await open(source, selection(0))

    await expect(session.dispatch({
      kind: 'delete-text',
      target: { ...targetOf(session), ...selection(0, 1) }
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(sourceOf(session)).toBe('&#xFEFF;rest\n')

    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(sourceOf(session)).toBe(source)
  })

  it('keeps an opened leading U+FEFF bare and exact through editing', async() => {
    const source = '﻿word\n'
    const session = await open(source, selection(5))

    await expect(session.dispatch({
      kind: 'insert-text',
      target: targetOf(session),
      text: 'z'
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    // The document already began with U+FEFF, so nothing is encoded.
    expect(sourceOf(session)).toBe('﻿wordz\n')
  })

  it('leaves a mid-document U+FEFF untouched by nearby edits', async() => {
    const source = 'a﻿b DEL c\n'
    const session = await open(source, selection(0))
    const at = source.indexOf('DEL')

    await expect(session.dispatch({
      kind: 'delete-text',
      target: { ...targetOf(session), ...selection(at, at + 4) }
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(sourceOf(session)).toBe('a﻿b c\n')
  })
})

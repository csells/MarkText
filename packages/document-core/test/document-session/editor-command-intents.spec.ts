import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type DocumentSession,
  type EditorIntent,
  type InitialModelSelection,
  type ParseConfiguration,
  type QuickInsertBlock
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
  initialSelection: InitialModelSelection,
  trackChanges = false
): Promise<DocumentSession> {
  return createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: TEST_CONFIGURATION,
    initialSelection,
    trackChanges
  })
}

function targetOf(session: DocumentSession) {
  const target = session.snapshot().revision.selection
  if (target === null) {
    throw new Error('Expected an editable Markup selection')
  }
  return target
}

async function expectOneStep(
  session: DocumentSession,
  intent: EditorIntent,
  expected: string,
  original: string,
  expectedSelection?: Readonly<{
    anchor: number
    focus: number
  }>
): Promise<void> {
  await expect(session.dispatch(intent).completion).resolves.toMatchObject({
    kind: 'committed',
    transition: {
      cause: 'source-edit',
      history: 'record'
    }
  })
  expect(session.snapshot().revision.source).toBe(expected)
  if (expectedSelection !== undefined) {
    expect(session.snapshot().revision.selection).toMatchObject({
      anchor: { offset: expectedSelection.anchor },
      focus: { offset: expectedSelection.focus }
    })
  }
  await expect(session.dispatch({ kind: 'undo' }).completion)
    .resolves.toMatchObject({
      kind: 'committed',
      transition: {
        cause: 'undo',
        history: 'none'
      }
    })
  expect(session.snapshot().revision.source).toBe(original)
}

describe('DocumentSession target-owned editor command intents', () => {
  it('sets parser-owned task markers with cascade in one exact undo step', async() => {
    const source =
      '- [ ] parent\n\n' +
      '  - [ ] child1\n' +
      '  - [ ] child2\n'
    const session = await open(source, selection(6))

    await expectOneStep(
      session,
      {
        kind: 'set-task-checked',
        target: targetOf(session),
        checked: true,
        cascade: true
      },
      '- [x] parent\n\n' +
      '  - [x] child1\n' +
      '  - [x] child2\n',
      source
    )
  })

  it('sets only the directly targeted task when cascade is disabled', async() => {
    const source =
      '- [ ] parent\n\n' +
      '  - [ ] child1\n' +
      '  - [ ] child2\n'
    const session = await open(source, selection(6))

    await expectOneStep(
      session,
      {
        kind: 'set-task-checked',
        target: targetOf(session),
        checked: true,
        cascade: false
      },
      '- [x] parent\n\n' +
      '  - [ ] child1\n' +
      '  - [ ] child2\n',
      source
    )
  })

  it('derives an ancestor task when the final unchecked child is checked', async() => {
    const source =
      '- [ ] parent\n\n' +
      '  - [x] child1\n' +
      '  - [ ] child2\n'
    const session = await open(source, selection(source.indexOf('child2')))

    await expectOneStep(
      session,
      {
        kind: 'set-task-checked',
        target: targetOf(session),
        checked: true,
        cascade: true
      },
      '- [x] parent\n\n' +
      '  - [x] child1\n' +
      '  - [x] child2\n',
      source
    )
  })

  it('replaces an authenticated slash query with one closed block choice', async() => {
    const source = '/'
    const session = await open(source, selection(1))

    await expectOneStep(
      session,
      {
        kind: 'quick-insert-block',
        target: targetOf(session),
        block: {
          kind: 'conversion',
          conversion: { kind: 'heading', level: 1 }
        }
      },
      '# ',
      source
    )
  })

  it('inserts every documented Quick Insert conversion exactly', async() => {
    const cases: readonly Readonly<{
      query: string
      block: QuickInsertBlock
      expected: string
      caret: number
    }>[] = [
      {
        query: 'paragraph',
        block: { kind: 'conversion', conversion: { kind: 'paragraph' } },
        expected: '\r\n',
        caret: 0
      },
      {
        query: 'horizontal-line',
        block: {
          kind: 'conversion',
          conversion: { kind: 'thematic-break' }
        },
        expected: '---\r\n',
        caret: 3
      },
      {
        query: 'front-matter',
        block: { kind: 'conversion', conversion: { kind: 'front-matter' } },
        expected: '---\r\n\r\n---\r\n',
        caret: 5
      },
      {
        query: 'heading-1',
        block: {
          kind: 'conversion',
          conversion: { kind: 'heading', level: 1 }
        },
        expected: '# \r\n',
        caret: 2
      },
      {
        query: 'heading-2',
        block: {
          kind: 'conversion',
          conversion: { kind: 'heading', level: 2 }
        },
        expected: '## \r\n',
        caret: 3
      },
      {
        query: 'heading-3',
        block: {
          kind: 'conversion',
          conversion: { kind: 'heading', level: 3 }
        },
        expected: '### \r\n',
        caret: 4
      },
      {
        query: 'heading-4',
        block: {
          kind: 'conversion',
          conversion: { kind: 'heading', level: 4 }
        },
        expected: '#### \r\n',
        caret: 5
      },
      {
        query: 'heading-5',
        block: {
          kind: 'conversion',
          conversion: { kind: 'heading', level: 5 }
        },
        expected: '##### \r\n',
        caret: 6
      },
      {
        query: 'heading-6',
        block: {
          kind: 'conversion',
          conversion: { kind: 'heading', level: 6 }
        },
        expected: '###### \r\n',
        caret: 7
      },
      {
        query: 'display-math',
        block: { kind: 'conversion', conversion: { kind: 'math-block' } },
        expected: '$$\r\n\r\n$$\r\n',
        caret: 4
      },
      {
        query: 'html',
        block: { kind: 'conversion', conversion: { kind: 'html-block' } },
        expected: '<div>\r\n\r\n</div>\r\n',
        caret: 7
      },
      {
        query: 'code',
        block: { kind: 'conversion', conversion: { kind: 'code-block' } },
        expected: '```\r\n\r\n```\r\n',
        caret: 5
      },
      {
        query: 'quote',
        block: { kind: 'conversion', conversion: { kind: 'blockquote' } },
        expected: '> \r\n',
        caret: 2
      },
      {
        query: 'ordered-list',
        block: { kind: 'conversion', conversion: { kind: 'ordered-list' } },
        expected: '1. \r\n',
        caret: 3
      },
      {
        query: 'bullet-list',
        block: { kind: 'conversion', conversion: { kind: 'unordered-list' } },
        expected: '- \r\n',
        caret: 2
      },
      {
        query: 'task-list',
        block: { kind: 'conversion', conversion: { kind: 'task-list' } },
        expected: '- [ ] \r\n',
        caret: 6
      }
    ]

    for (const row of cases) {
      const source = `/${row.query}\r\n`
      const session = await open(source, selection(source.length - 2))
      await expectOneStep(
        session,
        {
          kind: 'quick-insert-block',
          target: targetOf(session),
          block: row.block
        },
        row.expected,
        source,
        { anchor: row.caret, focus: row.caret }
      )
      await expect(session.dispatch({ kind: 'redo' }).completion)
        .resolves.toMatchObject({ kind: 'committed' })
      expect(session.snapshot().revision.source).toBe(row.expected)
    }
  })

  it.each([
    ['vega-lite', '```vega-lite\r\n\r\n```\r\n', 14],
    ['mermaid', '```mermaid\r\n\r\n```\r\n', 12],
    ['plantuml', '```plantuml\r\n\r\n```\r\n', 13],
    ['flowchart', '```flowchart\r\n\r\n```\r\n', 14],
    ['sequence', '```sequence\r\n\r\n```\r\n', 13]
  ] as const)('inserts the exact %s diagram fence with exact history', async(
    language,
    expected,
    caret
  ) => {
    const source = `/${language}\r\n`
    const session = await open(source, selection(1 + language.length))

    await expectOneStep(
      session,
      {
        kind: 'quick-insert-block',
        target: targetOf(session),
        block: { kind: 'diagram', language }
      },
      expected,
      source,
      {
        anchor: caret,
        focus: caret
      }
    )
    await expect(session.dispatch({ kind: 'redo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(expected)
  })

  it('inserts a diagram into a truly empty document', async() => {
    const session = await open('', selection(0))
    const expected = '```mermaid\n\n```'

    await expectOneStep(
      session,
      {
        kind: 'quick-insert-block',
        target: targetOf(session),
        block: { kind: 'diagram', language: 'mermaid' }
      },
      expected,
      '',
      { anchor: 11, focus: 11 }
    )
  })

  it('replaces a whitespace-only document and preserves its EOL', async() => {
    const source = '\r\n'
    const session = await open(source, selection(0))
    const expected = '```sequence\r\n\r\n```\r\n'

    await expectOneStep(
      session,
      {
        kind: 'quick-insert-block',
        target: targetOf(session),
        block: { kind: 'diagram', language: 'sequence' }
      },
      expected,
      source,
      { anchor: 13, focus: 13 }
    )
  })

  it('tracks one Quick Insert replacement as one exact undo step', async() => {
    const source = '/mermaid'
    const session = await open(source, selection(source.length), true)
    const expected = '{--/mermaid--}{++```mermaid\n\n```++}'

    await expectOneStep(
      session,
      {
        kind: 'quick-insert-block',
        target: targetOf(session),
        block: { kind: 'diagram', language: 'mermaid' }
      },
      expected,
      source
    )
    await expect(session.dispatch({ kind: 'redo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(expected)
  })

  it('tracks Quick Insert into an empty document as one addition', async() => {
    const session = await open('', selection(0), true)
    const expected = '{++|   |\n| --- |++}'

    await expectOneStep(
      session,
      {
        kind: 'quick-insert-block',
        target: targetOf(session),
        block: { kind: 'table', rows: 1, columns: 1 }
      },
      expected,
      '',
      { anchor: 2, focus: 2 }
    )
    await expect(session.dispatch({ kind: 'redo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(expected)
  })

  it('inserts the minimum 1×1 GFM table and preserves the source EOL', async() => {
    const source = '/table\n'
    const session = await open(source, selection(6))
    const expected = '|   |\n| --- |\n'

    await expectOneStep(
      session,
      {
        kind: 'quick-insert-block',
        target: targetOf(session),
        block: { kind: 'table', rows: 1, columns: 1 }
      },
      expected,
      source,
      { anchor: 2, focus: 2 }
    )
    await expect(session.dispatch({ kind: 'redo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(expected)
  })

  it('inserts the maximum 30×20 GFM table exactly', async() => {
    const source = '/table\r\n'
    const session = await open(source, selection(6))
    const header =
      '|   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |'
    const delimiter =
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
    const expected = [
      header,
      delimiter,
      ...Array.from({ length: 29 }, () => header),
      ''
    ].join('\r\n')

    await expectOneStep(
      session,
      {
        kind: 'quick-insert-block',
        target: targetOf(session),
        block: { kind: 'table', rows: 30, columns: 20 }
      },
      expected,
      source,
      { anchor: 2, focus: 2 }
    )
    await expect(session.dispatch({ kind: 'redo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(expected)
  })

  it('accepts every host table shape from 1–30 rows by 1–20 columns', async() => {
    for (let rows = 1; rows <= 30; rows += 1) {
      for (let columns = 1; columns <= 20; columns += 1) {
        const session = await open('/table', selection(6))
        await expect(session.dispatch({
          kind: 'quick-insert-block',
          target: targetOf(session),
          block: { kind: 'table', rows, columns }
        }).completion).resolves.toMatchObject({ kind: 'committed' })

        const lines = session.snapshot().revision.source.split('\n')
        expect(lines).toHaveLength(rows + 1)
        expect(lines[0]?.match(/\|/g)).toHaveLength(columns + 1)
        expect(lines[1]?.match(/\|/g)).toHaveLength(columns + 1)
        expect(lines.at(-1)?.match(/\|/g)).toHaveLength(columns + 1)
        await expect(session.close().completion)
          .resolves.toEqual({ kind: 'closed' })
      }
    }
  })

  it('rejects a Quick Insert table when GFM is disabled without history', async() => {
    const session = await createDocumentSession({
      source: createSourceSnapshot('/table'),
      parseConfiguration: {
        ...TEST_CONFIGURATION,
        markdownOptions: {
          ...TEST_CONFIGURATION.markdownOptions,
          gfm: false
        }
      },
      initialSelection: selection(6)
    })
    const before = session.historyState()

    await expect(session.dispatch({
      kind: 'quick-insert-block',
      target: targetOf(session),
      block: { kind: 'table', rows: 1, columns: 1 }
    }).completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'invalid-command-argument'
    })
    expect(session.snapshot().revision.source).toBe('/table')
    expect(session.historyState()).toEqual(before)
  })

  it.each([
    {
      option: 'frontMatter' as const,
      block: {
        kind: 'conversion' as const,
        conversion: { kind: 'front-matter' as const }
      }
    },
    {
      option: 'math' as const,
      block: {
        kind: 'conversion' as const,
        conversion: { kind: 'math-block' as const }
      }
    }
  ])('rejects Quick Insert when $option support is disabled', async({
    option,
    block
  }) => {
    const session = await createDocumentSession({
      source: createSourceSnapshot('/choice'),
      parseConfiguration: {
        ...TEST_CONFIGURATION,
        markdownOptions: {
          ...TEST_CONFIGURATION.markdownOptions,
          [option]: false
        }
      },
      initialSelection: selection(7)
    })
    const before = session.historyState()

    await expect(session.dispatch({
      kind: 'quick-insert-block',
      target: targetOf(session),
      block
    }).completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'invalid-command-argument'
    })
    expect(session.snapshot().revision.source).toBe('/choice')
    expect(session.historyState()).toEqual(before)
  })

  it.each([
    { kind: 'diagram', language: 'dot' },
    {
      kind: 'conversion',
      conversion: { kind: 'heading-shift', direction: 'promote' }
    },
    { kind: 'conversion', conversion: { kind: 'loose-list-item' } },
    { kind: 'table', rows: 0, columns: 1 },
    { kind: 'table', rows: 31, columns: 1 },
    { kind: 'table', rows: 1, columns: 0 },
    { kind: 'table', rows: 1, columns: 21 }
  ])('rejects an invalid closed Quick Insert choice %# before mutation', async(block) => {
    const session = await open('/x', selection(2))
    const before = session.historyState()

    expect(() => session.dispatch({
      kind: 'quick-insert-block',
      target: targetOf(session),
      block
    } as unknown as EditorIntent)).toThrow()
    expect(session.snapshot().revision.source).toBe('/x')
    expect(session.historyState()).toEqual(before)
  })

  it('rejects a stale Quick Insert target atomically', async() => {
    const session = await open('/', selection(1))
    const stale = targetOf(session)
    await expect(session.dispatch({
      kind: 'insert-text',
      target: stale,
      text: 'x'
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    const beforeRejected = session.snapshot()
    const historyBeforeRejected = session.historyState()

    await expect(session.dispatch({
      kind: 'quick-insert-block',
      target: stale,
      block: { kind: 'diagram', language: 'mermaid' }
    }).completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'stale-selection',
      snapshot: beforeRejected
    })
    expect(session.snapshot()).toBe(beforeRejected)
    expect(session.historyState()).toEqual(historyBeforeRejected)

    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe('/')
    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({
        kind: 'rejected',
        reason: 'nothing-to-undo'
      })
  })

  it('converts the selected block to a heading as one exact undo step', async() => {
    const source = 'Title\r\n\r\nBody\r\n'
    const session = await open(source, selection(2))

    await expectOneStep(
      session,
      {
        kind: 'convert-block',
        target: targetOf(session),
        conversion: { kind: 'heading', level: 2 }
      },
      '## Title\r\n\r\nBody\r\n',
      source
    )
  })

  it('converts every top-level block touched by the selection atomically', async() => {
    const source = 'One\r\n\r\nTwo\r\n\r\nThree\r\n'
    const session = await open(source, selection(1, 9))

    await expectOneStep(
      session,
      {
        kind: 'convert-block',
        target: targetOf(session),
        conversion: { kind: 'heading', level: 2 }
      },
      '## One\r\n\r\n## Two\r\n\r\nThree\r\n',
      source
    )
  })

  it('duplicates the selected block as one exact undo step', async() => {
    const source = 'First\r\n\r\nSecond\r\n'
    const session = await open(source, selection(10))

    await expectOneStep(
      session,
      {
        kind: 'duplicate-block',
        target: targetOf(session)
      },
      'First\r\n\r\nSecond\r\n\r\nSecond\r\n',
      source
    )
  })

  it('duplicates every top-level block touched by the selection atomically', async() => {
    const source = 'One\r\n\r\nTwo\r\n\r\nThree\r\n'
    const session = await open(source, selection(1, 9))

    await expectOneStep(
      session,
      {
        kind: 'duplicate-block',
        target: targetOf(session)
      },
      'One\r\n\r\nTwo\r\n\r\nOne\r\n\r\nTwo\r\n\r\nThree\r\n',
      source
    )
  })

  it('deletes the selected block and its separator as one exact undo step', async() => {
    const source = 'First\r\n\r\nSecond\r\n'
    const session = await open(source, selection(2))

    await expectOneStep(
      session,
      {
        kind: 'delete-block',
        target: targetOf(session)
      },
      'Second\r\n',
      source
    )
  })

  it('creates a blank paragraph after the selected block as one exact undo step', async() => {
    const source = 'First\r\n\r\nSecond\r\n'
    const session = await open(source, selection(2))

    await expectOneStep(
      session,
      {
        kind: 'insert-paragraph',
        target: targetOf(session),
        location: 'after'
      },
      'First\r\n\r\n\r\nSecond\r\n',
      source
    )
  })

  it('formats the selected text with emphasis as one exact undo step', async() => {
    const source = 'before word after'
    const session = await open(source, selection(7, 11))

    await expectOneStep(
      session,
      {
        kind: 'format-text',
        target: targetOf(session),
        format: 'emphasis'
      },
      'before *word* after',
      source
    )
  })

  it('serializes every target inline format as one exact undo step', async() => {
    const cases = [
      ['underline', '<u>word</u>'],
      ['superscript', '^word^'],
      ['subscript', '~word~'],
      ['highlight', '==word=='],
      ['inline-code', '`word`'],
      ['inline-math', '$word$'],
      ['strikethrough', '~~word~~'],
      ['link', '[word]()'],
      ['image', '![word]()']
    ] as const

    for (const [format, expected] of cases) {
      const source = 'word'
      const session = await open(source, selection(0, 4))
      await expectOneStep(
        session,
        {
          kind: 'format-text',
          target: targetOf(session),
          format
        },
        expected,
        source
      )
    }
  })

  it('toggles an active format off as one exact undo step', async() => {
    const source = '**word**'
    const session = await open(source, selection(2, 6))

    await expectOneStep(
      session,
      {
        kind: 'format-text',
        target: targetOf(session),
        format: 'strong'
      },
      'word',
      source
    )
  })

  it('clears every enclosing format as one exact undo step', async() => {
    const source = '***word***'
    const session = await open(source, selection(3, 7))

    await expectOneStep(
      session,
      {
        kind: 'format-text',
        target: targetOf(session),
        format: 'clear'
      },
      'word',
      source
    )
  })

  it('converts the selected block to a block quote as one exact undo step', async() => {
    const source = 'Body\r\n'
    const session = await open(source, selection(2))

    await expectOneStep(
      session,
      {
        kind: 'convert-block',
        target: targetOf(session),
        conversion: { kind: 'blockquote' }
      },
      '> Body\r\n',
      source
    )
  })

  it('serializes every target block conversion as one exact undo step', async() => {
    const cases = [
      {
        source: '## Body\r\n',
        at: 4,
        conversion: { kind: 'paragraph' } as const,
        expected: 'Body\r\n'
      },
      {
        source: '## Body\r\n',
        at: 4,
        conversion: { kind: 'heading-shift', direction: 'promote' } as const,
        expected: '# Body\r\n'
      },
      {
        source: '## Body\r\n',
        at: 4,
        conversion: { kind: 'heading-shift', direction: 'demote' } as const,
        expected: '### Body\r\n'
      },
      {
        source: 'Body\r\n',
        at: 2,
        conversion: { kind: 'unordered-list' } as const,
        expected: '- Body\r\n'
      },
      {
        source: 'Body\r\n',
        at: 2,
        conversion: { kind: 'ordered-list' } as const,
        expected: '1. Body\r\n'
      },
      {
        source: 'Body\r\n',
        at: 2,
        conversion: { kind: 'task-list' } as const,
        expected: '- [ ] Body\r\n'
      },
      {
        source: 'Body\r\n',
        at: 2,
        conversion: { kind: 'code-block' } as const,
        expected: '```\r\nBody\r\n```\r\n'
      },
      {
        source: 'Body\r\n',
        at: 2,
        conversion: { kind: 'math-block' } as const,
        expected: '$$\r\nBody\r\n$$\r\n'
      },
      {
        source: 'Body\r\n',
        at: 2,
        conversion: { kind: 'html-block' } as const,
        expected: '<div>\r\nBody\r\n</div>\r\n'
      },
      {
        source: 'Body\r\n',
        at: 2,
        conversion: { kind: 'thematic-break' } as const,
        expected: '---\r\n'
      },
      {
        source: 'Body\r\n',
        at: 2,
        conversion: { kind: 'front-matter' } as const,
        expected: '---\r\nBody\r\n---\r\n'
      },
      {
        source: '> Body\r\n',
        at: 3,
        conversion: { kind: 'blockquote' } as const,
        expected: 'Body\r\n'
      },
      {
        source: '- one\r\n- two\r\n',
        at: 2,
        conversion: { kind: 'loose-list-item' } as const,
        expected: '- one\r\n\r\n- two\r\n'
      }
    ]

    for (const row of cases) {
      const session = await open(row.source, selection(row.at))
      await expectOneStep(
        session,
        {
          kind: 'convert-block',
          target: targetOf(session),
          conversion: row.conversion
        },
        row.expected,
        row.source
      )
    }
  })

  it('creates a thematic break in a whitespace-only document', async() => {
    const source = '\n'
    const session = await open(source, selection(0))

    await expectOneStep(
      session,
      {
        kind: 'convert-block',
        target: targetOf(session),
        conversion: { kind: 'thematic-break' }
      },
      '---\n',
      source
    )
  })

  it('creates a GFM table through one semantic intent and one undo step', async() => {
    const source = '\r\n'
    const session = await open(source, selection(0))

    await expectOneStep(
      session,
      {
        kind: 'create-table',
        target: targetOf(session),
        rows: 2,
        columns: 3
      },
      [
        '|   |   |   |',
        '| --- | --- | --- |',
        '|   |   |   |',
        ''
      ].join('\r\n'),
      source
    )
  })

  it('creates the minimum 1×1 GFM table through the ordinary table intent', async() => {
    const source = '\n'
    const session = await open(source, selection(0))

    await expectOneStep(
      session,
      {
        kind: 'create-table',
        target: targetOf(session),
        rows: 1,
        columns: 1
      },
      '|   |\n| --- |\n',
      source
    )
  })

  it('inserts a row after the selected table row as one exact undo step', async() => {
    const source = [
      '| a | b |',
      '| --- | --- |',
      '| c | d |',
      ''
    ].join('\n')
    const session = await open(source, selection(source.indexOf('c')))

    await expectOneStep(
      session,
      {
        kind: 'insert-table-row',
        target: targetOf(session),
        location: 'after'
      },
      [
        '| a | b |',
        '| --- | --- |',
        '| c | d |',
        '|   |   |',
        ''
      ].join('\n'),
      source
    )
  })

  it('tracks format and structural commands without splitting either undo step', async() => {
    const formatSource = 'Body'
    const formatSession = await open(
      formatSource,
      selection(0, 4),
      true
    )
    await expectOneStep(
      formatSession,
      {
        kind: 'format-text',
        target: targetOf(formatSession),
        format: 'emphasis'
      },
      '{++*++}Body{++*++}',
      formatSource
    )

    const blockSource = 'Body'
    const blockSession = await open(blockSource, selection(2), true)
    await expectOneStep(
      blockSession,
      {
        kind: 'convert-block',
        target: targetOf(blockSession),
        conversion: { kind: 'heading', level: 2 }
      },
      '{--Body--}{++## Body++}',
      blockSource
    )
  })

  it('sets the selected fenced code block language as one exact undo step', async() => {
    const source = '```js\r\nconst x = 1\r\n```\r\n'
    const session = await open(source, selection(2))

    await expectOneStep(
      session,
      {
        kind: 'set-code-language',
        target: targetOf(session),
        language: 'typescript'
      },
      '```typescript\r\nconst x = 1\r\n```\r\n',
      source,
      { anchor: 2, focus: 2 }
    )
  })

  it('creates a destination-bearing link as one exact undo step', async() => {
    const source = 'before word after'
    const session = await open(source, selection(7, 11))

    await expectOneStep(
      session,
      {
        kind: 'insert-link',
        target: targetOf(session),
        href: 'https://example.test/docs',
        title: 'Docs'
      },
      'before [word](https://example.test/docs "Docs") after',
      source,
      { anchor: 8, focus: 12 }
    )
  })

  it('inserts an image from semantic fields as one exact undo step', async() => {
    const source = 'See '
    const session = await open(source, selection(4))

    await expectOneStep(
      session,
      {
        kind: 'insert-image',
        target: targetOf(session),
        src: 'images/cat.png',
        alt: 'cat',
        title: 'Cat'
      },
      'See ![cat](images/cat.png "Cat")',
      source,
      { anchor: 32, focus: 32 }
    )
  })

  it('replaces the parser-owned image range as one exact undo step', async() => {
    const source = 'before ![old](assets/old.png "Old") after'
    const session = await open(source, selection(0))
    const snapshot = session.snapshot()
    if (snapshot.kind !== 'complete') {
      throw new Error('Expected a complete document snapshot')
    }
    const image = snapshot.editingDocument.references.linkAt(0)
    expect(image.node.kind).toBe('image')
    expect(image.node.nodeId).toEqual(expect.any(String))
    expect(image.node.range).toEqual({
      start: source.indexOf('![old]'),
      end: source.indexOf(' after')
    })
    const current = targetOf(session)

    await expectOneStep(
      session,
      {
        kind: 'insert-image',
        target: Object.freeze({
          ...current,
          anchor: Object.freeze({
            offset: image.node.range.start,
            affinity: 'next' as const
          }),
          focus: Object.freeze({
            offset: image.node.range.end,
            affinity: 'previous' as const
          })
        }),
        src: 'assets/new.png',
        alt: 'new',
        title: 'New'
      },
      'before ![new](assets/new.png "New") after',
      source
    )
  })

  it('inserts one reference and definition as one exact undo step', async() => {
    const source = 'Note'
    const session = await open(source, selection(4))

    await expectOneStep(
      session,
      {
        kind: 'insert-footnote',
        target: targetOf(session),
        label: 'n',
        content: 'body'
      },
      'Note[^n]\n\n[^n]: body\n',
      source,
      { anchor: 21, focus: 21 }
    )
  })

  it('indents and outdents a parser-owned list item as one exact undo step', async() => {
    const source = '- one\n- two\n'
    const indented = '- one\n  - two\n'
    const indentSession = await open(source, selection(source.indexOf('two')))

    await expectOneStep(
      indentSession,
      {
        kind: 'set-list-indentation',
        target: targetOf(indentSession),
        direction: 'increase'
      },
      indented,
      source,
      { anchor: 10, focus: 10 }
    )

    const outdentSession = await open(
      indented,
      selection(indented.indexOf('two'))
    )
    await expectOneStep(
      outdentSession,
      {
        kind: 'set-list-indentation',
        target: targetOf(outdentSession),
        direction: 'decrease'
      },
      source,
      indented,
      { anchor: 8, focus: 8 }
    )
  })

  it('inserts paragraph and line breaks with the owner EOL as one undo step', async() => {
    const source = 'one two\r\n'
    const paragraph = await open(source, selection(3))
    await expectOneStep(
      paragraph,
      {
        kind: 'insert-paragraph-break',
        target: targetOf(paragraph)
      },
      'one\r\n\r\n two\r\n',
      source,
      { anchor: 7, focus: 7 }
    )

    const line = await open(source, selection(3))
    await expectOneStep(
      line,
      {
        kind: 'insert-line-break',
        target: targetOf(line)
      },
      'one\r\n two\r\n',
      source,
      { anchor: 5, focus: 5 }
    )
  })
})

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
    limitsProfile: 'test-unbounded',
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

  it('replaces an authenticated slash query with one semantic block', async() => {
    const source = '/'
    const session = await open(source, selection(1))

    await expectOneStep(
      session,
      {
        kind: 'quick-insert-block',
        target: targetOf(session),
        conversion: { kind: 'heading', level: 1 }
      },
      '# ',
      source
    )
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

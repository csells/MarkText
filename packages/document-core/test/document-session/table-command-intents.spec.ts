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

describe('DocumentSession table command intents', () => {
  it('removes the selected data row as one exact undoable and redoable edit', async() => {
    const source = [
      '| head-a | head-b |',
      '| :--- | ---: |',
      '| one | two |',
      '| three | four |',
      ''
    ].join('\n')
    const expected = [
      '| head-a | head-b |',
      '| :--- | ---: |',
      '| three | four |',
      ''
    ].join('\n')
    const selectedOffset = source.indexOf('one')
    const session = await open(source, selection(selectedOffset))

    await expect(session.dispatch({
      kind: 'remove-table-row',
      target: targetOf(session)
    }).completion).resolves.toMatchObject({
      kind: 'committed',
      transition: {
        cause: 'source-edit',
        history: 'record'
      }
    })
    expect(session.snapshot().revision.source).toBe(expected)

    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(source)
    expect(session.snapshot().revision.selection).toMatchObject({
      anchor: { offset: selectedOffset, affinity: 'next' },
      focus: { offset: selectedOffset, affinity: 'next' }
    })

    await expect(session.dispatch({ kind: 'redo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(expected)
  })

  it('inserts a blank column left of the selected column across every row', async() => {
    const source = [
      '| head-a | head-b |',
      '| :--- | ---: |',
      '| one | two |',
      '| three | four |',
      ''
    ].join('\n')
    const expected = [
      '| head-a |   | head-b |',
      '| :--- | --- | ---: |',
      '| one |   | two |',
      '| three |   | four |',
      ''
    ].join('\n')
    const session = await open(source, selection(source.indexOf('head-b')))

    await expect(session.dispatch({
      kind: 'insert-table-column',
      target: targetOf(session),
      location: 'left'
    }).completion).resolves.toMatchObject({
      kind: 'committed',
      transition: {
        cause: 'source-edit',
        history: 'record'
      }
    })
    expect(session.snapshot().revision.source).toBe(expected)
  })

  it('removes the selected column across the complete table structure', async() => {
    const source = [
      '| head-a | head-b | head-c |',
      '| :--- | :---: | ---: |',
      '| one | two | three |',
      '| four | five | six |',
      ''
    ].join('\n')
    const expected = [
      '| head-a | head-c |',
      '| :--- | ---: |',
      '| one | three |',
      '| four | six |',
      ''
    ].join('\n')
    const session = await open(source, selection(source.indexOf('head-b')))

    await expect(session.dispatch({
      kind: 'remove-table-column',
      target: targetOf(session)
    }).completion).resolves.toMatchObject({
      kind: 'committed',
      transition: {
        cause: 'source-edit',
        history: 'record'
      }
    })
    expect(session.snapshot().revision.source).toBe(expected)
  })

  it('sets and clears the selected column alignment deterministically', async() => {
    const source = [
      '| a | b | c |',
      '| --- | --- | ---: |',
      '| one | two | three |',
      ''
    ].join('\n')
    const centered = [
      '| a | b | c |',
      '| --- | :---: | ---: |',
      '| one | two | three |',
      ''
    ].join('\n')
    const session = await open(source, selection(source.indexOf('| b |') + 2))

    await expect(session.dispatch({
      kind: 'align-table-column',
      target: targetOf(session),
      alignment: 'center'
    }).completion).resolves.toMatchObject({
      kind: 'committed'
    })
    expect(session.snapshot().revision.source).toBe(centered)

    await expect(session.dispatch({
      kind: 'align-table-column',
      target: targetOf(session),
      alignment: 'none'
    }).completion).resolves.toMatchObject({
      kind: 'committed'
    })
    expect(session.snapshot().revision.source).toBe(source)
  })

  it('moves a selected data row up without disturbing the header contract', async() => {
    const source = [
      '| h1 | h2 |',
      '| --- | --- |',
      '| one | two |',
      '| three | four |',
      '| five | six |',
      ''
    ].join('\n')
    const expected = [
      '| h1 | h2 |',
      '| --- | --- |',
      '| three | four |',
      '| one | two |',
      '| five | six |',
      ''
    ].join('\n')
    const session = await open(source, selection(source.indexOf('three')))

    await expect(session.dispatch({
      kind: 'move-table-row',
      target: targetOf(session),
      direction: 'up'
    }).completion).resolves.toMatchObject({
      kind: 'committed',
      transition: { history: 'record' }
    })
    expect(session.snapshot().revision.source).toBe(expected)
  })

  it('moves a selected column right with its cells and alignment', async() => {
    const source = [
      '| a | b | c |',
      '| :--- | :---: | ---: |',
      '| one | two | three |',
      '| four | five | six |',
      ''
    ].join('\n')
    const expected = [
      '| a | c | b |',
      '| :--- | ---: | :---: |',
      '| one | three | two |',
      '| four | six | five |',
      ''
    ].join('\n')
    const session = await open(
      source,
      selection(source.indexOf('| b |') + 2)
    )

    await expect(session.dispatch({
      kind: 'move-table-column',
      target: targetOf(session),
      direction: 'right'
    }).completion).resolves.toMatchObject({
      kind: 'committed',
      transition: { history: 'record' }
    })
    expect(session.snapshot().revision.source).toBe(expected)
  })

  it('deletes exactly the parser-owned rectangular cell selection', async() => {
    const source = [
      '| a | b | c |',
      '| --- | --- | --- |',
      '| one | two | three |',
      '| four | five | six |',
      '| seven | eight | nine |',
      ''
    ].join('\n')
    const expected = [
      '| a | b | c |',
      '| --- | --- | --- |',
      '| one |   |   |',
      '| four |   |   |',
      '| seven | eight | nine |',
      ''
    ].join('\n')
    const session = await open(
      source,
      selection(source.indexOf('two'), source.indexOf('six') + 3)
    )

    await expect(session.dispatch({
      kind: 'delete-table-cell-contents',
      target: targetOf(session)
    }).completion).resolves.toMatchObject({
      kind: 'committed',
      transition: { history: 'record' }
    })
    expect(session.snapshot().revision.source).toBe(expected)
  })

  it('removing the only rendered row removes the table block safely', async() => {
    const source = [
      'Before',
      '',
      '| only |',
      '| --- |',
      '',
      'After',
      ''
    ].join('\n')
    const expected = [
      'Before',
      '',
      'After',
      ''
    ].join('\n')
    const selectedOffset = source.indexOf('only')
    const session = await open(source, selection(selectedOffset))

    await expect(session.dispatch({
      kind: 'remove-table-row',
      target: targetOf(session)
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(expected)

    await session.dispatch({ kind: 'undo' }).completion
    expect(session.snapshot().revision.source).toBe(source)
    expect(session.snapshot().revision.selection).toMatchObject({
      anchor: { offset: selectedOffset },
      focus: { offset: selectedOffset }
    })
  })

  it('removing the only column removes the table block safely', async() => {
    const source = [
      'Before',
      '',
      '| h |',
      '| ---: |',
      '| value |',
      '',
      'After',
      ''
    ].join('\r\n')
    const expected = [
      'Before',
      '',
      'After',
      ''
    ].join('\r\n')
    const selectedOffset = source.indexOf('value')
    const session = await open(source, selection(selectedOffset))

    await expect(session.dispatch({
      kind: 'remove-table-column',
      target: targetOf(session)
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(expected)

    await session.dispatch({ kind: 'undo' }).completion
    expect(session.snapshot().revision.source).toBe(source)
    expect(session.snapshot().revision.selection).toMatchObject({
      anchor: { offset: selectedOffset },
      focus: { offset: selectedOffset }
    })
  })

  it('inserting a row before the header creates a valid new header row', async() => {
    const source = [
      '| h1 | h2 |',
      '| :--- | ---: |',
      '| one | two |',
      ''
    ].join('\n')
    const expected = [
      '|   |   |',
      '| :--- | ---: |',
      '| h1 | h2 |',
      '| one | two |',
      ''
    ].join('\n')
    const session = await open(source, selection(source.indexOf('h1')))

    await expect(session.dispatch({
      kind: 'insert-table-row',
      target: targetOf(session),
      location: 'before'
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(expected)
  })

  it('records a table structure rewrite as one exact Track Changes edit', async() => {
    const source = [
      '| a | b |',
      '| --- | --- |',
      '| one | two |',
      ''
    ].join('\n')
    const replacement = [
      '| a | b |',
      '| --- | :---: |',
      '| one | two |'
    ].join('\n')
    const expected =
      `{--${source.slice(0, -1)}--}{++${replacement}++}\n`
    const selectedOffset = source.indexOf('| b |') + 2
    const session = await open(source, selection(selectedOffset), true)

    await expect(session.dispatch({
      kind: 'align-table-column',
      target: targetOf(session),
      alignment: 'center'
    }).completion).resolves.toMatchObject({
      kind: 'committed',
      transition: { history: 'record' }
    })
    expect(session.snapshot().revision.source).toBe(expected)

    await session.dispatch({ kind: 'undo' }).completion
    expect(session.snapshot().revision.source).toBe(source)
    expect(session.snapshot().revision.selection).toMatchObject({
      anchor: { offset: selectedOffset },
      focus: { offset: selectedOffset }
    })
  })

  it('tracks removal of the final row as a deletion without an empty addition', async() => {
    const source = [
      '| only |',
      '| --- |',
      ''
    ].join('\n')
    const session = await open(
      source,
      selection(source.indexOf('only')),
      true
    )

    await expect(session.dispatch({
      kind: 'remove-table-row',
      target: targetOf(session)
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(
      `{--${source.slice(0, -1)}--}\n`
    )
  })

  it('edits a table already owned by an addition without nesting Track Changes', async() => {
    const table = [
      '| a | b |',
      '| --- | --- |',
      '| one | two |'
    ].join('\n')
    const replacement = [
      '| a | b |',
      '| --- | ---: |',
      '| one | two |'
    ].join('\n')
    const source = `{++${table}++}\n`
    const session = await open(
      source,
      selection(table.indexOf('| b |') + 2),
      true
    )

    await expect(session.dispatch({
      kind: 'align-table-column',
      target: targetOf(session),
      alignment: 'right'
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(`{++${replacement}++}\n`)
  })

  it('preserves an existing cell addition while moving its column', async() => {
    const source = [
      '| a | {++b++} |',
      '| :--- | ---: |',
      '| one | {++two++} |',
      ''
    ].join('\n')
    const projected = source
      .replaceAll('{++', '')
      .replaceAll('++}', '')
    const expected = [
      '| {++b++} | a |',
      '| ---: | :--- |',
      '| {++two++} | one |',
      ''
    ].join('\n')
    const selectedOffset = projected.indexOf('| b |') + 2
    const session = await open(
      source,
      selection(selectedOffset)
    )

    await expect(session.dispatch({
      kind: 'move-table-column',
      target: targetOf(session),
      direction: 'left'
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(expected)
    expect(session.snapshot().revision.selection).toMatchObject({
      anchor: { offset: 2, affinity: 'next' },
      focus: { offset: 2, affinity: 'next' }
    })

    await session.dispatch({ kind: 'undo' }).completion
    expect(session.snapshot().revision.source).toBe(source)
    expect(session.snapshot().revision.selection).toMatchObject({
      anchor: { offset: selectedOffset, affinity: 'next' },
      focus: { offset: selectedOffset, affinity: 'next' }
    })

    await session.dispatch({ kind: 'redo' }).completion
    expect(session.snapshot().revision.source).toBe(expected)
    expect(session.snapshot().revision.selection).toMatchObject({
      anchor: { offset: 2, affinity: 'next' },
      focus: { offset: 2, affinity: 'next' }
    })
  })

  it('retains nested cell changes when tracking a table rewrite', async() => {
    const source = [
      '| a | {++b++} |',
      '| --- | ---: |',
      '| one | {--two--} |',
      ''
    ].join('\n')
    const marked = source
      .replaceAll('{++', '')
      .replaceAll('++}', '')
      .replaceAll('{--', '')
      .replaceAll('--}', '')
    const replacement = [
      '| {++b++} | a |',
      '| ---: | --- |',
      '| {--two--} | one |'
    ].join('\n')
    const expected =
      `{--${source.slice(0, -1)}--}{++${replacement}++}\n`
    const session = await open(
      source,
      selection(marked.indexOf('b')),
      true
    )

    await expect(session.dispatch({
      kind: 'move-table-column',
      target: targetOf(session),
      direction: 'left'
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(expected)
  })

  it('preserves every existing change carrier while aligning a column', async() => {
    const source = [
      '| {--gone--} | {~~old~>new~~} | {==kept==} |',
      '| --- | --- | --- |',
      '| one | two | three |',
      ''
    ].join('\n')
    const expected = [
      '| {--gone--} | {~~old~>new~~} | {==kept==} |',
      '| --- | :---: | --- |',
      '| one | two | three |',
      ''
    ].join('\n')
    const session = await open(source, selection(0))
    const snapshot = session.snapshot()
    if (snapshot.kind !== 'complete') {
      throw new Error('Expected a complete table revision')
    }
    const markedText = snapshot.livePlan.runs
      .map((run) => run.text)
      .join('')
    session.select(selection(markedText.indexOf('new')))

    await expect(session.dispatch({
      kind: 'align-table-column',
      target: targetOf(session),
      alignment: 'center'
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(expected)
  })

  it('preserves a terminal cell addition when outer pipes are omitted', async() => {
    const source = [
      'a | {++b++}',
      '--- | ---:',
      'one | {++two++}',
      ''
    ].join('\n')
    const projected = source
      .replaceAll('{++', '')
      .replaceAll('++}', '')
    const expected = [
      '| {++b++} | a |',
      '| ---: | --- |',
      '| {++two++} | one |',
      ''
    ].join('\n')
    const session = await open(
      source,
      selection(projected.indexOf('b'))
    )

    await expect(session.dispatch({
      kind: 'move-table-column',
      target: targetOf(session),
      direction: 'left'
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(expected)
  })

  it('preserves a hidden terminal deletion when outer pipes are omitted', async() => {
    const source = [
      'a | b',
      '--- | ---:',
      'one | {--two--}',
      ''
    ].join('\n')
    const expected = [
      '| b | a |',
      '| ---: | --- |',
      '| {--two--} | one |',
      ''
    ].join('\n')
    const session = await open(source, selection(source.indexOf('b')))

    await expect(session.dispatch({
      kind: 'move-table-column',
      target: targetOf(session),
      direction: 'left'
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(expected)
  })

  it('rejects a change carrier that crosses table cell boundaries', async() => {
    const source = [
      '| {++a | b++} |',
      '| --- | --- |',
      '| one | two |',
      ''
    ].join('\n')
    const projected = source
      .replace('{++', '')
      .replace('++}', '')
    const session = await open(
      source,
      selection(projected.indexOf('a'))
    )

    await expect(session.dispatch({
      kind: 'move-table-column',
      target: targetOf(session),
      direction: 'right'
    }).completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'selection-crosses-syntax-boundary'
    })
    expect(session.snapshot().revision.source).toBe(source)
  })

  it('rejects a whole-table rewrite that would erase a hidden comment', async() => {
    const source = [
      '| a{>>private note<<} | b |',
      '| --- | --- |',
      '| one | two |',
      ''
    ].join('\n')
    const session = await open(source, selection(2))

    await expect(session.dispatch({
      kind: 'move-table-column',
      target: targetOf(session),
      direction: 'right'
    }).completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'hidden-comment-loss'
    })
    expect(session.snapshot().revision.source).toBe(source)
  })

  it('rejects malformed, cross-table, and out-of-bounds table targets', async() => {
    const paragraph = await open('plain text\n', selection(2))
    const wrongTargetIntents = [
      { kind: 'remove-table-row', target: targetOf(paragraph) },
      {
        kind: 'insert-table-column',
        target: targetOf(paragraph),
        location: 'right'
      },
      { kind: 'remove-table-column', target: targetOf(paragraph) },
      {
        kind: 'align-table-column',
        target: targetOf(paragraph),
        alignment: 'left'
      },
      {
        kind: 'move-table-row',
        target: targetOf(paragraph),
        direction: 'down'
      },
      {
        kind: 'move-table-column',
        target: targetOf(paragraph),
        direction: 'right'
      },
      {
        kind: 'delete-table-cell-contents',
        target: targetOf(paragraph)
      }
    ] as const
    for (const intent of wrongTargetIntents) {
      await expect(paragraph.dispatch(intent).completion)
        .resolves.toMatchObject({
          kind: 'rejected',
          reason: 'wrong-target-kind'
        })
      expect(paragraph.snapshot().revision.source).toBe('plain text\n')
    }

    const boundarySource = [
      '| a | b |',
      '| --- | --- |',
      '| one | two |',
      ''
    ].join('\n')
    const boundary = await open(
      boundarySource,
      selection(boundarySource.indexOf('a'))
    )
    await expect(boundary.dispatch({
      kind: 'move-table-column',
      target: targetOf(boundary),
      direction: 'left'
    }).completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'invalid-command-argument'
    })
    expect(boundary.snapshot().revision.source).toBe(boundarySource)

    const crossSource = [
      '| a |',
      '| --- |',
      '',
      '| b |',
      '| --- |',
      ''
    ].join('\n')
    const cross = await open(
      crossSource,
      selection(crossSource.indexOf('a'), crossSource.indexOf('b') + 1)
    )
    await expect(cross.dispatch({
      kind: 'delete-table-cell-contents',
      target: targetOf(cross)
    }).completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'wrong-target-kind'
    })
    expect(cross.snapshot().revision.source).toBe(crossSource)
  })

  it('preserves exact selection and one-step undo/redo for every table rewrite', async() => {
    const base = [
      '| a | b |',
      '| --- | --- |',
      '| one | two |',
      '| three | four |',
      ''
    ].join('\n')
    const rows = [
      {
        before: base.indexOf('one'),
        intent: (session: DocumentSession): EditorIntent => ({
          kind: 'insert-table-row',
          target: targetOf(session),
          location: 'before'
        }),
        expected: [
          '| a | b |',
          '| --- | --- |',
          '|   |   |',
          '| one | two |',
          '| three | four |',
          ''
        ].join('\n'),
        after: (source: string): number => source.indexOf('|   |   |') + 2
      },
      {
        before: base.indexOf('one'),
        intent: (session: DocumentSession): EditorIntent => ({
          kind: 'insert-table-row',
          target: targetOf(session),
          location: 'after'
        }),
        expected: [
          '| a | b |',
          '| --- | --- |',
          '| one | two |',
          '|   |   |',
          '| three | four |',
          ''
        ].join('\n'),
        after: (source: string): number => source.indexOf('|   |   |') + 2
      },
      {
        before: base.indexOf('one'),
        intent: (session: DocumentSession): EditorIntent => ({
          kind: 'remove-table-row',
          target: targetOf(session)
        }),
        expected: [
          '| a | b |',
          '| --- | --- |',
          '| three | four |',
          ''
        ].join('\n'),
        after: (source: string): number => source.indexOf('three')
      },
      {
        before: base.indexOf('| b |') + 2,
        intent: (session: DocumentSession): EditorIntent => ({
          kind: 'insert-table-column',
          target: targetOf(session),
          location: 'right'
        }),
        expected: [
          '| a | b |   |',
          '| --- | --- | --- |',
          '| one | two |   |',
          '| three | four |   |',
          ''
        ].join('\n'),
        after: (source: string): number => source.indexOf('| b |') + 2
      },
      {
        before: base.indexOf('| b |') + 2,
        intent: (session: DocumentSession): EditorIntent => ({
          kind: 'remove-table-column',
          target: targetOf(session)
        }),
        expected: [
          '| a |',
          '| --- |',
          '| one |',
          '| three |',
          ''
        ].join('\n'),
        after: (source: string): number => source.indexOf('a')
      },
      {
        before: base.indexOf('| b |') + 2,
        intent: (session: DocumentSession): EditorIntent => ({
          kind: 'align-table-column',
          target: targetOf(session),
          alignment: 'right'
        }),
        expected: [
          '| a | b |',
          '| --- | ---: |',
          '| one | two |',
          '| three | four |',
          ''
        ].join('\n'),
        after: (source: string): number => source.indexOf('| b |') + 2
      },
      {
        before: base.indexOf('three'),
        intent: (session: DocumentSession): EditorIntent => ({
          kind: 'move-table-row',
          target: targetOf(session),
          direction: 'up'
        }),
        expected: [
          '| a | b |',
          '| --- | --- |',
          '| three | four |',
          '| one | two |',
          ''
        ].join('\n'),
        after: (source: string): number => source.indexOf('three')
      },
      {
        before: base.indexOf('| b |') + 2,
        intent: (session: DocumentSession): EditorIntent => ({
          kind: 'move-table-column',
          target: targetOf(session),
          direction: 'left'
        }),
        expected: [
          '| b | a |',
          '| --- | --- |',
          '| two | one |',
          '| four | three |',
          ''
        ].join('\n'),
        after: (source: string): number => source.indexOf('b')
      },
      {
        before: base.indexOf('two'),
        end: base.indexOf('four') + 4,
        intent: (session: DocumentSession): EditorIntent => ({
          kind: 'delete-table-cell-contents',
          target: targetOf(session)
        }),
        expected: [
          '| a | b |',
          '| --- | --- |',
          '| one |   |',
          '| three |   |',
          ''
        ].join('\n'),
        after: (source: string): number =>
          source.indexOf('| one |   |') + 8
      }
    ] as const

    for (const row of rows) {
      const end = 'end' in row ? row.end : row.before
      const session = await open(base, selection(row.before, end))
      await expect(session.dispatch(row.intent(session)).completion)
        .resolves.toMatchObject({
          kind: 'committed',
          transition: { history: 'record' }
        })
      expect(session.snapshot().revision.source).toBe(row.expected)
      const after = row.after(row.expected)
      expect(session.snapshot().revision.selection).toMatchObject({
        anchor: { offset: after },
        focus: { offset: after }
      })

      await session.dispatch({ kind: 'undo' }).completion
      expect(session.snapshot().revision.source).toBe(base)
      expect(session.snapshot().revision.selection).toMatchObject({
        anchor: { offset: row.before },
        focus: { offset: end }
      })

      await session.dispatch({ kind: 'redo' }).completion
      expect(session.snapshot().revision.source).toBe(row.expected)
      expect(session.snapshot().revision.selection).toMatchObject({
        anchor: { offset: after },
        focus: { offset: after }
      })
    }
  })
})

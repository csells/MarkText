// @vitest-environment happy-dom
import {
  createDocumentSearchQuery,
  createSourceSnapshot
} from '@marktext/document-core'
import { describe, expect, it, vi } from 'vitest'
import {
  documentParseConfigurationFor as createDocumentParseConfiguration
} from 'main_renderer/documentCore/documentParseConfiguration'
import {
  createTestDocumentCoreSession
} from '../../../../document-view/src/documentCore/__tests__/testDocumentCoreSession'
import {
  installTestDocumentHostCapabilities
} from '../helpers/documentHostSession'
import {
  createDocumentEditorHost,
  type DocumentHostOptions
} from '@/components/editorWithTabs/documentCoreDesktopEditor'

const parseConfiguration = createDocumentParseConfiguration({
  footnotes: false,
  gitLabMath: false,
  subscriptAndSuperscript: false
})

const standaloneSession = async(
  source: string,
  configuration = parseConfiguration,
  clipboard: Readonly<{
    writeClipboardMaterialization?:
      DocumentHostOptions['session']['writeClipboardMaterialization']
    pasteText?: string
  }> = {}
): Promise<DocumentHostOptions['session']> => {
  const session = await createTestDocumentCoreSession(
    createSourceSnapshot(source),
    configuration
  )
  return installTestDocumentHostCapabilities(session, {
    writeClipboardMaterialization:
      clipboard.writeClipboardMaterialization ??
      (async() => Object.freeze({ kind: 'written' as const })),
    pasteClipboard: target => session.dispatch({
      kind: 'paste-text',
      target,
      payload: { kind: 'external-text' as const, text: clipboard.pasteText ?? '' }
    })
  })
}

describe('target document host', () => {
  it('publishes parser-owned blocks and selection through closed subscriptions', async() => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const host = await createDocumentEditorHost({
      element,
      session: await standaloneSession('# Title\n\n**word**\n'),
      configuration: {}
    })
    const selectionChanges = vi.fn()
    const subscription = host.subscribeSelection(selectionChanges)

    host.setSelection(11, 15)
    await host.settled()

    expect(host.snapshot().blocks).toEqual([
      expect.objectContaining({ kind: 'heading' }),
      expect.objectContaining({ kind: 'paragraph' })
    ])
    expect(host.selection()).toMatchObject({
      selectedText: 'word',
      activeInlineFormats: ['strong'],
      blockPath: [
        expect.objectContaining({ kind: 'paragraph' }),
        expect.objectContaining({ kind: 'strong' }),
        expect.objectContaining({ kind: 'text' })
      ]
    })
    expect(selectionChanges).toHaveBeenCalledWith(host.selection())

    subscription.dispose()
    expect(Object.keys(host)).not.toEqual(expect.arrayContaining([
      'kind',
      'on',
      'off',
      'getState',
      'quickInsert',
      'createTable'
    ]))
  })

  it('rejects option keys outside the closed target contract', async() => {
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session: await standaloneSession('text\n'),
      configuration: {}
    })

    expect(() => host.configure({ removedOption: true } as never))
      .toThrow(/Unknown document option: removedOption/)
  })

  it('opens with current grammar and appearance values before exposing the host', async() => {
    const element = document.createElement('div')
    const grammar = {
      footnotes: true,
      gitLabMath: false,
      subscriptAndSuperscript: false
    }
    const host = await createDocumentEditorHost({
      element,
      session: await standaloneSession(
        'note[^n]\n\n[^n]: body\n',
        createDocumentParseConfiguration(grammar)
      ),
      configuration: {
        fontSize: 19,
        editorLineWidth: '72ch',
        spellcheck: true,
        hideLinkTools: true
      }
    })

    expect(element.querySelector('.footnotes')).not.toBeNull()
    expect(element.style.getPropertyValue('--document-view-font-size')).toBe('19px')
    expect(element.style.getPropertyValue('--document-view-editor-area-width'))
      .toBe('calc(100px + 72ch)')
    expect(element.spellcheck).toBe(true)
    expect(element.classList.contains('document-view-hide-link-tools')).toBe(true)
    expect(host.snapshot().source).toBe('note[^n]\n\n[^n]: body\n')
  })

  it('rejects wrong-typed host-only option values', async() => {
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session: await standaloneSession('text\n'),
      configuration: {}
    })

    expect(() => host.configure({ criticMarkupTrackChanges: 'yes' } as never))
      .toThrow(/criticMarkupTrackChanges/)
    expect(() => host.configure({ criticMarkupProjection: 'clean' } as never))
      .toThrow(/criticMarkupProjection/)
    expect(() => host.configure({ fontSize: '19' } as never))
      .toThrow(/fontSize/)
    expect(() => host.configure({ editorLineWidth: '72em' }))
      .toThrow(/editorLineWidth/)
  })

  it('rejects incomplete or extended grammar configuration at runtime', () => {
    expect(() => createDocumentParseConfiguration({
      gitLabMath: false,
      subscriptAndSuperscript: false
    } as never)).toThrow(/footnotes/)
    expect(() => createDocumentParseConfiguration({
      footnotes: false,
      gitLabMath: false,
      subscriptAndSuperscript: false,
      extraGrammar: true
    } as never)).toThrow(/extraGrammar/)
  })

  it('routes source copy and images through typed core-owned operations', async() => {
    const writeClipboardMaterialization = vi.fn(async() =>
      Object.freeze({ kind: 'written' as const })
    )
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session: await standaloneSession('word', parseConfiguration, {
        writeClipboardMaterialization
      }),
      configuration: {}
    })

    await host.copySource({ start: 0, end: 4 })
    expect(writeClipboardMaterialization).toHaveBeenCalledWith({
      revisionId: host.snapshot().revisionId,
      consumer: 'copy-markdown',
      view: 'source',
      selection: { start: 0, end: 4 }
    })

    await host.selectSource({ anchor: 0, focus: 4 })
    await host.insertSourceImage({
      src: 'images/cat.png',
      alt: 'cat'
    })
    expect(host.getMarkdown()).toBe('![cat](images/cat.png)')
  })

  it('routes target tools and clipboard paste through closed semantic commands', async() => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const session = await standaloneSession(
      'before word after',
      parseConfiguration,
      { pasteText: 'pasted' }
    )
    const host = await createDocumentEditorHost({
      element,
      session,
      configuration: {}
    })
    host.setSelection(7, 11)
    await host.settled()
    await host.insertLink({
      href: 'https://example.test/docs',
      title: 'Docs'
    })
    expect(host.getMarkdown()).toBe(
      'before [word](https://example.test/docs "Docs") after'
    )
    expect(host.selection()).toMatchObject({
      anchor: { offset: 8 },
      focus: { offset: 12 }
    })
    await host.undo()
    expect(host.getMarkdown()).toBe('before word after')

    host.setSelection(17, 17)
    await host.settled()
    await host.insertFootnote({ label: 'n', content: 'body' })
    expect(host.getMarkdown()).toBe(
      'before word after[^n]\n\n[^n]: body\n'
    )
    await host.undo()
    expect(host.getMarkdown()).toBe('before word after')

    host.configure({ criticMarkupTrackChanges: true })
    await host.settled()
    host.setSelection(7, 11)
    await host.settled()
    await host.pasteAsPlainText()
    expect(host.getMarkdown()).toBe(
      'before {~~word~>pasted~~} after'
    )
    await host.undo()
    expect(host.getMarkdown()).toBe('before word after')

    host.configure({ criticMarkupTrackChanges: false })
    await host.settled()
    await host.editSource(
      0,
      host.getMarkdown().length,
      '```js\nconst x = 1\n```\n',
      { anchor: 0, focus: 0 }
    )
    host.setCursorByOffset(2)
    await host.settled()
    await host.setCodeLanguage('typescript')
    expect(host.getMarkdown()).toBe('```typescript\nconst x = 1\n```\n')
    await host.undo()
    expect(host.getMarkdown()).toBe('```js\nconst x = 1\n```\n')
  })

  it('requests only Table dimensions before committing the captured target', async() => {
    const requestTableShape = vi.fn(async() => ({ rows: 1, columns: 1 }))
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session: await standaloneSession('\n'),
      configuration: {},
      requestTableShape
    })
    host.setCursorByOffset(0)
    await host.settled()

    await host.requestTable()

    expect(requestTableShape).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(host.getMarkdown()).toBe('|   |\n| --- |\n')
    await host.undo()
    expect(host.getMarkdown()).toBe('\n')
    await host.redo()
    expect(host.getMarkdown()).toBe('|   |\n| --- |\n')
  })

  it('uses the active document-view locale for the pointer Review action', async() => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const host = await createDocumentEditorHost({
      element,
      session: await standaloneSession('before {++added++} after\n'),
      configuration: {}
    })
    const carrier = [...element.querySelectorAll<HTMLElement>('[data-model-start]')]
      .find((node) => node.textContent?.includes('added'))
    expect(carrier).toBeDefined()
    const elementFromPoint = vi.spyOn(document, 'elementFromPoint')
      .mockReturnValue(carrier ?? null)

    try {
      host.setLocale({
        name: 'review-test',
        resource: { Review: 'Réviser' }
      })
      element.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        clientX: 12,
        clientY: 18
      }))

      const button = document.querySelector<HTMLButtonElement>(
        '.document-view-critic-markup-review-tool button'
      )
      expect(button).not.toBeNull()
      expect(button?.textContent).toBe('Réviser')
      expect(button?.getAttribute('aria-label')).toBe('Réviser')

      host.setLocale({
        name: 'review-test-updated',
        resource: { Review: 'Examiner' }
      })
      expect(button?.textContent).toBe('Examiner')
      expect(button?.getAttribute('aria-label')).toBe('Examiner')
    } finally {
      elementFromPoint.mockRestore()
      await host.destroy()
      element.remove()
      document
        .querySelector('.document-view-critic-markup-review-tool')
        ?.remove()
    }
  })

  it('resolves a parser-created point Comment indicator by exact node identity', async() => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const host = await createDocumentEditorHost({
      element,
      session: await standaloneSession('before {>>note<<} after\n'),
      configuration: {}
    })
    const comment = host.getCriticMarkupReviewSnapshot().items.find(
      item => item.type === 'comment'
    )
    if (comment === undefined) throw new TypeError('Expected a point Comment')
    const indicator = element.querySelector<HTMLElement>(
      '.document-view-critic-comment-indicator'
    )
    expect(indicator?.dataset.criticCommentNodeId).toBe(comment.id)
    const elementFromPoint = vi.spyOn(document, 'elementFromPoint')
      .mockReturnValue(indicator)

    try {
      expect(host.getCriticMarkupCommentAtPoint(12, 18)).toEqual(comment)
    } finally {
      elementFromPoint.mockRestore()
      await host.destroy()
      element.remove()
    }
  })

  it('rejects stale Review identity when the same range belongs to a replacement node', async() => {
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session: await standaloneSession('{++a++} tail\n'),
      configuration: {}
    })
    const first = host.getCriticMarkupReviewSnapshot()
    expect(first.revisionId).toEqual(expect.any(String))
    const original = first.items[0]
    if (!original) throw new TypeError('Expected the original Review item')
    const staleTarget = Object.freeze({
      revisionId: first.revisionId,
      nodeId: original.id
    })

    await host.editSource(
      0,
      7,
      '{--a--}',
      { anchor: 10, focus: 10 }
    )
    await host.settled()
    const replacement = host.getCriticMarkupReviewSnapshot()
    expect(replacement.items[0]).toMatchObject({
      type: 'deletion',
      sourceStart: 0,
      sourceEnd: 7
    })
    const sourceBeforeCommands = host.getMarkdownSync()
    const selectionBeforeCommands = host.selection()

    expect(host.focusCriticMarkup(staleTarget)).toBeNull()
    await expect(host.resolveCriticMarkup('accept', staleTarget))
      .resolves.toBe(false)
    await host.settled()

    expect(host.getMarkdownSync()).toBe(sourceBeforeCommands)
    expect(host.selection()).toEqual(selectionBeforeCommands)
    expect(host.getCriticMarkupReviewSnapshot().items[0]?.type).toBe('deletion')

    const live = host.getCriticMarkupReviewSnapshot()
    const liveItem = live.items[0]
    if (!liveItem) throw new TypeError('Expected the replacement Review item')
    const extendedTarget = {
      revisionId: live.revisionId,
      nodeId: liveItem.id,
      sourceStart: liveItem.sourceStart
    }
    const liveTarget = {
      revisionId: live.revisionId,
      nodeId: liveItem.id
    }
    expect(host.navigateCriticMarkup('forged' as never)).toBeNull()
    await expect(host.resolveCriticMarkup('forged' as never, liveTarget))
      .resolves.toBe(false)
    await expect(host.editCriticMarkupComment(liveTarget, 7 as never))
      .resolves.toBe(false)
    expect(host.focusCriticMarkup(extendedTarget)).toBeNull()
    await expect(host.resolveCriticMarkup('accept', extendedTarget))
      .resolves.toBe(false)
    await host.settled()
    expect(host.getMarkdownSync()).toBe(sourceBeforeCommands)
  })

  it('authenticates a queued Review target against the revision that will execute it', async() => {
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session: await standaloneSession('{++a++} tail\n'),
      configuration: {}
    })
    const first = host.getCriticMarkupReviewSnapshot()
    const original = first.items[0]
    if (!original) throw new TypeError('Expected the original Review item')
    const target = Object.freeze({
      revisionId: first.revisionId,
      nodeId: original.id
    })

    const replacement = host.editSource(
      0,
      7,
      '{--a--}',
      { anchor: 10, focus: 10 }
    )
    const resolution = host.resolveCriticMarkup('accept', target)

    await replacement
    await expect(resolution).resolves.toBe(false)
    expect(host.getMarkdownSync()).toBe('{--a--} tail\n')
    expect(host.getCriticMarkupReviewSnapshot().items[0]?.type).toBe('deletion')
  })

  it('accepts a live Review target after switching to the Revised projection', async() => {
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session: await standaloneSession('{++new++}\n'),
      configuration: {}
    })

    await host.configure({ criticMarkupProjection: 'revised' })
    const revised = host.getCriticMarkupReviewSnapshot()
    const addition = revised.items[0]
    if (!addition) throw new TypeError('Expected an addition in Review')

    await expect(host.resolveCriticMarkup('accept', {
      revisionId: revised.revisionId,
      nodeId: addition.id
    })).resolves.toBe(true)
    await host.settled()

    expect(host.getMarkdownSync()).toBe('new\n')
    expect(host.getCriticMarkupReviewSnapshot().items).toEqual([])
    expect(host.getCriticMarkupReviewSnapshot().projection).toBe('marked')
  })

  it('rejects a Review target when the revision changes during projection handoff', async() => {
    const baseSession = await standaloneSession('{++new++}\n')
    let reportMarkedProjection: (() => void) | undefined
    const markedProjectionStarted = new Promise<void>((resolve) => {
      reportMarkedProjection = resolve
    })
    let releaseMarkedProjection: (() => void) | undefined
    const markedProjectionMayFinish = new Promise<void>((resolve) => {
      releaseMarkedProjection = resolve
    })
    const session = Object.freeze({
      ...baseSession,
      dispatch: async(intent: Parameters<typeof baseSession.dispatch>[0]) => {
        if (intent.kind === 'set-projection' && intent.projection === 'marked') {
          const result = await baseSession.dispatch(intent)
          reportMarkedProjection?.()
          await markedProjectionMayFinish
          return result
        }
        return baseSession.dispatch(intent)
      }
    })
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session,
      configuration: {}
    })
    await host.configure({ criticMarkupProjection: 'revised' })
    const revised = host.getCriticMarkupReviewSnapshot()
    const addition = revised.items[0]
    if (!addition) throw new TypeError('Expected an addition in Review')

    const resolution = host.resolveCriticMarkup('accept', {
      revisionId: revised.revisionId,
      nodeId: addition.id
    })
    await markedProjectionStarted

    const current = baseSession.snapshot()
    const end = current.source.length
    await expect(baseSession.dispatch({
      kind: 'edit-source',
      target: Object.freeze({
        ...current.sourceSelection,
        anchor: Object.freeze({ offset: end, affinity: 'next' }),
        focus: Object.freeze({ offset: end, affinity: 'next' })
      }),
      text: 'tail',
      selection: Object.freeze({
        anchor: Object.freeze({ offset: end + 4, affinity: 'next' }),
        focus: Object.freeze({ offset: end + 4, affinity: 'next' })
      })
    })).resolves.toMatchObject({ kind: 'committed' })
    const externallyChanged = baseSession.snapshot()
    if (externallyChanged.kind !== 'complete') {
      throw new TypeError('Expected a complete externally changed revision')
    }
    expect(
      externallyChanged.reviewIndex.items.find(
        item => item.kind === 'addition'
      )?.nodeId
    ).toBe(addition.id)

    releaseMarkedProjection?.()
    await expect(resolution).resolves.toBe(false)
    expect(host.getMarkdownSync()).toBe('{++new++}\ntail')
  })

  it('reports a rejected main-owned comment edit as a failed terminal outcome', async() => {
    const source = '{==a==}{>>note<<}\n'
    const baseSession = await standaloneSession(source)
    const session = Object.freeze({
      ...baseSession,
      dispatch: async(intent: Parameters<typeof baseSession.dispatch>[0]) => {
        if (intent.kind === 'edit-comment') {
          return Object.freeze({
            kind: 'rejected' as const,
            reason: 'precommit-failed' as const
          })
        }
        return baseSession.dispatch(intent)
      }
    })
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session,
      configuration: {}
    })
    const snapshot = host.getCriticMarkupReviewSnapshot()
    const comment = snapshot.items.find(item => item.type === 'comment')
    if (!comment) throw new TypeError('Expected the Review comment')

    const completion = host.editCriticMarkupComment({
      revisionId: snapshot.revisionId,
      nodeId: comment.id
    }, 'edited')

    await expect(completion).rejects.toThrow('precommit-failed')
    expect(host.getMarkdownSync()).toBe(source)
  })

  it('terminates a hostile comment rejection and accepts the corrected retry', async() => {
    const opaqueLiteral = '`<<\\}`'
    const source = `{==reviewed==}{>>outer ${opaqueLiteral} tail<<}\n`
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session: await standaloneSession(source),
      configuration: {}
    })
    const snapshot = host.getCriticMarkupReviewSnapshot()
    const comment = snapshot.items.find(item => item.type === 'comment')
    if (!comment) throw new TypeError('Expected the Review comment')
    const target = {
      revisionId: snapshot.revisionId,
      nodeId: comment.id
    }

    await expect(host.editCriticMarkupComment(
      target,
      'bad <<} tail'
    )).rejects.toThrow()
    expect(host.getMarkdownSync()).toBe(source)

    await expect(host.editCriticMarkupComment(
      target,
      `edited ${opaqueLiteral} note`
    )).resolves.toBe(true)
    await host.settled()
    expect(host.getMarkdownSync()).toBe(
      `{==reviewed==}{>>edited ${opaqueLiteral} note<<}\n`
    )
  })

  it('edits a live comment after switching to the Original projection', async() => {
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session: await standaloneSession('{==a==}{>>note<<}\n'),
      configuration: {}
    })

    await host.configure({ criticMarkupProjection: 'original' })
    const original = host.getCriticMarkupReviewSnapshot()
    const comment = original.items.find(item => item.type === 'comment')
    if (!comment) throw new TypeError('Expected the Review comment')

    await expect(host.editCriticMarkupComment({
      revisionId: original.revisionId,
      nodeId: comment.id
    }, 'edited')).resolves.toBe(true)
    await host.settled()

    expect(host.getMarkdownSync()).toBe('{==a==}{>>edited<<}\n')
    expect(host.getCriticMarkupReviewSnapshot().projection).toBe('marked')
  })

  it('reports CriticMarkup authoring only after the main-owned edit commits', async() => {
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session: await standaloneSession('word'),
      configuration: {}
    })
    host.setSelection(0, 4)
    await host.settled()

    const completion = host.createCriticMarkup({ type: 'highlight' })

    await expect(completion).resolves.toBe(true)
    expect(host.getMarkdownSync()).toBe('{==word==}')
  })

  it('reports bulk Review resolution only after every change commits', async() => {
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session: await standaloneSession('{++a++} {--b--}'),
      configuration: {}
    })

    const completion = host.resolveAllCriticMarkup('accept')

    await expect(completion).resolves.toBe(2)
    expect(host.getMarkdownSync()).toBe('a ')
  })

  it('resolves all Review changes after switching to the Revised projection', async() => {
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session: await standaloneSession('{++a++} {--b--}'),
      configuration: {}
    })
    await host.configure({ criticMarkupProjection: 'revised' })

    await expect(host.resolveAllCriticMarkup('accept')).resolves.toBe(2)
    await host.settled()

    expect(host.getMarkdownSync()).toBe('a ')
    expect(host.getCriticMarkupReviewSnapshot().projection).toBe('marked')
  })

  it('settles replace all before publishing its new search state', async() => {
    const source = 'one two one three one\n'
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session: await standaloneSession(source),
      configuration: {}
    })
    const query = createDocumentSearchQuery('one')
    expect(host.search(query).matches).toHaveLength(3)

    const result = await host.replace('many', {
      isSingle: false,
      query
    })

    expect(result.matches).toEqual([])
    expect(host.getMarkdown()).toBe('many two many three many\n')
    await host.undo()
    expect(host.getMarkdown()).toBe(source)
  })

  it('replaces parser-visible matches across inline nodes in one host Undo', async() => {
    const source = '**o**ne and o**ne**\n'
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session: await standaloneSession(source),
      configuration: {}
    })
    const query = createDocumentSearchQuery('one')
    expect(host.search(query).matches).toHaveLength(2)

    const result = await host.replace('many', {
      isSingle: false,
      query
    })

    expect(result.matches).toEqual([])
    expect(host.getMarkdown()).toBe('**many** and many\n')
    await host.undo()
    expect(host.getMarkdown()).toBe(source)
  })

  it('uses the exact Find query for Replace All', async() => {
    const source = 'Apple apple applepie\n'
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session: await standaloneSession(source),
      configuration: {}
    })
    const query = createDocumentSearchQuery('apple', {
      wholeWord: true
    })

    expect(host.search(query).matches).toHaveLength(2)
    const result = await host.replace('pear', {
      isSingle: false,
      query
    })

    expect(result.matches).toEqual([])
    expect(host.getMarkdown()).toBe('pear pear applepie\n')
    await host.undo()
    expect(host.getMarkdown()).toBe(source)
  })

  it('resolves disposal only after the owned session has closed', async() => {
    let reportCloseStarted: (() => void) | undefined
    const closeStarted = new Promise<void>((resolve) => {
      reportCloseStarted = resolve
    })
    let releaseClose: (() => void) | undefined
    const closeMayFinish = new Promise<void>((resolve) => {
      releaseClose = resolve
    })
    const session = await standaloneSession('text\n')
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session: Object.freeze({
        ...session,
        close: async() => {
          reportCloseStarted?.()
          await closeMayFinish
          await session.close()
        }
      }),
      configuration: {}
    })

    const destroyed = host.destroy()
    await closeStarted
    let resolved = false
    const observed = destroyed.then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)

    releaseClose?.()
    await observed
    expect(resolved).toBe(true)
    await expect(host.destroy()).resolves.toBeUndefined()
  })

  it('persists canonical-source cursors across nested hidden CriticMarkup', async() => {
    const source =
      'before {==outer {++inner++} tail==}{>>note<<} after\n'
    const host = await createDocumentEditorHost({
      element: document.createElement('div'),
      session: await standaloneSession(source),
      configuration: {}
    })

    host.setSelection(13, 18)
    await host.settled()
    const persistedSelection = host.getCursorOffset()
    expect(persistedSelection).toEqual({
      anchor: { line: 0, ch: 19 },
      focus: { line: 0, ch: 24 }
    })

    host.setSelection(0, 0)
    await host.settled()
    host.setCursorByOffset(persistedSelection)
    await host.settled()
    expect(host.selection()).toMatchObject({
      anchor: { offset: 13 },
      focus: { offset: 18 },
      selectedText: 'inner'
    })

    host.setSelection(18, 18)
    await host.settled()
    const persistedCaret = host.getCursorOffset()
    expect(persistedCaret).toEqual({
      anchor: { line: 0, ch: 27 },
      focus: { line: 0, ch: 27 }
    })
    host.setSelection(0, 0)
    await host.settled()
    host.setCursorByOffset(persistedCaret)
    await host.settled()
    expect(host.selection()).toMatchObject({
      anchor: { offset: 18 },
      focus: { offset: 18 }
    })
  })
})

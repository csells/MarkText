// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  createMainDocumentParseConfiguration as createDocumentParseConfiguration
} from 'main_renderer/documentCore/documentParseConfiguration'
import {
  createSourceSnapshot,
  type ClipboardConsumerRequest
} from '@marktext/document-core'
import {
  createTestDocumentCoreSession
} from '../../../../document-view/src/documentCore/__tests__/testDocumentCoreSession'
import {
  installTestDocumentHostCapabilities
} from '../helpers/documentHostSession'
import {
  createDocumentEditorHost,
  type DocumentEditorHost
} from '@/components/editorWithTabs/documentCoreDesktopEditor'

describe('document-core desktop owner', () => {
  const createTestDocumentHost = (options: {
    host: HTMLElement
    source: ReturnType<typeof createSourceSnapshot>
    pasteText: () => string | Promise<string>
    clipboardWrite?: (
      request: ClipboardConsumerRequest & Readonly<{ revisionId: string }>
    ) => Promise<void>
  }): Promise<DocumentEditorHost> => createTestDocumentCoreSession(
    options.source,
    createDocumentParseConfiguration({
      footnotes: false,
      gitLabMath: false,
      subscriptAndSuperscript: false
    })
  ).then(session => createDocumentEditorHost({
    element: options.host,
    session: installTestDocumentHostCapabilities(session, {
      pasteClipboard: async target => await session.dispatch({
        kind: 'paste-text',
        target,
        text: await options.pasteText(),
        source: 'external-text'
      }),
      writeClipboardMaterialization: async request => {
        await options.clipboardWrite?.(request)
        if (
          request.consumer !== 'cut' &&
          request.consumer !== 'cut-table'
        ) {
          return Object.freeze({ kind: 'written' as const })
        }
        const snapshot = session.snapshot()
        if (snapshot.kind !== 'complete') {
          throw new Error('Test cut requires a complete snapshot')
        }
        const result = request.view === 'source'
          ? await session.dispatch({
            kind: 'edit-source',
            target: Object.freeze({
              session: snapshot.sourceSelection.session,
              revision: snapshot.sourceSelection.revision,
              view: 'source' as const,
              anchor: Object.freeze({
                offset: request.selection.start,
                affinity: 'next' as const
              }),
              focus: Object.freeze({
                offset: request.selection.end,
                affinity: 'previous' as const
              })
            }),
            text: '',
            selection: Object.freeze({
              anchor: Object.freeze({
                offset: request.selection.start,
                affinity: 'next' as const
              }),
              focus: Object.freeze({
                offset: request.selection.start,
                affinity: 'next' as const
              })
            })
          })
          : await session.dispatch({
            kind: 'delete-text',
            target: snapshot.selection
          })
        if (result.kind !== 'committed') {
          throw new Error(`Test cut did not commit: ${result.kind}`)
        }
        return Object.freeze({ kind: 'cut-committed' as const })
      }
    }),
    configuration: {}
  }))

  const selectText = (
    host: HTMLElement,
    startText: string,
    endText = startText
  ): void => {
    const nodes: Text[] = []
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    const startNode = nodes.find(node => node.data.includes(startText))
    const endNode = [...nodes].reverse().find(node => node.data.includes(endText))
    if (startNode === undefined || endNode === undefined) {
      throw new Error(`Could not select ${startText} through ${endText}`)
    }
    const range = document.createRange()
    range.setStart(startNode, startNode.data.indexOf(startText))
    range.setEnd(
      endNode,
      endNode.data.lastIndexOf(endText) + endText.length
    )
    const selection = document.getSelection()
    if (selection === null) throw new Error('Expected a browser Selection')
    selection.removeAllRanges()
    selection.addRange(range)
  }

  it('owns browser input and canonical source without constructing another document authority', async() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const onChange = vi.fn()
    const editor = await createTestDocumentHost({
      host,
      source: createSourceSnapshot('Hello'),
      pasteText: () => ''
    })
    editor.subscribeDocumentChange(onChange)

    const text = host.querySelector('.document-view-run')?.firstChild
    expect(text).toBeInstanceOf(Text)
    if (!(text instanceof Text)) {
      throw new TypeError('The rendered run did not contain a text node')
    }
    const range = document.createRange()
    range.setStart(text, text.textContent?.length ?? 0)
    range.collapse(true)
    const selection = document.getSelection()
    if (selection === null) {
      throw new Error('The test document has no Selection')
    }
    selection.removeAllRanges()
    selection.addRange(range)

    host.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: '!'
    }))
    await editor.settled()

    expect(editor.getMarkdown()).toBe('Hello!')
    expect(host.textContent).toBe('Hello!')
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('settles an admitted browser edit before a Review selection refresh', async() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const authority = await createTestDocumentCoreSession(
      createSourceSnapshot('Hello'),
      createDocumentParseConfiguration({
        footnotes: false,
        gitLabMath: false,
        subscriptAndSuperscript: false
      })
    )
    let releaseDispatch = (): void => undefined
    const deliveryGate = new Promise<void>(resolve => {
      releaseDispatch = resolve
    })
    let pendingDispatch = Promise.resolve()
    let selectRequests = 0
    const delayedSession = Object.freeze({
      ...authority,
      dispatch: (
        intent: Parameters<typeof authority.dispatch>[0]
      ) => {
        const delivered = authority.dispatch(intent).then(async(result) => {
          await deliveryGate
          return result
        })
        pendingDispatch = delivered.then(
          () => undefined,
          () => undefined
        )
        return delivered
      },
      select: async(
        selection: Parameters<typeof authority.select>[0]
      ): Promise<void> => {
        selectRequests += 1
        await pendingDispatch
        await authority.select(selection)
      }
    })
    const editor = await createDocumentEditorHost({
      element: host,
      session: installTestDocumentHostCapabilities(delayedSession, {
        pasteClipboard: async() => {
          throw new Error('The Review refresh test cannot paste')
        },
        writeClipboardMaterialization: async() =>
          Object.freeze({ kind: 'written' as const })
      }),
      configuration: {}
    })
    const text = host.querySelector('.document-view-run')?.firstChild
    if (!(text instanceof Text)) {
      throw new TypeError('Expected the rendered text carrier')
    }
    const range = document.createRange()
    range.setStart(text, text.length)
    range.collapse(true)
    const selection = document.getSelection()
    if (selection === null) throw new Error('Expected a browser Selection')
    selection.removeAllRanges()
    selection.addRange(range)
    await editor.commitAuthoringSelection()
    selectRequests = 0

    host.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteContentBackward'
    }))
    const reviewRefresh = editor.commitAuthoringSelection()
    await Promise.resolve()
    expect(selectRequests).toBe(0)
    releaseDispatch()

    await expect(reviewRefresh).resolves.toBeUndefined()
    expect(selectRequests).toBe(1)
    await editor.settled()
    expect(editor.getMarkdownSync()).toBe('Hell')
    expect(editor.selection()).toMatchObject({
      anchor: { offset: 4 },
      focus: { offset: 4 }
    })
    await editor.destroy()
  })

  it('routes every desktop editor command through one typed undoable intent', async() => {
    const cases = [
      {
        source: 'Body',
        run: (editor: DocumentEditorHost) =>
          editor.convertBlock({ kind: 'heading', level: 2 }),
        expected: '## Body'
      },
      {
        source: 'Body',
        run: (editor: DocumentEditorHost) => editor.duplicateBlock(),
        expected: 'Body\n\nBody'
      },
      {
        source: 'Body',
        run: (editor: DocumentEditorHost) => editor.deleteBlock(),
        expected: ''
      },
      {
        source: 'Body',
        run: (editor: DocumentEditorHost) =>
          editor.insertParagraph('after'),
        expected: 'Body\n'
      }
    ]

    for (const row of cases) {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const editor = await createTestDocumentHost({
        host,
        source: createSourceSnapshot(row.source),
        pasteText: () => ''
      })
      ;(editor.setCursorByOffset as (offset: number) => void)(1)
      await editor.settled()
      await row.run(editor)
      await editor.settled()
      expect(editor.getMarkdownSync()).toBe(row.expected)
      await (editor.undo as () => Promise<void>)()
      expect(editor.getMarkdownSync()).toBe(row.source)
      editor.destroy()
    }

    const formatHost = document.createElement('div')
    document.body.appendChild(formatHost)
    const formatEditor = await createTestDocumentHost({
      host: formatHost,
      source: createSourceSnapshot('Body'),
      pasteText: () => ''
    })
    selectText(formatHost, 'Body')
    await formatEditor.commitAuthoringSelection()
    await formatEditor.formatText('strong')
    expect(formatEditor.getMarkdownSync()).toBe('**Body**')
    await (formatEditor.undo as () => Promise<void>)()
    expect(formatEditor.getMarkdownSync()).toBe('Body')
  })

  it('delegates the Image draft to the target-owned view without an eager edit', async() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = await createTestDocumentHost({
      host,
      source: createSourceSnapshot('See '),
      pasteText: () => ''
    })
    editor.setCursorByOffset(4)
    await editor.settled()

    await editor.openImageSelector()

    const selector = host.querySelector<HTMLFormElement>(
      '.document-view-image-selector'
    )
    const src = selector?.querySelector<HTMLInputElement>('input.src')
    const alt = selector?.querySelector<HTMLInputElement>('input.alt')
    expect(document.activeElement).toBe(src)
    expect(editor.getMarkdownSync()).toBe('See ')
    if (selector === null || src == null || alt == null) {
      throw new Error('Expected the target-owned Image selector')
    }
    src.value = 'images/cat.png'
    alt.value = 'cat'
    selector.dispatchEvent(new Event('submit', {
      bubbles: true,
      cancelable: true
    }))
    await editor.settled()

    expect(editor.getMarkdownSync()).toBe('See ![cat](images/cat.png)')
    await editor.undo()
    expect(editor.getMarkdownSync()).toBe('See ')
  })

  it('hands selected clipboard consumers to the installed host sink', async() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const writes: unknown[] = []
    const editor = await createTestDocumentHost({
      host,
      source: createSourceSnapshot('word'),
      pasteText: () => '',
      clipboardWrite: async(request) => {
        writes.push(request)
      }
    })
    selectText(host, 'word')

    for (const operation of [
      'copyAsMarkdown',
      'copyAsHtml',
      'copyAsRich'
    ] as const) {
      await editor[operation]()
    }

    expect(writes).toEqual([
      {
        revisionId: expect.any(String),
        consumer: 'copy-markdown',
        view: 'markup',
        selection: { start: 0, end: 4 }
      },
      {
        revisionId: expect.any(String),
        consumer: 'copy-html',
        view: 'markup',
        selection: { start: 0, end: 4 }
      },
      {
        revisionId: expect.any(String),
        consumer: 'copy-rich',
        view: 'markup',
        selection: { start: 0, end: 4 }
      }
    ])
  })

  it('routes real native copy, cut, and paste gestures through the main/core port', async() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const writes: unknown[] = []
    const editor = await createTestDocumentHost({
      host,
      source: createSourceSnapshot('Hello'),
      pasteText: () => ' world',
      clipboardWrite: async(request) => {
        writes.push(request)
      }
    })

    selectText(host, 'ell')
    const copy = new Event('copy', { bubbles: true, cancelable: true })
    expect(host.dispatchEvent(copy)).toBe(false)
    await editor.settled()
    expect(writes.at(-1)).toMatchObject({
      revisionId: expect.any(String),
      consumer: 'normal-copy',
      view: 'markup',
      selection: { start: 1, end: 4 }
    })
    expect(editor.getMarkdownSync()).toBe('Hello')

    selectText(host, 'ell')
    const cut = new Event('cut', { bubbles: true, cancelable: true })
    expect(host.dispatchEvent(cut)).toBe(false)
    await editor.settled()
    expect(writes.at(-1)).toMatchObject({
      revisionId: expect.any(String),
      consumer: 'cut',
      view: 'markup',
      selection: { start: 1, end: 4 }
    })
    expect(editor.getMarkdownSync()).toBe('Ho')
    await editor.undo()
    expect(editor.getMarkdownSync()).toBe('Hello')

    ;(editor.setCursorByOffset as (offset: number) => void)(5)
    await editor.settled()
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    expect(host.dispatchEvent(paste)).toBe(false)
    await editor.settled()
    expect(editor.getMarkdownSync()).toBe('Hello world')
    await editor.undo()
    expect(editor.getMarkdownSync()).toBe('Hello')
  })

  it('delegates Source cut as one main/core transaction', async() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const writes: unknown[] = []
    const editor = await createTestDocumentHost({
      host,
      source: createSourceSnapshot('Hello'),
      pasteText: () => '',
      clipboardWrite: async request => {
        writes.push(request)
      }
    })

    await editor.cutSource({ start: 1, end: 4 })

    expect(writes).toEqual([{
      revisionId: expect.any(String),
      consumer: 'cut',
      view: 'source',
      selection: { start: 1, end: 4 }
    }])
    expect(editor.getMarkdownSync()).toBe('Ho')
    await editor.undo()
    expect(editor.getMarkdownSync()).toBe('Hello')
  })

  it('delegates Source paste without receiving clipboard material', async() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = await createTestDocumentHost({
      host,
      source: createSourceSnapshot('Hello'),
      pasteText: () => 'trusted'
    })

    await editor.pasteSourceClipboard({ anchor: 1, focus: 4 })

    expect(editor.getMarkdownSync()).toBe('Htrustedo')
    await editor.undo()
    expect(editor.getMarkdownSync()).toBe('Hello')
  })

  it('publishes Review state and routes Review actions through typed intents', async() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = await createTestDocumentHost({
      host,
      source: createSourceSnapshot(
        'A {++new++} {--old--} {==anchor==}{>>note<<}'
      ),
      pasteText: () => ''
    })

    expect(editor.getCriticMarkupReviewSnapshot()).toMatchObject({
      trackChanges: false,
      projection: 'marked',
      canCreateAddition: false,
      canCreateComment: false,
      canNavigate: true,
      canResolveAll: true,
      items: [
        { type: 'addition', content: 'new' },
        { type: 'deletion', content: 'old' },
        {
          type: 'comment',
          content: 'note',
          anchorText: 'anchor'
        }
      ]
    })

    await editor.configure({ criticMarkupTrackChanges: true })
    expect(editor.getCriticMarkupReviewSnapshot().trackChanges).toBe(true)

    const additionSnapshot = editor.getCriticMarkupReviewSnapshot()
    const addition = additionSnapshot.items[0]
    if (addition === undefined) throw new Error('Expected an addition')
    await expect(editor.resolveCriticMarkup('accept', {
      revisionId: additionSnapshot.revisionId,
      nodeId: addition.id
    })).resolves.toBe(true)
    expect(editor.getMarkdownSync()).toBe(
      'A new {--old--} {==anchor==}{>>note<<}'
    )

    const commentSnapshot = editor.getCriticMarkupReviewSnapshot()
    const comment = commentSnapshot.items.find(
      (item) => item.type === 'comment'
    )
    if (comment === undefined) throw new Error('Expected a comment')
    const commentTarget = {
      revisionId: commentSnapshot.revisionId,
      nodeId: comment.id
    }
    expect(editor.focusCriticMarkup(commentTarget)?.id).toBe(comment.id)
    expect(editor.getCriticMarkupReviewSnapshot().currentItemId).toBe(comment.id)
    await expect(editor.editCriticMarkupComment(commentTarget, 'edited'))
      .resolves.toBe(true)
    expect(editor.getMarkdownSync()).toContain('{>>edited<<}')

    await expect(editor.resolveAllCriticMarkup('reject')).resolves.toBe(1)
    expect(editor.getMarkdownSync()).toBe(
      'A new old {==anchor==}{>>edited<<}'
    )

    const editedSnapshot = editor.getCriticMarkupReviewSnapshot()
    const editedComment = editedSnapshot.items.find(
      (item) => item.type === 'comment'
    )
    if (editedComment === undefined) throw new Error('Expected edited comment')
    await expect(editor.resolveCriticMarkup('accept', {
      revisionId: editedSnapshot.revisionId,
      nodeId: editedComment.id
    })).resolves.toBe(true)
    expect(editor.getMarkdownSync()).toBe('A new old anchor')
  })

  it('authors CriticMarkup through semantic session intents', async() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = await createTestDocumentHost({
      host,
      source: createSourceSnapshot('word'),
      pasteText: () => ''
    })

    const range = document.createRange()
    range.selectNodeContents(host)
    const selection = document.getSelection()
    if (selection === null) throw new Error('Expected a browser Selection')
    selection.removeAllRanges()
    selection.addRange(range)
    editor.commitAuthoringSelection()
    await editor.settled()
    expect(editor.getCriticMarkupReviewSnapshot()).toMatchObject({
      canCreateAddition: true,
      canCreateDeletion: true,
      canCreateSubstitution: true,
      canCreateHighlight: true,
      canCreateComment: true
    })
    await expect(editor.createCriticMarkup({
      type: 'substitution',
      replacement: 'term'
    })).resolves.toBe(true)

    expect(editor.getMarkdownSync()).toBe('{~~word~>term~~}')
    expect(editor.getCriticMarkupReviewSnapshot().items).toMatchObject([
      {
        type: 'substitution',
        oldContent: 'word',
        newContent: 'term'
      }
    ])
    await (editor.undo as () => Promise<void>)()
    await editor.settled()
    expect(editor.getMarkdownSync()).toBe('word')

    ;(editor.setCursorByOffset as (offset: number) => void)(2)
    await editor.settled()
    expect(editor.getCriticMarkupReviewSnapshot()).toMatchObject({
      canCreateAddition: false,
      canCreateDeletion: false,
      canCreateSubstitution: false,
      canCreateHighlight: false,
      canCreateComment: false
    })
    await expect(editor.createCriticMarkup({
      type: 'comment',
      comment: '   '
    })).resolves.toBe(false)
  })

  it('focuses point Comments only after an explicit deterministic handoff', async() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = await createTestDocumentHost({
      host,
      source: createSourceSnapshot('{>>note<<}A'),
      pasteText: () => ''
    })
    const snapshot = editor.getCriticMarkupReviewSnapshot()
    const comment = snapshot.items[0]
    if (comment === undefined) throw new Error('Expected a point Comment')

    expect(snapshot.currentItemId).toBeNull()
    expect(editor.focusCriticMarkup({
      revisionId: snapshot.revisionId,
      nodeId: comment.id
    })?.id).toBe(comment.id)
    expect(editor.getCriticMarkupReviewSnapshot().currentItemId).toBe(comment.id)
  })

  it('does not advertise authoring across an invisible Comment boundary', async() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = await createTestDocumentHost({
      host,
      source: createSourceSnapshot('first {>>hidden<<} tail'),
      pasteText: () => ''
    })

    const range = document.createRange()
    range.selectNodeContents(host)
    const selection = document.getSelection()
    if (selection === null) throw new Error('Expected a browser Selection')
    selection.removeAllRanges()
    selection.addRange(range)
    editor.commitAuthoringSelection()
    await editor.settled()
    expect(editor.getCriticMarkupReviewSnapshot()).toMatchObject({
      canCreateAddition: false,
      canCreateDeletion: false,
      canCreateSubstitution: false,
      canCreateHighlight: false,
      canCreateComment: false
    })
  })

  it('publishes the deepest visible Review owner for a passive selection', async() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = await createTestDocumentHost({
      host,
      source: createSourceSnapshot('{==outer {++deep++}==}{>>note<<}'),
      pasteText: () => ''
    })

    selectText(host, 'deep')
    await editor.commitAuthoringSelection()

    const snapshot = editor.getCriticMarkupReviewSnapshot()
    expect(snapshot.items.find(item => item.id === snapshot.currentItemId))
      .toMatchObject({
        type: 'addition',
        content: 'deep'
      })
  })

  it('replaces an earlier selection with a cross-block invalid target', async() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = await createTestDocumentHost({
      host,
      source: createSourceSnapshot(
        'first valid end\n\nsecond {>>hidden<<} tail\n'
      ),
      pasteText: () => ''
    })

    selectText(host, 'valid')
    await editor.commitAuthoringSelection()
    expect(editor.getCriticMarkupReviewSnapshot().canCreateComment).toBe(true)

    selectText(host, 'first', 'tail')
    await editor.commitAuthoringSelection()
    expect(editor.getCriticMarkupReviewSnapshot()).toMatchObject({
      canCreateAddition: false,
      canCreateDeletion: false,
      canCreateSubstitution: false,
      canCreateHighlight: false,
      canCreateComment: false
    })
  })

  it('mounts live Original and Revised without changing canonical source', async() => {
    const source = 'A {++new++} {--old--} {~~before~>after~~}'
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = await createTestDocumentHost({
      host,
      source: createSourceSnapshot(source),
      pasteText: () => ''
    })
    const sourceChange = vi.fn()
    editor.subscribeDocumentChange(sourceChange)

    editor.configure({ criticMarkupProjection: 'original' })
    await editor.settled()
    expect(host.textContent).toBe('A  old before')
    expect(host.dataset.criticProjection).toBe('original')
    expect(editor.getCriticMarkupReviewSnapshot()).toMatchObject({
      projection: 'original',
      canCreateAddition: false
    })
    expect(editor.getMarkdownSync()).toBe(source)
    expect(sourceChange).not.toHaveBeenCalled()

    editor.configure({ criticMarkupProjection: 'revised' })
    await editor.settled()
    expect(host.textContent).toBe('A new  after')
    expect(host.dataset.criticProjection).toBe('revised')
  })
})

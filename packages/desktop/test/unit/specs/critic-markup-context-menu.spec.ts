import { beforeEach, describe, expect, it, vi } from 'vitest'

const { popupMenu, menus } = vi.hoisted(() => ({
  popupMenu: vi.fn(),
  menus: [] as Array<{ items: Array<Record<string, unknown>> }>
}))

vi.mock('electron', () => {
  class Menu {
    items: Array<Record<string, unknown>> = []

    constructor() {
      menus.push(this)
    }

    append(item: Record<string, unknown>): void {
      this.items.push(item)
    }
  }

  class MenuItem {
    constructor(options: Record<string, unknown>) {
      Object.assign(this, options)
    }
  }

  return { Menu, MenuItem }
})
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))
vi.mock('main_renderer/presentationPolicy', () => ({ presentationPolicy: { popupMenu } }))
vi.mock('main_renderer/contextMenu/editor/spellcheck', () => ({ default: vi.fn(() => []) }))

import { showEditorContextMenu } from 'main_renderer/contextMenu/editor'

const comment = {
  revisionId: 'revision:1',
  nodeId: 'critic-comment-1'
}

function editorParams(frame: unknown) {
  return {
    frame,
    x: 41,
    y: 73,
    isEditable: true,
    hasImageContents: false,
    selectionText: '',
    inputFieldType: undefined,
    editFlags: {
      canCut: true,
      canCopy: true,
      canPaste: true,
      canEditRichly: true
    }
  }
}

function fakeFrame() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  return {
    ipc: {
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        const channelListeners = listeners.get(channel) ?? new Set()
        channelListeners.add(listener)
        listeners.set(channel, channelListeners)
      }),
      off: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        const channelListeners = listeners.get(channel)
        channelListeners?.delete(listener)
        if (channelListeners?.size === 0) listeners.delete(channel)
      })
    },
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
    respond(channel: string, payload: unknown) {
      for (const listener of [...(listeners.get(channel) ?? [])]) {
        listener({}, payload)
      }
    }
  }
}

function fakeWindow() {
  return {
    webContents: {
      isDestroyed: vi.fn(() => false),
      once: vi.fn(),
      off: vi.fn()
    }
  }
}

function latestMenu(): { items: Array<Record<string, unknown>> } {
  const menu = menus.at(-1)
  if (!menu) throw new TypeError('Expected the native context menu to be built.')
  return menu
}

function sentRequest(
  frame: ReturnType<typeof fakeFrame>,
  channel: string,
  predicate: (request: Record<string, unknown>) => boolean = () => true
): Record<string, unknown> {
  const call = frame.send.mock.calls.find(
    ([sentChannel, request]) =>
      sentChannel === channel &&
      request !== null &&
      typeof request === 'object' &&
      predicate(request as Record<string, unknown>)
  )
  if (!call) throw new TypeError(`Expected ${channel} request`)
  return call[1] as Record<string, unknown>
}

function respondSurface(
  frame: ReturnType<typeof fakeFrame>,
  surface: 'markup' | 'source' | 'original' | 'revised' | null,
  predicate?: (request: Record<string, unknown>) => boolean
): void {
  const request = sentRequest(
    frame,
    'mt::query-document-surface-context',
    predicate
  )
  frame.respond(
    'mt::document-surface-context-response',
    surface === null
      ? {
        requestId: request.requestId,
        documentId: null,
        revisionId: null,
        surface: null
      }
      : {
        requestId: request.requestId,
        documentId: 'document:1',
        revisionId: 'revision:1',
        surface
      }
  )
}

function respondNoComment(
  frame: ReturnType<typeof fakeFrame>,
  predicate?: (request: Record<string, unknown>) => boolean
): void {
  const request = sentRequest(
    frame,
    'mt::cm-query-editor-context',
    predicate
  )
  frame.respond('mt::cm-editor-context-response', {
    requestId: request.requestId,
    documentId: null,
    target: null
  })
}

describe('native editor context menu comment editing', () => {
  beforeEach(() => {
    popupMenu.mockReset()
    menus.length = 0
  })

  it('wires the Comment menu descriptor to the one-shot typed executor', async() => {
    const frame = fakeFrame()
    const win = fakeWindow()

    const pending = showEditorContextMenu(
      win as never,
      {},
      editorParams(frame) as never,
      false
    )
    const query = sentRequest(frame, 'mt::cm-query-editor-context')
    expect(query).toMatchObject({ x: 41, y: 73 })

    const editRequest = { documentId: 'document:1', target: comment }
    respondSurface(frame, 'markup')
    frame.respond('mt::cm-editor-context-response', {
      requestId: query.requestId,
      ...editRequest
    })
    await pending

    const menu = latestMenu()
    expect(menu.items.slice(0, 2).map(item => [item.id, item.type])).toEqual([
      ['editCriticMarkupCommentMenuItem', undefined],
      [undefined, 'separator']
    ])

    const edit = menu.items[0]
    ;(edit.click as () => void)()
    expect(frame.send).toHaveBeenLastCalledWith('mt::cm-edit-comment', editRequest)
  })

  it('queries and edits a non-editable comment indicator', async() => {
    const frame = fakeFrame()
    const win = fakeWindow()
    const params = editorParams(frame)
    params.isEditable = false
    params.editFlags.canEditRichly = false

    const pending = showEditorContextMenu(
      win as never,
      {},
      params as never,
      false
    )

    const query = sentRequest(frame, 'mt::cm-query-editor-context')
    respondSurface(frame, 'original')
    frame.respond('mt::cm-editor-context-response', {
      requestId: query.requestId,
      documentId: 'document:1',
      target: comment
    })
    await pending

    expect(latestMenu().items[0].id).toBe('editCriticMarkupCommentMenuItem')
  })

  it('does not turn an ordinary non-editable renderer target into an editor menu', async() => {
    const frame = fakeFrame()
    const params = editorParams(frame)
    params.isEditable = false
    params.editFlags.canEditRichly = false
    const pending = showEditorContextMenu(
      fakeWindow() as never,
      {},
      params as never,
      false
    )
    const query = sentRequest(frame, 'mt::cm-query-editor-context')

    respondSurface(frame, null)
    frame.respond('mt::cm-editor-context-response', {
      requestId: query.requestId,
      documentId: null,
      target: null
    })
    await pending

    expect(popupMenu).not.toHaveBeenCalled()
    expect(menus).toEqual([])
  })

  it('ignores an uncorrelated response and cleans up after the matching response', async() => {
    const frame = fakeFrame()
    const win = fakeWindow()
    const pending = showEditorContextMenu(win as never, {}, editorParams(frame) as never, false)
    const query = sentRequest(frame, 'mt::cm-query-editor-context')
    respondSurface(frame, 'markup')

    frame.respond('mt::cm-editor-context-response', {
      requestId: 'some-other-request',
      documentId: 'document:1',
      target: comment
    })
    expect(popupMenu).not.toHaveBeenCalled()

    frame.respond('mt::cm-editor-context-response', {
      requestId: query.requestId,
      documentId: 'document:1',
      target: comment
    })
    await pending

    expect(popupMenu).toHaveBeenCalledTimes(1)
    expect(frame.ipc.off).toHaveBeenCalledWith(
      'mt::cm-editor-context-response',
      expect.any(Function)
    )
  })

  it('ignores a correlated response with a malformed comment target', async() => {
    vi.useFakeTimers()
    try {
      const frame = fakeFrame()
      const pending = showEditorContextMenu(
        fakeWindow() as never,
        {},
        editorParams(frame) as never,
        false
      )
      const query = sentRequest(frame, 'mt::cm-query-editor-context')
      respondSurface(frame, 'markup')

      frame.respond('mt::cm-editor-context-response', {
        requestId: query.requestId,
        documentId: 'document:1',
        target: { ...comment, sourceStart: 10 }
      })
      await Promise.resolve()
      expect(popupMenu).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(151)
      await pending
      expect(latestMenu().items[0].id).toBe('insertParagraphBeforeMenuItem')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the authenticated editor menu when only the Comment query times out', async() => {
    vi.useFakeTimers()
    try {
      const frame = fakeFrame()
      const pending = showEditorContextMenu(
        fakeWindow() as never,
        {},
        editorParams(frame) as never,
        false
      )
      respondSurface(frame, 'markup')

      await vi.advanceTimersByTimeAsync(151)
      await pending

      expect(latestMenu().items.map(item => item.id ?? item.type)).toEqual([
        'insertParagraphBeforeMenuItem',
        'insertParagraphAfterMenuItem',
        'separator',
        'cutMenuItem',
        'copyMenuItem',
        'pasteMenuItem',
        'separator',
        'copyAsRichMenuItem',
        'copyAsHtmlMenuItem',
        'pasteAsPlainTextMenuItem'
      ])
      expect(frame.ipc.off).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows only native cut copy and paste for a plain-text Source editor', async() => {
    const frame = fakeFrame()
    const params = {
      ...editorParams(frame),
      inputFieldType: 'plainText',
      selectionText: 'source',
      editFlags: {
        ...editorParams(frame).editFlags,
        canEditRichly: false
      }
    }

    const pending = showEditorContextMenu(
      fakeWindow() as never,
      {},
      params as never,
      false
    )
    respondSurface(frame, 'source')
    respondNoComment(frame)
    await pending

    expect(latestMenu().items.map(item => item.id ?? item.type)).toEqual([
      'cutMenuItem',
      'copyMenuItem',
      'pasteMenuItem'
    ])
    expect(popupMenu).toHaveBeenCalledTimes(1)
  })

  it('lets only the latest overlapping context-menu request pop for a window', async() => {
    const win = fakeWindow()
    const frame = fakeFrame()
    const firstParams = editorParams(frame)
    const secondParams = { ...editorParams(frame), x: 99, y: 101 }
    const first = showEditorContextMenu(win as never, {}, firstParams as never, false)
    const second = showEditorContextMenu(win as never, {}, secondParams as never, false)
    const firstQuery = sentRequest(
      frame,
      'mt::cm-query-editor-context',
      request => request.x === 41
    )
    const secondQuery = sentRequest(
      frame,
      'mt::cm-query-editor-context',
      request => request.x === 99
    )

    respondSurface(frame, 'markup', request => request.x === 99)
    frame.respond('mt::cm-editor-context-response', {
      requestId: secondQuery.requestId,
      documentId: null,
      target: null
    })
    respondSurface(frame, 'markup', request => request.x === 41)
    frame.respond('mt::cm-editor-context-response', {
      requestId: firstQuery.requestId,
      documentId: 'document:1',
      target: comment
    })
    await Promise.all([first, second])

    expect(popupMenu).toHaveBeenCalledTimes(1)
    expect(popupMenu.mock.calls[0][1]).toMatchObject({ x: 99, y: 101 })
    expect(latestMenu().items[0].id).toBe('insertParagraphBeforeMenuItem')
  })

  it('invalidates a pending editor query when a newer image gesture is ignored', async() => {
    const win = fakeWindow()
    const frame = fakeFrame()
    const first = showEditorContextMenu(
      win as never,
      {},
      editorParams(frame) as never,
      false
    )
    const query = sentRequest(frame, 'mt::cm-query-editor-context')

    await showEditorContextMenu(win as never, {}, {
      ...editorParams(frame),
      hasImageContents: true
    } as never, false)
    respondSurface(frame, 'markup')
    frame.respond('mt::cm-editor-context-response', {
      requestId: query.requestId,
      documentId: 'document:1',
      target: comment
    })
    await first

    expect(popupMenu).not.toHaveBeenCalled()
    expect(menus).toEqual([])
  })

  it.each(['original', 'revised'] as const)(
    'shows copy-capable, non-mutating %s projection commands',
    async(surface) => {
      const frame = fakeFrame()
      const params = editorParams(frame)
      params.isEditable = false
      params.selectionText = 'selected projection text'
      params.editFlags.canCut = false
      params.editFlags.canCopy = true
      params.editFlags.canPaste = true
      params.editFlags.canEditRichly = false

      const pending = showEditorContextMenu(
        fakeWindow() as never,
        {},
        params as never,
        false
      )
      respondSurface(frame, surface)
      respondNoComment(frame)
      await pending

      const byId = new Map(
        latestMenu().items.map(item => [item.id, item])
      )
      expect(byId.get('copyMenuItem')?.enabled).toBe(true)
      expect(byId.get('copyAsRichMenuItem')?.enabled).toBe(true)
      expect(byId.get('copyAsHtmlMenuItem')?.enabled).toBe(true)
      expect(byId.get('cutMenuItem')?.enabled).toBe(false)
      expect(byId.get('pasteMenuItem')?.enabled).toBe(false)
      expect(byId.get('pasteAsPlainTextMenuItem')?.enabled).toBe(false)
      expect(byId.get('insertParagraphBeforeMenuItem')?.enabled).toBe(false)
      expect(byId.get('insertParagraphAfterMenuItem')?.enabled).toBe(false)
    }
  )

  it('enables native Copy independently of canCut in Markup', async() => {
    const frame = fakeFrame()
    const params = editorParams(frame)
    params.selectionText = 'copy me'
    params.editFlags.canCut = false

    const pending = showEditorContextMenu(
      fakeWindow() as never,
      {},
      params as never,
      false
    )
    respondSurface(frame, 'markup')
    respondNoComment(frame)
    await pending

    const byId = new Map(
      latestMenu().items.map(item => [item.id, item])
    )
    expect(byId.get('cutMenuItem')?.enabled).toBe(false)
    expect(byId.get('copyMenuItem')?.enabled).toBe(true)
  })
})

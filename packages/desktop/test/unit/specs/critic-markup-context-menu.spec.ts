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
  id: 'critic-comment-1',
  type: 'comment' as const,
  path: [0, 'text'],
  start: 10,
  end: 26,
  sourceStart: 10,
  sourceEnd: 26,
  raw: '{>>review note<<}',
  content: 'review note',
  anchorId: 'critic-highlight-1',
  anchorText: 'selected words'
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

describe('native editor context menu comment editing', () => {
  beforeEach(() => {
    popupMenu.mockReset()
    menus.length = 0
  })

  it('offers Edit Comment only for the correlated parser-owned comment hit', async() => {
    const frame = fakeFrame()
    const win = fakeWindow()

    const pending = showEditorContextMenu(
      win as never,
      {},
      editorParams(frame) as never,
      false
    )
    const [queryChannel, query] = frame.send.mock.calls[0]
    expect(queryChannel).toBe('mt::cm-query-editor-context')
    expect(query).toMatchObject({ x: 41, y: 73 })

    const editRequest = { fileId: 'file-1', target: comment }
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

    const [queryChannel, query] = frame.send.mock.calls[0] ?? []
    expect(queryChannel).toBe('mt::cm-query-editor-context')
    frame.respond('mt::cm-editor-context-response', {
      requestId: query.requestId,
      fileId: 'file-1',
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
    const query = frame.send.mock.calls[0][1]

    frame.respond('mt::cm-editor-context-response', {
      requestId: query.requestId,
      fileId: null,
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
    const query = frame.send.mock.calls[0][1]

    frame.respond('mt::cm-editor-context-response', {
      requestId: 'some-other-request',
      fileId: 'file-1',
      target: comment
    })
    expect(popupMenu).not.toHaveBeenCalled()

    frame.respond('mt::cm-editor-context-response', {
      requestId: query.requestId,
      fileId: 'file-1',
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
      const query = frame.send.mock.calls[0][1]

      frame.respond('mt::cm-editor-context-response', {
        requestId: query.requestId,
        fileId: 'file-1',
        target: { ...comment, path: null }
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

  it('falls back to the unchanged ordinary menu when the renderer query times out', async() => {
    vi.useFakeTimers()
    try {
      const frame = fakeFrame()
      const pending = showEditorContextMenu(
        fakeWindow() as never,
        {},
        editorParams(frame) as never,
        false
      )

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

  it('lets only the latest overlapping context-menu request pop for a window', async() => {
    const win = fakeWindow()
    const frame = fakeFrame()
    const firstParams = editorParams(frame)
    const secondParams = { ...editorParams(frame), x: 99, y: 101 }
    const first = showEditorContextMenu(win as never, {}, firstParams as never, false)
    const second = showEditorContextMenu(win as never, {}, secondParams as never, false)
    const firstQuery = frame.send.mock.calls[0][1]
    const secondQuery = frame.send.mock.calls[1][1]

    frame.respond('mt::cm-editor-context-response', {
      requestId: secondQuery.requestId,
      fileId: null,
      target: null
    })
    frame.respond('mt::cm-editor-context-response', {
      requestId: firstQuery.requestId,
      fileId: 'file-1',
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
    const query = frame.send.mock.calls[0][1]

    await showEditorContextMenu(win as never, {}, {
      ...editorParams(frame),
      hasImageContents: true
    } as never, false)
    frame.respond('mt::cm-editor-context-response', {
      requestId: query.requestId,
      fileId: 'file-1',
      target: comment
    })
    await first

    expect(popupMenu).not.toHaveBeenCalled()
    expect(menus).toEqual([])
  })
})

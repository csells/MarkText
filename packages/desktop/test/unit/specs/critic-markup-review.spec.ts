import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ICriticMarkupReviewSnapshot } from '@marktext/document-view'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('electron', () => ({
  ipcMain: { on: vi.fn(), emit: vi.fn(), handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(), getAllWindows: vi.fn(() => []) }
}))
vi.mock('electron-log', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

import * as reviewActions from 'main_renderer/menu/actions/review'
import reviewTemplate from 'main_renderer/menu/templates/review'
import { REVIEW_COMMAND_DESCRIPTORS } from 'common/commands/review'
import {
  buildCriticMarkupSidebarState,
  executeCriticMarkupReviewAction,
  executeCriticMarkupSidebarItemAction
} from '@/components/editorWithTabs/criticMarkupReview'

const win = { webContents: { send } }
const keybindings = { getAccelerator: vi.fn(() => null) }

describe('CriticMarkup Review menu', () => {
  beforeEach(() => send.mockClear())

  it.each(REVIEW_COMMAND_DESCRIPTORS)(
    'routes $id through the existing command-id protocol',
    ({ id }) => {
      reviewActions.executeReviewCommand(win as never, id)
      expect(send).toHaveBeenCalledWith('mt::execute-command-by-id', id)
    }
  )

  it('uses a native Review menu with all command ids and marked projection selected', () => {
    const menu = reviewTemplate(keybindings as never)
    const allItems = (menu.submenu as Array<Record<string, unknown>>).flatMap((item) =>
      Array.isArray(item.submenu) ? [item, ...item.submenu as Array<Record<string, unknown>>] : [item]
    )
    const ids = allItems.map((item) => item.id).filter(Boolean)

    expect(menu.id).toBe('reviewMenuItem')
    expect(ids).toEqual(expect.arrayContaining([
      'reviewTrackChangesMenuItem',
      'reviewMarkAdditionMenuItem',
      'reviewMarkDeletionMenuItem',
      'reviewSuggestReplacementMenuItem',
      'reviewHighlightMenuItem',
      'reviewAddCommentMenuItem',
      'reviewPreviousMenuItem',
      'reviewNextMenuItem',
      'reviewAcceptCurrentMenuItem',
      'reviewRejectCurrentMenuItem',
      'reviewAcceptAllMenuItem',
      'reviewRejectAllMenuItem',
      'reviewShowMarkedMenuItem',
      'reviewShowOriginalMenuItem',
      'reviewShowRevisedMenuItem'
    ]))
    expect((menu.submenu as Array<Record<string, unknown>>)
      .filter((item) => item.type !== 'separator')
      .every((item) => item.enabled === false)).toBe(true)
    expect(allItems.find((item) => item.id === 'reviewShowMarkedMenuItem')?.checked).toBe(true)
  })

  it('shows user-assigned accelerators on every projection command', () => {
    const menu = reviewTemplate({
      getAccelerator: (id: string) => `custom:${id}`
    } as never)
    const display = (menu.submenu as Array<Record<string, unknown>>)
      .find((item) => item.id === 'reviewDisplayMenuItem')
    const projectionItems = display?.submenu as Array<Record<string, unknown>>

    expect(projectionItems.map((item) => [item.id, item.accelerator])).toEqual([
      ['reviewShowMarkedMenuItem', 'custom:review.show-marked'],
      ['reviewShowOriginalMenuItem', 'custom:review.show-original'],
      ['reviewShowRevisedMenuItem', 'custom:review.show-revised']
    ])
  })

  it('reflects native command capability and projection state per window menu', () => {
    const ids = [
      'reviewTrackChangesMenuItem',
      'reviewMarkAdditionMenuItem', 'reviewMarkDeletionMenuItem',
      'reviewSuggestReplacementMenuItem', 'reviewHighlightMenuItem',
      'reviewAddCommentMenuItem', 'reviewPreviousMenuItem', 'reviewNextMenuItem',
      'reviewAcceptCurrentMenuItem', 'reviewRejectCurrentMenuItem',
      'reviewAcceptAllMenuItem', 'reviewRejectAllMenuItem',
      'reviewDisplayMenuItem',
      'reviewShowMarkedMenuItem', 'reviewShowOriginalMenuItem', 'reviewShowRevisedMenuItem'
    ]
    const items = new Map(ids.map((id) => [id, { id, enabled: true, checked: false }]))
    const displayItem = items.get('reviewDisplayMenuItem')
    if (!displayItem) throw new TypeError('Review display menu fixture is missing.')
    displayItem.enabled = false
    const menu = { getMenuItemById: (id: string) => items.get(id) }

    reviewActions.updateReviewMenu(menu as never, {
      available: true,
      canCreateAddition: true,
      canCreateDeletion: false,
      canCreateSubstitution: false,
      canCreateHighlight: false,
      canCreateComment: true,
      canNavigate: true,
      canResolveCurrent: false,
      canResolveAll: true,
      trackChanges: true,
      projection: 'revised'
    })

    expect(items.get('reviewMarkAdditionMenuItem')?.enabled).toBe(true)
    expect(items.get('reviewMarkDeletionMenuItem')?.enabled).toBe(false)
    expect(items.get('reviewAcceptCurrentMenuItem')?.enabled).toBe(false)
    expect(items.get('reviewPreviousMenuItem')?.enabled).toBe(true)
    expect(items.get('reviewNextMenuItem')?.enabled).toBe(true)
    expect(items.get('reviewAcceptAllMenuItem')?.enabled).toBe(true)
    expect(items.get('reviewDisplayMenuItem')?.enabled).toBe(true)
    expect(items.get('reviewTrackChangesMenuItem')?.checked).toBe(true)
    expect(items.get('reviewShowMarkedMenuItem')?.checked).toBe(false)
    expect(items.get('reviewShowRevisedMenuItem')?.checked).toBe(true)
  })

  it('enables navigation for annotation-only documents without enabling bulk resolution', () => {
    const ids = [
      'reviewPreviousMenuItem',
      'reviewNextMenuItem',
      'reviewAcceptAllMenuItem',
      'reviewRejectAllMenuItem',
      'reviewDisplayMenuItem'
    ]
    const items = new Map(ids.map((id) => [
      id,
      { id, enabled: false, checked: false }
    ]))
    const menu = { getMenuItemById: (id: string) => items.get(id) }
    const annotationOnlyState = {
      available: true,
      canCreateAddition: false,
      canCreateDeletion: false,
      canCreateSubstitution: false,
      canCreateHighlight: false,
      canCreateComment: false,
      canResolveCurrent: true,
      canResolveAll: false,
      canNavigate: true,
      trackChanges: false,
      projection: 'marked' as const
    }

    reviewActions.updateReviewMenu(menu as never, annotationOnlyState)

    expect(items.get('reviewPreviousMenuItem')?.enabled).toBe(true)
    expect(items.get('reviewNextMenuItem')?.enabled).toBe(true)
    expect(items.get('reviewAcceptAllMenuItem')?.enabled).toBe(false)
    expect(items.get('reviewRejectAllMenuItem')?.enabled).toBe(false)
  })
})

describe('CriticMarkup renderer command routing', () => {
  const reviewItem = {
    id: 'critic-0-7',
    type: 'addition' as const,
    path: [0],
    start: 0,
    end: 7,
    sourceStart: 0,
    sourceEnd: 7,
    raw: '{++x++}',
    content: 'x'
  }
  const editor = {
    createCriticMarkup: vi.fn(async() => true),
    focusCriticMarkup: vi.fn((): typeof reviewItem | null => reviewItem),
    navigateCriticMarkup: vi.fn(() => reviewItem),
    resolveCriticMarkup: vi.fn(async() => true),
    resolveAllCriticMarkup: vi.fn(async() => 2),
    editCriticMarkupComment: vi.fn(async() => true),
    commitAuthoringSelection: vi.fn(),
    getCriticMarkupReviewSnapshot: vi.fn((): ICriticMarkupReviewSnapshot => ({
      revisionId: 'revision:1',
      items: [reviewItem],
      currentItemId: reviewItem.id,
      canCreateAddition: true,
      canCreateDeletion: true,
      canCreateSubstitution: true,
      canCreateHighlight: true,
      canCreateComment: true,
      canNavigate: true,
      canResolveCurrent: true,
      canResolveAll: true,
      trackChanges: false,
      projection: 'marked' as const
    })),
    configure: vi.fn(async() => {})
  }

  beforeEach(() => {
    Object.values(editor).forEach((fn) => fn.mockClear())
  })

  it('routes direct authoring and resolution to native document-view commands', async() => {
    await executeCriticMarkupReviewAction(editor, 'mark-addition')
    await executeCriticMarkupReviewAction(editor, 'mark-deletion')
    await executeCriticMarkupReviewAction(editor, 'mark-highlight')
    await executeCriticMarkupReviewAction(editor, 'next')
    await executeCriticMarkupReviewAction(editor, 'previous')
    await executeCriticMarkupReviewAction(editor, 'accept-current')
    await executeCriticMarkupReviewAction(editor, 'reject-current')
    await executeCriticMarkupReviewAction(editor, 'accept-all')
    await executeCriticMarkupReviewAction(editor, 'reject-all')

    expect(editor.createCriticMarkup.mock.calls).toEqual([
      [{ type: 'addition' }],
      [{ type: 'deletion' }],
      [{ type: 'highlight' }]
    ])
    expect(editor.navigateCriticMarkup.mock.calls).toEqual([['next'], ['previous']])
    expect(editor.resolveCriticMarkup.mock.calls).toEqual([
      ['accept', { revisionId: 'revision:1', nodeId: reviewItem.id }],
      ['reject', { revisionId: 'revision:1', nodeId: reviewItem.id }]
    ])
    expect(editor.resolveAllCriticMarkup.mock.calls).toEqual([['accept'], ['reject']])
  })

  it('waits for bulk Review resolution before reporting action success', async() => {
    let commit: ((count: number) => void) | undefined
    const terminal = new Promise<number>((resolve) => {
      commit = resolve
    })
    editor.resolveAllCriticMarkup.mockReturnValueOnce(terminal)
    let reported = false
    const action = executeCriticMarkupReviewAction(editor, 'accept-all')
      .finally(() => {
        reported = true
      })

    await Promise.resolve()
    await Promise.resolve()
    expect(reported).toBe(false)

    commit?.(2)
    await expect(action).resolves.toEqual({ kind: 'executed' })
  })

  it('toggles Track Changes through the native engine option', async() => {
    await executeCriticMarkupReviewAction(editor, 'toggle-track-changes')

    expect(editor.configure).toHaveBeenCalledWith({
      criticMarkupTrackChanges: true
    })
  })

  it('waits for Track Changes configuration before reporting success', async() => {
    let commit: (() => void) | undefined
    const terminal = new Promise<void>((resolve) => {
      commit = resolve
    })
    editor.configure.mockReturnValueOnce(terminal)
    let reported = false
    const action = executeCriticMarkupReviewAction(
      editor,
      'toggle-track-changes'
    ).finally(() => {
      reported = true
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(reported).toBe(false)

    commit?.()
    await expect(action).resolves.toEqual({ kind: 'executed' })
  })

  it('waits for a clean-view navigation handoff before reporting success', async() => {
    editor.getCriticMarkupReviewSnapshot.mockReturnValueOnce({
      ...editor.getCriticMarkupReviewSnapshot(),
      projection: 'revised'
    })
    let commit: (() => void) | undefined
    const terminal = new Promise<void>((resolve) => {
      commit = resolve
    })
    editor.configure.mockReturnValueOnce(terminal)
    let reported = false
    const action = executeCriticMarkupReviewAction(editor, 'next')
      .finally(() => {
        reported = true
      })

    await Promise.resolve()
    await Promise.resolve()
    expect(reported).toBe(false)

    commit?.()
    await expect(action).resolves.toEqual({ kind: 'executed' })
    expect(editor.configure).toHaveBeenCalledWith({
      criticMarkupProjection: 'marked'
    })
  })

  it('rejects malformed native Review commands without effects', async() => {
    await expect(
      executeCriticMarkupReviewAction(editor, 'accept-current\0forged')
    ).resolves.toEqual({ kind: 'unavailable' })
    await expect(
      executeCriticMarkupReviewAction(editor, {
        action: 'accept-current'
      })
    ).resolves.toEqual({ kind: 'unavailable' })

    expect(editor.resolveCriticMarkup).not.toHaveBeenCalled()
    expect(editor.createCriticMarkup).not.toHaveBeenCalled()
    expect(editor.configure).not.toHaveBeenCalled()
  })

  it('requests text before authoring a substitution or comment and honors cancel', async() => {
    const requestText = vi.fn()
      .mockResolvedValueOnce('replacement')
      .mockResolvedValueOnce('review note')
      .mockResolvedValueOnce(null)

    await executeCriticMarkupReviewAction(editor, 'suggest-replacement', requestText)
    await executeCriticMarkupReviewAction(editor, 'add-comment', requestText)
    const cancelled = await executeCriticMarkupReviewAction(
      editor,
      'add-comment',
      requestText
    )

    expect(requestText.mock.calls).toEqual([['substitution'], ['comment'], ['comment']])
    expect(editor.createCriticMarkup.mock.calls).toEqual([
      [{ type: 'substitution', replacement: 'replacement' }],
      [{ type: 'comment', comment: 'review note' }]
    ])
    expect(cancelled).toEqual({ kind: 'cancelled' })
  })

  it.each([
    ['show-marked', 'marked'],
    ['show-original', 'original'],
    ['show-revised', 'revised']
  ] as const)('applies the %s projection without changing Markdown', async(action, projection) => {
    await executeCriticMarkupReviewAction(editor, action)
    expect(editor.configure).toHaveBeenCalledWith({ criticMarkupProjection: projection })
  })

  it('focuses a sidebar target in the canonical marked projection', async() => {
    const target = {
      id: 'critic-8-15',
      type: 'addition' as const,
      path: [0, 'c'],
      start: 8,
      end: 15,
      sourceStart: 8,
      sourceEnd: 15,
      raw: '{++new++}',
      content: 'new'
    }

    await expect(executeCriticMarkupSidebarItemAction(editor, {
      documentId: 'document:1',
      action: 'focus',
      target: {
        revisionId: 'revision:1',
        nodeId: target.id
      }
    }, 'revised', 'document:1')).resolves.toEqual({ kind: 'executed' })
    expect(editor.configure).toHaveBeenCalledWith({
      criticMarkupProjection: 'marked'
    })
    expect(editor.focusCriticMarkup).toHaveBeenCalledWith({
      revisionId: 'revision:1',
      nodeId: target.id
    })
  })

  it('does not change projection when a sidebar target fails authentication', async() => {
    editor.focusCriticMarkup.mockReturnValueOnce(null)

    await expect(executeCriticMarkupSidebarItemAction(editor, {
      documentId: 'document:1',
      action: 'focus',
      target: {
        revisionId: 'revision:stale',
        nodeId: reviewItem.id
      }
    }, 'revised', 'document:1')).resolves.toEqual({ kind: 'stale' })

    expect(editor.configure).not.toHaveBeenCalled()
  })

  it.each([
    ['accept', 'revised'],
    ['reject', 'marked']
  ] as const)(
    'resolves one sidebar target with %s from the %s projection',
    async(decision, projection) => {
      const target = {
        id: 'critic-8-15',
        type: 'deletion' as const,
        path: [0],
        start: 8,
        end: 15,
        sourceStart: 8,
        sourceEnd: 15,
        raw: '{--old--}',
        content: 'old'
      }

      await expect(executeCriticMarkupSidebarItemAction(editor, {
        documentId: 'document:1',
        action: decision,
        target: {
          revisionId: 'revision:1',
          nodeId: target.id
        }
      }, projection, 'document:1')).resolves.toEqual({ kind: 'executed' })
      if (projection !== 'marked') {
        expect(editor.configure).toHaveBeenCalledWith({
          criticMarkupProjection: 'marked'
        })
      }
      expect(editor.resolveCriticMarkup).toHaveBeenCalledWith(decision, {
        revisionId: 'revision:1',
        nodeId: target.id
      })
    }
  )

  it('rejects an item action published by a previously selected file', async() => {
    const target = {
      id: 'critic-0-7',
      type: 'addition' as const,
      path: [0],
      start: 0,
      end: 7,
      sourceStart: 0,
      sourceEnd: 7,
      raw: '{++x++}',
      content: 'x'
    }

    await expect(executeCriticMarkupSidebarItemAction(editor, {
      documentId: 'document:old',
      action: 'accept',
      target: {
        revisionId: 'revision:1',
        nodeId: target.id
      }
    }, 'marked', 'document:current')).resolves.toEqual({ kind: 'stale' })
    expect(editor.resolveCriticMarkup).not.toHaveBeenCalled()
    expect(editor.focusCriticMarkup).not.toHaveBeenCalled()
  })
})

describe('CriticMarkup sidebar state', () => {
  it('reuses the canonical parser-native item collection without projecting a second model', () => {
    const item = {
      id: 'critic-4-17',
      type: 'substitution' as const,
      path: [0, 'c'],
      start: 4,
      end: 17,
      sourceStart: 4,
      sourceEnd: 17,
      raw: '{~~old~>new~~}',
      oldContent: 'old',
      newContent: 'new'
    }
    const snapshot = {
      revisionId: 'revision:1',
      items: [item],
      currentItemId: item.id,
      canCreateAddition: false,
      canCreateDeletion: false,
      canCreateSubstitution: false,
      canCreateHighlight: false,
      canCreateComment: false,
      canNavigate: true,
      canResolveCurrent: true,
      canResolveAll: true,
      trackChanges: true,
      projection: 'marked' as const
    }

    const state = buildCriticMarkupSidebarState('document:1', snapshot)

    expect(state.items).toBe(snapshot.items)
    expect(state).toEqual({
      documentId: 'document:1',
      revisionId: 'revision:1',
      available: true,
      items: [{
        id: 'critic-4-17',
        type: 'substitution',
        path: [0, 'c'],
        start: 4,
        end: 17,
        sourceStart: 4,
        sourceEnd: 17,
        raw: '{~~old~>new~~}',
        oldContent: 'old',
        newContent: 'new'
      }],
      currentItemId: 'critic-4-17',
      trackChanges: true,
      projection: 'marked'
    })
  })
})

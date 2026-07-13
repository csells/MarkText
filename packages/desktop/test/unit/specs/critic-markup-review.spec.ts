import { beforeEach, describe, expect, it, vi } from 'vitest'

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
      canResolveCurrent: false,
      canResolveAll: true,
      trackChanges: true,
      projection: 'revised'
    })

    expect(items.get('reviewMarkAdditionMenuItem')?.enabled).toBe(true)
    expect(items.get('reviewMarkDeletionMenuItem')?.enabled).toBe(false)
    expect(items.get('reviewAcceptCurrentMenuItem')?.enabled).toBe(false)
    expect(items.get('reviewPreviousMenuItem')?.enabled).toBe(false)
    expect(items.get('reviewNextMenuItem')?.enabled).toBe(false)
    expect(items.get('reviewAcceptAllMenuItem')?.enabled).toBe(true)
    expect(items.get('reviewDisplayMenuItem')?.enabled).toBe(true)
    expect(items.get('reviewTrackChangesMenuItem')?.checked).toBe(true)
    expect(items.get('reviewShowMarkedMenuItem')?.checked).toBe(false)
    expect(items.get('reviewShowRevisedMenuItem')?.checked).toBe(true)
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
    createCriticMarkup: vi.fn(() => true),
    focusCriticMarkup: vi.fn(() => reviewItem),
    navigateCriticMarkup: vi.fn(() => reviewItem),
    resolveCriticMarkup: vi.fn(() => true),
    resolveAllCriticMarkup: vi.fn(() => 2),
    getCriticMarkupReviewSnapshot: vi.fn(() => ({
      items: [reviewItem],
      currentItemId: reviewItem.id,
      canCreateAddition: true,
      canCreateDeletion: true,
      canCreateSubstitution: true,
      canCreateHighlight: true,
      canCreateComment: true,
      canResolveCurrent: true,
      canResolveAll: true,
      trackChanges: false,
      projection: 'marked' as const
    })),
    setOptions: vi.fn()
  }

  beforeEach(() => {
    Object.values(editor).forEach((fn) => fn.mockClear())
  })

  it('routes direct authoring and resolution to native Muya commands', async() => {
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
    expect(editor.resolveCriticMarkup.mock.calls).toEqual([['accept'], ['reject']])
    expect(editor.resolveAllCriticMarkup.mock.calls).toEqual([['accept'], ['reject']])
  })

  it('toggles Track Changes through the native engine option', async() => {
    await executeCriticMarkupReviewAction(editor, 'toggle-track-changes')

    expect(editor.setOptions).toHaveBeenCalledWith(
      { criticMarkupTrackChanges: true },
      false
    )
  })

  it('requests text before authoring a substitution or comment and honors cancel', async() => {
    const requestText = vi.fn()
      .mockResolvedValueOnce('replacement')
      .mockResolvedValueOnce('review note')
      .mockResolvedValueOnce(null)

    await executeCriticMarkupReviewAction(editor, 'suggest-replacement', requestText)
    await executeCriticMarkupReviewAction(editor, 'add-comment', requestText)
    await executeCriticMarkupReviewAction(editor, 'add-comment', requestText)

    expect(requestText.mock.calls).toEqual([['substitution'], ['comment'], ['comment']])
    expect(editor.createCriticMarkup.mock.calls).toEqual([
      [{ type: 'substitution', replacement: 'replacement' }],
      [{ type: 'comment', comment: 'review note' }]
    ])
  })

  it.each([
    ['show-marked', 'marked'],
    ['show-original', 'original'],
    ['show-revised', 'revised']
  ] as const)('applies the %s projection without changing Markdown', async(action, projection) => {
    await executeCriticMarkupReviewAction(editor, action)
    expect(editor.setOptions).toHaveBeenCalledWith({ criticMarkupProjection: projection }, true)
  })

  it('focuses a sidebar target in the canonical marked projection', () => {
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

    expect(executeCriticMarkupSidebarItemAction(editor, {
      fileId: 'file-1',
      action: 'focus',
      target
    }, 'revised', 'file-1')).toBe(true)
    expect(editor.setOptions).toHaveBeenCalledWith(
      { criticMarkupProjection: 'marked' },
      true
    )
    expect(editor.focusCriticMarkup).toHaveBeenCalledWith(target)
  })

  it.each([
    ['accept', 'revised'],
    ['reject', 'marked']
  ] as const)(
    'resolves one sidebar target with %s from the %s projection',
    (decision, projection) => {
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

      expect(executeCriticMarkupSidebarItemAction(editor, {
        fileId: 'file-1',
        action: decision,
        target
      }, projection, 'file-1')).toBe(true)
      if (projection !== 'marked') {
        expect(editor.setOptions).toHaveBeenCalledWith(
          { criticMarkupProjection: 'marked' },
          true
        )
      }
      expect(editor.resolveCriticMarkup).toHaveBeenCalledWith(decision, target)
    }
  )

  it('rejects an item action published by a previously selected file', () => {
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

    expect(executeCriticMarkupSidebarItemAction(editor, {
      fileId: 'old-file',
      action: 'accept',
      target
    }, 'marked', 'current-file')).toBe(false)
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
      items: [item],
      currentItemId: item.id,
      canCreateAddition: false,
      canCreateDeletion: false,
      canCreateSubstitution: false,
      canCreateHighlight: false,
      canCreateComment: false,
      canResolveCurrent: true,
      canResolveAll: true,
      trackChanges: true,
      projection: 'marked' as const
    }

    const state = buildCriticMarkupSidebarState('file-1', snapshot)

    expect(state.items).toBe(snapshot.items)
    expect(state).toEqual({
      fileId: 'file-1',
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

import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  ipcListeners,
  fromWebContents,
  updateReviewMenu,
  logError,
  builtMenu
} = vi.hoisted(() => {
  const items = new Map<string, { checked: boolean; enabled: boolean }>()
  return {
    ipcListeners: new Map<string, (...args: unknown[]) => void>(),
    fromWebContents: vi.fn(),
    updateReviewMenu: vi.fn(),
    logError: vi.fn(),
    builtMenu: {
      getMenuItemById: (id: string) => {
        if (!items.has(id)) items.set(id, { checked: false, enabled: true })
        return items.get(id)
      }
    }
  }
})

vi.mock('electron', () => ({
  app: { addRecentDocument: vi.fn(), clearRecentDocuments: vi.fn() },
  BrowserWindow: { fromWebContents },
  ipcMain: {
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      ipcListeners.set(channel, handler)
    }),
    handle: vi.fn(),
    emit: vi.fn()
  },
  Menu: {
    buildFromTemplate: vi.fn(() => builtMenu),
    setApplicationMenu: vi.fn(),
    getApplicationMenu: vi.fn()
  }
}))

vi.mock('electron-log', () => ({
  default: { error: logError, info: vi.fn(), warn: vi.fn() }
}))
vi.mock('common/filesystem', () => ({
  ensureDirSync: vi.fn(),
  isDirectory2: () => false,
  isFile2: () => false
}))
vi.mock('main_renderer/config', () => ({
  isLinux: false,
  isOsx: false,
  isWindows: false
}))
vi.mock('main_renderer/menu/actions/edit', () => ({ updateSidebarMenu: vi.fn() }))
vi.mock('main_renderer/menu/actions/format', () => ({ updateFormatMenu: vi.fn() }))
vi.mock('main_renderer/menu/actions/paragraph', () => ({ updateSelectionMenus: vi.fn() }))
vi.mock('main_renderer/menu/actions/review', () => ({ updateReviewMenu }))
vi.mock('main_renderer/menu/actions/view', () => ({ viewLayoutChanged: vi.fn() }))
vi.mock('main_renderer/utils/internalIpc', () => ({ onInternalChannel: vi.fn() }))
vi.mock('main_renderer/i18n.js', () => ({ setLanguage: vi.fn() }))
vi.mock('main_renderer/menu/templates', () => ({
  default: vi.fn(() => []),
  configSettingMenu: vi.fn(() => [])
}))

import AppMenu from 'main_renderer/menu'

const reviewState = {
  available: true,
  canCreateAddition: true,
  canCreateDeletion: false,
  canCreateSubstitution: false,
  canCreateHighlight: true,
  canCreateComment: true,
  canResolveCurrent: false,
  canResolveAll: true,
  trackChanges: true,
  projection: 'marked' as const
}

const makeAppMenu = () => new AppMenu({
  getItem: () => 'en'
} as never, {
  registerEditorKeyHandlers: vi.fn()
} as never, '/tmp/marktext-review-menu-test')

describe('Review menu state IPC identity', () => {
  beforeEach(() => {
    fromWebContents.mockReset()
    updateReviewMenu.mockReset()
    logError.mockReset()
  })

  it('derives the target menu from event.sender instead of trusting a renderer window id', () => {
    const appMenu = makeAppMenu()
    const sender = { id: 9001 }
    const senderWindow = { id: 42 }
    fromWebContents.mockReturnValue(senderWindow)
    appMenu.addEditorMenu(senderWindow as never)

    const handler = ipcListeners.get('mt::update-review-menu')
    expect(handler).toBeTypeOf('function')
    handler?.({ sender }, reviewState)

    expect(fromWebContents).toHaveBeenCalledWith(sender)
    expect(updateReviewMenu).toHaveBeenCalledWith(builtMenu, reviewState)
  })

  it('fails closed when the sender does not belong to a live BrowserWindow', () => {
    const appMenu = makeAppMenu()
    const sender = { id: 9002 }
    fromWebContents.mockReturnValue(null)

    const handler = ipcListeners.get('mt::update-review-menu')
    handler?.({ sender }, reviewState)

    expect(updateReviewMenu).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('Review'))
    expect(appMenu.windowMenus.size).toBe(0)
  })

  it('does not expose a renderer-supplied window id in the typed IPC contract', () => {
    const ipcTypes = fs.readFileSync(path.resolve(
      __dirname,
      '../../../src/shared/types/ipc.ts'
    ), 'utf8')
    const channelStart = ipcTypes.indexOf("'mt::update-review-menu'")
    expect(channelStart).toBeGreaterThanOrEqual(0)
    const channelContract = ipcTypes.slice(channelStart, channelStart + 180)

    expect(channelContract).not.toContain('windowId')
    expect(channelContract).toContain('state: CriticMarkupReviewMenuState')
  })
})

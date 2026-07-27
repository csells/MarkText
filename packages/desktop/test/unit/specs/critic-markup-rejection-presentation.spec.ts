import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, ref, shallowRef, type App, type Ref } from 'vue'

import {
  CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS,
  type ICriticMarkupTrackChangeRejection,
  type TCriticMarkupTrackChangeRejectionReason
} from '@marktext/document-view'

const { pushTabNotification } = vi.hoisted(() => ({ pushTabNotification: vi.fn() }))

// The composable resolves the editor store internally (mirroring the Review
// controller); stub the store module so the spec does not drag in the full
// editor-store import graph.
vi.mock('@/store/editor', () => ({
  useEditorStore: () => ({ pushTabNotification })
}))

import {
  presentTrackChangeRejection,
  TRACK_CHANGE_REJECTION_EXCLUSIVE_TYPE,
  TRACK_CHANGE_REJECTION_MESSAGE_KEYS,
  TRACK_CHANGE_REJECTION_UNKNOWN_KEY,
  TRACK_CHANGE_REJECTION_TITLE_KEY,
  useCriticMarkupRejectionNotifier
} from '@/components/editorWithTabs/useCriticMarkupRejectionNotifier'
type RejectionListener = (rejection: ICriticMarkupTrackChangeRejection) => void

class FakeDocumentViewEvents {
  subscribeCount = 0
  disposeCount = 0
  private readonly listeners = new Set<RejectionListener>()

  subscribeTrackChangeRejection(listener: RejectionListener): Readonly<{ dispose: () => void }> {
    this.subscribeCount += 1
    this.listeners.add(listener)
    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        this.disposeCount += 1
        this.listeners.delete(listener)
      }
    }
  }

  emitRejection(rejection: ICriticMarkupTrackChangeRejection): void {
    this.listeners.forEach((listener) => listener(rejection))
  }

  listenerCount(): number {
    return this.listeners.size
  }
}

const rejection = (
  reason: TCriticMarkupTrackChangeRejectionReason
): ICriticMarkupTrackChangeRejection => ({
  beforeMarkdown: 'before',
  reason
})

const mountNotifier = (
  editor: Ref<FakeDocumentViewEvents | null>,
  tabId: Ref<string | null>
): App => {
  const app = createApp(
    defineComponent({
      setup() {
        useCriticMarkupRejectionNotifier({ editor, tabId })
        return () => h('div')
      }
    })
  )
  app.mount(document.createElement('div'))
  return app
}

const desktopRoot = path.resolve(__dirname, '../../..')

const getPath = (value: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, value)

const readLocale = (file: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(desktopRoot, 'static/locales', file), 'utf8')) as unknown

const enLocale = readLocale('en.json')

const localeFiles = [
  'de.json',
  'en.json',
  'es.json',
  'fr.json',
  'ja.json',
  'ko.json',
  'pt.json',
  'tr.json',
  'zh-CN.json',
  'zh-TW.json'
] as const

describe('Track Changes rejection presentation', () => {
  beforeEach(() => pushTabNotification.mockClear())

  it('covers exactly the engine-published fail-closed rejection taxonomy', () => {
    expect(new Set(CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS).size)
      .toBe(CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS.length)
    expect(Object.keys(TRACK_CHANGE_REJECTION_MESSAGE_KEYS).sort())
      .toEqual([...CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS].sort())
  })

  it.each([...CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS])(
    'enqueues exactly one localized warning banner for %s',
    (reason) => {
      const fake = new FakeDocumentViewEvents()
      const app = mountNotifier(shallowRef<FakeDocumentViewEvents | null>(fake), ref('tab-1'))
      try {
        fake.emitRejection(rejection(reason))

        const title = getPath(enLocale, TRACK_CHANGE_REJECTION_TITLE_KEY)
        const body = getPath(
          enLocale,
          TRACK_CHANGE_REJECTION_MESSAGE_KEYS[reason]
        )
        expect(title).toEqual(expect.any(String))
        expect(body).toEqual(expect.any(String))

        expect(pushTabNotification).toHaveBeenCalledTimes(1)
        expect(pushTabNotification).toHaveBeenCalledWith({
          tabId: 'tab-1',
          msg: `${title}: ${body}`,
          showConfirm: false,
          style: 'warn',
          exclusiveType: TRACK_CHANGE_REJECTION_EXCLUSIVE_TYPE
        })
      } finally {
        app.unmount()
      }
    }
  )

  it('fails closed to localized copy for an unknown engine reason', () => {
    const forgedReason = 'forged-future-rejection'
    const translate = (key: string): string => `[${key}]`

    presentTrackChangeRejection(
      {
        beforeMarkdown: 'unchanged',
        reason: forgedReason
      } as unknown as ICriticMarkupTrackChangeRejection,
      'tab-1',
      { pushTabNotification },
      translate
    )

    expect(pushTabNotification).toHaveBeenCalledTimes(1)
    expect(pushTabNotification).toHaveBeenCalledWith(expect.objectContaining({
      msg: `[${TRACK_CHANGE_REJECTION_TITLE_KEY}]: [${TRACK_CHANGE_REJECTION_UNKNOWN_KEY}]`
    }))
    expect(pushTabNotification.mock.calls[0]?.[0].msg)
      .not.toContain(forgedReason)
  })

  it('subscribes once per document-view instance and unsubscribes on swap and unmount', () => {
    const first = new FakeDocumentViewEvents()
    const second = new FakeDocumentViewEvents()
    const editor = shallowRef<FakeDocumentViewEvents | null>(first)
    const app = mountNotifier(editor, ref('tab-1'))

    expect(first.subscribeCount).toBe(1)
    expect(first.listenerCount()).toBe(1)

    editor.value = second
    expect(first.disposeCount).toBe(1)
    expect(first.listenerCount()).toBe(0)
    expect(second.subscribeCount).toBe(1)

    app.unmount()
    expect(second.disposeCount).toBe(1)
    expect(second.listenerCount()).toBe(0)

    // A rejection published after teardown must not resurrect a banner.
    second.emitRejection(rejection('precommit-failed'))
    expect(pushTabNotification).not.toHaveBeenCalled()
  })

  it('drops the banner rather than guessing a tab when no tab is active', () => {
    const fake = new FakeDocumentViewEvents()
    const app = mountNotifier(shallowRef<FakeDocumentViewEvents | null>(fake), ref(null))
    try {
      fake.emitRejection(rejection('stale-selection'))
      expect(pushTabNotification).not.toHaveBeenCalled()
    } finally {
      app.unmount()
    }
  })

  it('never touches window focus APIs while presenting a rejection', () => {
    const windowFocus = vi.spyOn(window, 'focus').mockImplementation(() => {})
    const elementFocus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {})
    const fake = new FakeDocumentViewEvents()
    const app = mountNotifier(
      shallowRef<FakeDocumentViewEvents | null>(fake),
      ref('tab-1')
    )
    try {
      for (const reason of CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS) {
        fake.emitRejection(rejection(reason))
      }
      expect(pushTabNotification).toHaveBeenCalledTimes(
        CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS.length
      )
      expect(windowFocus).not.toHaveBeenCalled()
      expect(elementFocus).not.toHaveBeenCalled()
    } finally {
      app.unmount()
      windowFocus.mockRestore()
      elementFocus.mockRestore()
    }
  })

  it('stays on the in-app banner surface — no focus calls or native dialogs in source', () => {
    const rendererRoot = path.join(desktopRoot, 'src/renderer/src')
    const surfaceFiles = [
      path.join(rendererRoot, 'components/editorWithTabs/useCriticMarkupRejectionNotifier.ts'),
      path.join(rendererRoot, 'components/editorWithTabs/notifications.vue')
    ]

    for (const file of surfaceFiles) {
      const source = fs.readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(
        /\.focus\(|autofocus|new Notification\(|alert\(|showMessageBox/
      )
    }
  })

  it.each(localeFiles)('%s localizes every rejection presentation key', (file) => {
    const locale = readLocale(file)
    const keys = [
      TRACK_CHANGE_REJECTION_TITLE_KEY,
      ...new Set(Object.values(TRACK_CHANGE_REJECTION_MESSAGE_KEYS)),
      TRACK_CHANGE_REJECTION_UNKNOWN_KEY
    ]
    for (const key of keys) {
      const message = getPath(locale, key)
      expect(message, `${file}: ${key}`).toEqual(expect.any(String))
      expect((message as string).trim(), `${file}: ${key}`).not.toBe('')
    }
  })
})

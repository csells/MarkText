import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, ref, shallowRef, type App, type Ref } from 'vue'

import {
  CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS,
  type ICriticMarkupTrackChangeRejection,
  type TCriticMarkupTrackChangeRejectionReason
} from '@muyajs/core'

const { pushTabNotification } = vi.hoisted(() => ({ pushTabNotification: vi.fn() }))

// The composable resolves the editor store internally (mirroring the Review
// controller); stub the store module so the spec does not drag in the full
// editor-store import graph.
vi.mock('@/store/editor', () => ({
  useEditorStore: () => ({ pushTabNotification })
}))

import {
  TRACK_CHANGE_REJECTION_BODY_KEYS,
  TRACK_CHANGE_REJECTION_EXCLUSIVE_TYPE,
  TRACK_CHANGE_REJECTION_TITLE_KEY,
  useCriticMarkupRejectionNotifier
} from '@/components/editorWithTabs/useCriticMarkupRejectionNotifier'
import { compileSfcRender, mountTemplate } from '../helpers/mountTemplate'

type RejectionListener = (rejection: ICriticMarkupTrackChangeRejection) => void

const REJECTED_EVENT = 'critic-markup-track-change-rejected'

class FakeMuyaEvents {
  readonly onEvents: string[] = []
  readonly offEvents: string[] = []
  private readonly listeners = new Map<string, Set<RejectionListener>>()

  on(event: string, listener: RejectionListener): void {
    this.onEvents.push(event)
    const bucket = this.listeners.get(event) ?? new Set<RejectionListener>()
    bucket.add(listener)
    this.listeners.set(event, bucket)
  }

  off(event: string, listener: RejectionListener): void {
    this.offEvents.push(event)
    this.listeners.get(event)?.delete(listener)
  }

  emitRejection(rejection: ICriticMarkupTrackChangeRejection): void {
    this.listeners.get(REJECTED_EVENT)?.forEach((listener) => listener(rejection))
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  }
}

const rejection = (
  reason: TCriticMarkupTrackChangeRejectionReason
): ICriticMarkupTrackChangeRejection => ({
  beforeMarkdown: 'before',
  proposedMarkdown: 'proposed',
  reason
})

const mountNotifier = (editor: Ref<FakeMuyaEvents | null>, tabId: Ref<string | null>): App => {
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
    expect(Object.keys(TRACK_CHANGE_REJECTION_BODY_KEYS).sort()).toEqual(
      [...CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS].sort()
    )
  })

  it.each([...CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS])(
    'enqueues exactly one localized warning banner for %s',
    (reason) => {
      const fake = new FakeMuyaEvents()
      const app = mountNotifier(shallowRef<FakeMuyaEvents | null>(fake), ref('tab-1'))
      try {
        fake.emitRejection(rejection(reason))

        const title = getPath(enLocale, TRACK_CHANGE_REJECTION_TITLE_KEY)
        const body = getPath(enLocale, TRACK_CHANGE_REJECTION_BODY_KEYS[reason])
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

  it('subscribes once per muya instance and unsubscribes on swap and unmount', () => {
    const first = new FakeMuyaEvents()
    const second = new FakeMuyaEvents()
    const editor = shallowRef<FakeMuyaEvents | null>(first)
    const app = mountNotifier(editor, ref('tab-1'))

    expect(first.onEvents).toEqual([REJECTED_EVENT])
    expect(first.listenerCount(REJECTED_EVENT)).toBe(1)

    editor.value = second
    expect(first.offEvents).toEqual([REJECTED_EVENT])
    expect(first.listenerCount(REJECTED_EVENT)).toBe(0)
    expect(second.onEvents).toEqual([REJECTED_EVENT])

    app.unmount()
    expect(second.offEvents).toEqual([REJECTED_EVENT])
    expect(second.listenerCount(REJECTED_EVENT)).toBe(0)

    // A rejection published after teardown must not resurrect a banner.
    second.emitRejection(rejection('parser-conflict'))
    expect(pushTabNotification).not.toHaveBeenCalled()
  })

  it('drops the banner rather than guessing a tab when no tab is active', () => {
    const fake = new FakeMuyaEvents()
    const app = mountNotifier(shallowRef<FakeMuyaEvents | null>(fake), ref(null))
    try {
      fake.emitRejection(rejection('unmappable-source-edit'))
      expect(pushTabNotification).not.toHaveBeenCalled()
    } finally {
      app.unmount()
    }
  })

  it('never touches window focus APIs while presenting a rejection', () => {
    const windowFocus = vi.spyOn(window, 'focus').mockImplementation(() => {})
    const elementFocus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {})
    const fake = new FakeMuyaEvents()
    const app = mountNotifier(shallowRef<FakeMuyaEvents | null>(fake), ref('tab-1'))
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

  it.each(localeFiles)('%s localizes the rejection title and all four bodies', (file) => {
    const locale = readLocale(file)
    const keys = [
      TRACK_CHANGE_REJECTION_TITLE_KEY,
      ...Object.values(TRACK_CHANGE_REJECTION_BODY_KEYS)
    ]

    for (const key of keys) {
      const message = getPath(locale, key)
      expect(message, `${file}: ${key}`).toEqual(expect.any(String))
      expect((message as string).trim(), `${file}: ${key}`).not.toBe('')
    }
  })
})

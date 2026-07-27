import { describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS,
  de,
  en,
  es,
  fr,
  ja,
  ko,
  pt,
  tr,
  zhCN,
  zhTW
} from '@marktext/document-view'
import {
  REVIEW_COMMAND_DESCRIPTORS
} from '../../../src/common/commands/review'
import {
  applyDesktopDocumentViewLocale,
  bindDesktopReviewLocale
} from '@/components/editorWithTabs/documentViewLocale'

vi.mock('@/store/editor', () => ({
  useEditorStore: () => ({ pushTabNotification: vi.fn() })
}))

import {
  presentTrackChangeRejection,
  TRACK_CHANGE_REJECTION_EXCLUSIVE_TYPE,
  TRACK_CHANGE_REJECTION_MESSAGE_KEYS,
  TRACK_CHANGE_REJECTION_UNKNOWN_KEY,
  TRACK_CHANGE_REJECTION_TITLE_KEY
} from '@/components/editorWithTabs/useCriticMarkupRejectionNotifier'
import {
  CRITIC_MARKUP_REVIEW_COMMAND_REJECTION_KEY
} from '@/components/editorWithTabs/criticMarkupReview'

const DESKTOP_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
)
const LOCALE_ROOT = path.resolve(DESKTOP_ROOT, 'static/locales')

function atPath(value: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((current, part) => {
    if (current === null || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[part]
  }, value)
}

describe('document-core Review presentation', () => {
  it('binds the Comment indicator label to every shipped desktop locale artifact', () => {
    const localeFiles = fs.readdirSync(LOCALE_ROOT)
      .filter((name) => name.endsWith('.json'))
    expect(localeFiles).toHaveLength(20)

    for (const file of localeFiles) {
      const desktopLocale = JSON.parse(
        fs.readFileSync(path.resolve(LOCALE_ROOT, file), 'utf8')
      ) as unknown
      const language = file.replace(/(?:\.min)?\.json$/, '')
      const expected = atPath(desktopLocale, 'sideBar.review.types.comment')
      expect(expected, `${file}: sideBar.review.types.comment`)
        .toEqual(expect.any(String))

      const boundLocale = bindDesktopReviewLocale(language, String(expected))
      expect(boundLocale.resource.Comment, file).toBe(expected)
    }
  })

  it('waits for the desktop locale before applying its Comment label to the view', async() => {
    let releaseLocale!: () => void
    const localeReady = new Promise<void>((resolve) => {
      releaseLocale = resolve
    })
    const ensureDesktopLocale = vi.fn(() => localeReady)
    const translate = vi.fn((key: string) =>
      key === 'sideBar.review.types.comment' ? 'Desktop Kommentar' : key)
    const setLocale = vi.fn()

    const applying = applyDesktopDocumentViewLocale({
      language: 'de',
      ensureDesktopLocale,
      translate,
      setLocale
    })

    expect(ensureDesktopLocale).toHaveBeenCalledWith('de')
    expect(setLocale).not.toHaveBeenCalled()

    releaseLocale()
    await applying

    expect(translate).toHaveBeenCalledWith('sideBar.review.types.comment')
    expect(setLocale).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'de',
        resource: expect.objectContaining({
          Comment: 'Desktop Kommentar'
        })
      })
    )
  })

  it('localizes the target-owned pointer Review action in every shipped locale', () => {
    for (const locale of [de, en, es, fr, ja, ko, pt, tr, zhCN, zhTW]) {
      expect(locale.resource.Review, locale.name).toEqual(expect.any(String))
      expect(locale.resource.Review.trim(), locale.name).not.toBe('')
    }
  })

  it('localizes every legal and rejected command presentation', () => {
    const localeFiles = fs.readdirSync(LOCALE_ROOT)
      .filter((name) => name.endsWith('.json'))
    expect(localeFiles.length).toBeGreaterThan(1)

    const requiredKeys = [
      ...REVIEW_COMMAND_DESCRIPTORS.flatMap((descriptor) => [
        descriptor.menuLabelKey,
        descriptor.descriptionKey
      ]),
      'menu.review.review',
      'menu.review.display',
      'sideBar.review.unavailable',
      CRITIC_MARKUP_REVIEW_COMMAND_REJECTION_KEY,
      TRACK_CHANGE_REJECTION_TITLE_KEY,
      ...new Set(Object.values(TRACK_CHANGE_REJECTION_MESSAGE_KEYS)),
      TRACK_CHANGE_REJECTION_UNKNOWN_KEY
    ]
    for (const file of localeFiles) {
      const locale = JSON.parse(
        fs.readFileSync(path.resolve(LOCALE_ROOT, file), 'utf8')
      ) as unknown
      for (const key of requiredKeys) {
        expect(atPath(locale, key), `${file}: ${key}`).toEqual(expect.any(String))
        expect(String(atPath(locale, key)).trim(), `${file}: ${key}`).not.toBe('')
      }
    }

    const pushTabNotification = vi.fn()
    for (const reason of CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS) {
      presentTrackChangeRejection(
        { beforeMarkdown: 'unchanged', reason },
        'document-core-tab',
        { pushTabNotification },
        (key) => `[${key}]`
      )
      expect(pushTabNotification).toHaveBeenLastCalledWith({
        tabId: 'document-core-tab',
        msg: `[${TRACK_CHANGE_REJECTION_TITLE_KEY}]: [${TRACK_CHANGE_REJECTION_MESSAGE_KEYS[reason]}]`,
        showConfirm: false,
        style: 'warn',
        exclusiveType: TRACK_CHANGE_REJECTION_EXCLUSIVE_TYPE
      })
    }
  })
})

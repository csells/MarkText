import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  REVIEW_COMMAND_DESCRIPTORS,
  isReviewCommandAvailable
} from 'common/commands/review'
import bus from '@/bus'
import commands from '@/commands'
import keybindingsDarwin from 'main_renderer/keyboard/keybindingsDarwin'
import keybindingsLinux from 'main_renderer/keyboard/keybindingsLinux'
import keybindingsWindows from 'main_renderer/keyboard/keybindingsWindows'

const DESCRIPTOR_PROJECTION = [
  [
    'review.toggle-track-changes', 'toggle-track-changes',
    'reviewTrackChangesMenuItem', 'menu.review.trackChanges',
    'commands.review.trackChanges', 'checkbox', 'tracking'
  ],
  [
    'review.mark-addition', 'mark-addition',
    'reviewMarkAdditionMenuItem', 'menu.review.markAddition',
    'commands.review.markAddition', 'normal', 'authoring'
  ],
  [
    'review.mark-deletion', 'mark-deletion',
    'reviewMarkDeletionMenuItem', 'menu.review.markDeletion',
    'commands.review.markDeletion', 'normal', 'authoring'
  ],
  [
    'review.suggest-replacement', 'suggest-replacement',
    'reviewSuggestReplacementMenuItem', 'menu.review.suggestReplacement',
    'commands.review.suggestReplacement', 'normal', 'authoring'
  ],
  [
    'review.highlight', 'mark-highlight',
    'reviewHighlightMenuItem', 'menu.review.highlight',
    'commands.review.highlight', 'normal', 'authoring'
  ],
  [
    'review.add-comment', 'add-comment',
    'reviewAddCommentMenuItem', 'menu.review.addComment',
    'commands.review.addComment', 'normal', 'authoring'
  ],
  [
    'review.previous', 'previous',
    'reviewPreviousMenuItem', 'menu.review.previous',
    'commands.review.previous', 'normal', 'navigation'
  ],
  [
    'review.next', 'next',
    'reviewNextMenuItem', 'menu.review.next',
    'commands.review.next', 'normal', 'navigation'
  ],
  [
    'review.accept-current', 'accept-current',
    'reviewAcceptCurrentMenuItem', 'menu.review.acceptCurrent',
    'commands.review.acceptCurrent', 'normal', 'resolution'
  ],
  [
    'review.reject-current', 'reject-current',
    'reviewRejectCurrentMenuItem', 'menu.review.rejectCurrent',
    'commands.review.rejectCurrent', 'normal', 'resolution'
  ],
  [
    'review.accept-all', 'accept-all',
    'reviewAcceptAllMenuItem', 'menu.review.acceptAll',
    'commands.review.acceptAll', 'normal', 'resolution'
  ],
  [
    'review.reject-all', 'reject-all',
    'reviewRejectAllMenuItem', 'menu.review.rejectAll',
    'commands.review.rejectAll', 'normal', 'resolution'
  ],
  [
    'review.show-marked', 'show-marked',
    'reviewShowMarkedMenuItem', 'menu.review.showMarked',
    'commands.review.showMarked', 'radio', 'projection'
  ],
  [
    'review.show-original', 'show-original',
    'reviewShowOriginalMenuItem', 'menu.review.showOriginal',
    'commands.review.showOriginal', 'radio', 'projection'
  ],
  [
    'review.show-revised', 'show-revised',
    'reviewShowRevisedMenuItem', 'menu.review.showRevised',
    'commands.review.showRevised', 'radio', 'projection'
  ]
] as const

const desktopRoot = path.resolve(__dirname, '../../..')
const sourceRoot = path.join(desktopRoot, 'src')
const registryPath = path.join(sourceRoot, 'common/commands/review.ts')

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

const getPath = (value: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, value)

const sourceFiles = (directory: string): string[] => fs.readdirSync(directory, {
  withFileTypes: true
}).flatMap((entry) => {
  const fullPath = path.join(directory, entry.name)
  if (entry.isDirectory()) return sourceFiles(fullPath)
  return /\.(?:ts|vue)$/.test(entry.name) ? [fullPath] : []
})

describe('single CriticMarkup Review command descriptor registry', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is the exhaustive source of ids, actions, menu metadata, descriptions, and defaults', () => {
    expect(REVIEW_COMMAND_DESCRIPTORS.map((descriptor) => [
      descriptor.id,
      descriptor.action,
      descriptor.menuId,
      descriptor.menuLabelKey,
      descriptor.descriptionKey,
      descriptor.menuType,
      descriptor.group
    ])).toEqual(DESCRIPTOR_PROJECTION)

    expect(new Set(REVIEW_COMMAND_DESCRIPTORS.map(({ id }) => id)).size).toBe(15)
    expect(new Set(REVIEW_COMMAND_DESCRIPTORS.map(({ action }) => action)).size).toBe(15)
    expect(new Set(REVIEW_COMMAND_DESCRIPTORS.map(({ menuId }) => menuId)).size).toBe(15)
    expect(REVIEW_COMMAND_DESCRIPTORS.every(({ defaultKeybinding }) =>
      defaultKeybinding === '')).toBe(true)
  })

  it('owns one availability rule for menu and palette command surfaces', () => {
    const state = {
      available: true,
      canCreateAddition: false,
      canCreateDeletion: false,
      canCreateSubstitution: false,
      canCreateHighlight: false,
      canCreateComment: false,
      canNavigate: true,
      canResolveCurrent: true,
      canResolveAll: false,
      trackChanges: false,
      projection: 'marked' as const
    }
    const command = (id: string) => {
      const descriptor = REVIEW_COMMAND_DESCRIPTORS.find(
        candidate => candidate.id === id
      )
      if (!descriptor) throw new Error(`Missing Review command ${id}`)
      return descriptor
    }

    expect(isReviewCommandAvailable(command('review.next'), state)).toBe(true)
    expect(isReviewCommandAvailable(command('review.accept-current'), state))
      .toBe(true)
    expect(isReviewCommandAvailable(command('review.accept-all'), state))
      .toBe(false)
    expect(isReviewCommandAvailable(command('review.mark-addition'), state))
      .toBe(false)
    // Navigation walks the marked projection's cards, so a resolved
    // projection makes it unavailable even while items exist.
    expect(isReviewCommandAvailable(command('review.next'), {
      ...state,
      projection: 'revised'
    })).toBe(false)
    expect(isReviewCommandAvailable(command('review.next'), {
      ...state,
      available: false
    })).toBe(false)
  })

  it('drives all three platform keybinding tables', () => {
    for (const descriptor of REVIEW_COMMAND_DESCRIPTORS) {
      expect(keybindingsDarwin.get(descriptor.id), `Darwin: ${descriptor.id}`)
        .toBe(descriptor.defaultKeybinding)
      expect(keybindingsLinux.get(descriptor.id), `Linux: ${descriptor.id}`)
        .toBe(descriptor.defaultKeybinding)
      expect(keybindingsWindows.get(descriptor.id), `Windows: ${descriptor.id}`)
        .toBe(descriptor.defaultKeybinding)
    }
  })

  it.each(localeFiles)('%s resolves every descriptor label, including Track Changes', (file) => {
    const locale = JSON.parse(fs.readFileSync(
      path.join(desktopRoot, 'static/locales', file),
      'utf8'
    )) as unknown

    for (const descriptor of REVIEW_COMMAND_DESCRIPTORS) {
      const menuLabel = getPath(locale, descriptor.menuLabelKey)
      const description = getPath(locale, descriptor.descriptionKey)
      expect(menuLabel, `${file}: ${descriptor.menuLabelKey}`).toEqual(expect.any(String))
      expect(description, `${file}: ${descriptor.descriptionKey}`).toEqual(expect.any(String))
      expect((menuLabel as string).trim(), `${file}: ${descriptor.menuLabelKey}`).not.toBe('')
      expect((description as string).trim(), `${file}: ${descriptor.descriptionKey}`).not.toBe('')
    }
  })

  it('is the only production source that spells Review command ids', () => {
    const commandId = new RegExp(
      'review\\.(?:toggle-track-changes|mark-addition|mark-deletion|' +
      'suggest-replacement|highlight|add-comment|previous|next|' +
      'accept-current|reject-current|accept-all|reject-all|' +
      'show-marked|show-original|show-revised)'
    )
    const offenders = sourceFiles(sourceRoot)
      .filter((file) => file !== registryPath)
      .filter((file) => commandId.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(desktopRoot, file))

    expect(offenders).toEqual([])
  })

  it('is the only production source that spells descriptor-owned menu metadata', () => {
    const menuId = new RegExp(
      'review(?:TrackChanges|MarkAddition|MarkDeletion|SuggestReplacement|' +
      'Highlight|AddComment|Previous|Next|AcceptCurrent|RejectCurrent|' +
      'AcceptAll|RejectAll|ShowMarked|ShowOriginal|ShowRevised)MenuItem'
    )
    const translationKey = new RegExp(
      '(?:menu|commands)\\.review\\.(?:trackChanges|markAddition|' +
      'markDeletion|suggestReplacement|highlight|addComment|previous|next|' +
      'acceptCurrent|rejectCurrent|acceptAll|rejectAll|showMarked|' +
      'showOriginal|showRevised)'
    )
    const offenders = sourceFiles(sourceRoot)
      .filter((file) => file !== registryPath)
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8')
        return menuId.test(source) || translationKey.test(source)
      })
      .map((file) => path.relative(desktopRoot, file))

    expect(offenders).toEqual([])
  })

  it.each(REVIEW_COMMAND_DESCRIPTORS)(
    'captures the active Review context synchronously for $id',
    async({ id, action }) => {
      vi.useFakeTimers()
      const received: unknown[] = []
      const listener = (payload: unknown): void => {
        received.push(payload)
      }
      bus.on('critic-markup-review', listener)

      try {
        await commands.find((command) => command.id === id)?.execute?.()
        expect(received).toEqual([action])
      } finally {
        bus.off('critic-markup-review', listener)
      }
    }
  )
})

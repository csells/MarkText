import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const locales = [
  ['de', 'Kommentar', 'Wiederhergestellte Entwürfe'],
  ['es', 'Comentario', 'Borradores recuperados'],
  ['fr', 'Commentaire', 'Brouillons récupérés'],
  ['ja', 'コメント', '復元された下書き'],
  ['ko', '댓글', '복구된 초안'],
  ['nl', 'Opmerking', 'Herstelde concepten'],
  ['pt', 'Comentário', 'Rascunhos recuperados'],
  ['tr', 'Yorum', 'Kurtarılan taslaklar'],
  ['zh-CN', '批注', '已恢复的草稿'],
  ['zh-TW', '註解', '已復原的草稿']
] as const

const leafKeys = (value: Record<string, unknown>, prefix: string): string[] =>
  Object.entries(value).flatMap(([key, child]) =>
    typeof child === 'object' && child !== null
      ? leafKeys(child as Record<string, unknown>, `${prefix}.${key}`)
      : [`${prefix}.${key}`]
  )

describe('Review and recovery use the existing locale loader', () => {
  it('loads translated controls, accessible names and safe recovery interpolation in every supported non-English locale', async() => {
    const before = Object.getOwnPropertyDescriptor(window, 'i18nUtils')
    const loadTranslations = vi.fn((locale: string) =>
      JSON.parse(readFileSync(resolve('static/locales', `${locale}.json`), 'utf8'))
    )
    Object.defineProperty(window, 'i18nUtils', { configurable: true, value: { loadTranslations } })
    try {
      const { setLanguage, t } = await import('../../../src/renderer/src/i18n')
      for (const [locale, comment, recovery] of locales) {
        await setLanguage(locale)
        expect(t('editor.coreReview.commentPrompt')).toBe(comment)
        expect(t('editor.coreRecovery.title')).toBe(recovery)
        expect(t('common.cancel')).not.toBe('Cancel')
        const messages = loadTranslations(locale)
        for (const section of ['coreReview', 'coreRecovery']) {
          for (const key of leafKeys(messages.editor[section], `editor.${section}`)) {
            const result = t(key, {
              current: 2,
              total: 3,
              error: 'disk unavailable',
              name: 'draft.md'
            })
            expect(result).not.toBe(key)
            expect(result).not.toMatch(/\{(?:current|total|error|name)\}/u)
          }
        }
        expect(t('editor.coreRecovery.backupError', { error: 'disk unavailable' })).toContain(
          'disk unavailable'
        )
      }
      await setLanguage('en')
      expect(t('editor.coreReview.commentPrompt')).toBe('Comment')
    } finally {
      if (before) Object.defineProperty(window, 'i18nUtils', before)
      else Reflect.deleteProperty(window, 'i18nUtils')
    }
  })
})

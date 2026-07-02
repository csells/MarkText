import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface MockI18nUtils {
  loadTranslations: Mock
}

// Window.i18nUtils is required in the runtime contextBridge typing, but in
// this unit test we install a mock with `vi.fn` and remove it between specs.
const win = window as unknown as { i18nUtils?: MockI18nUtils }
const localesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../static/locales'
)

const i18nUtils = (): MockI18nUtils => {
  if (!win.i18nUtils) throw new Error('i18nUtils test mock was not installed')
  return win.i18nUtils
}

describe('renderer i18n language loading', () => {
  beforeEach(() => {
    vi.resetModules()
    win.i18nUtils = {
      loadTranslations: vi.fn((locale: string) => ({
        locale,
        menu: {
          file: {
            file: 'File'
          }
        }
      }))
    }
  })

  afterEach(() => {
    delete win.i18nUtils
  })

  it('does not reload the default English locale', async() => {
    const { setLanguage, getCurrentLanguage } = await import('../../../src/renderer/src/i18n')

    setLanguage('en')

    expect(i18nUtils().loadTranslations).not.toHaveBeenCalled()
    expect(getCurrentLanguage()).to.equal('en')
  })

  it('loads an unavailable locale only once', async() => {
    const { setLanguage } = await import('../../../src/renderer/src/i18n')

    setLanguage('zh-CN')
    setLanguage('zh-CN')

    expect(i18nUtils().loadTranslations).toHaveBeenCalledTimes(1)
    expect(i18nUtils().loadTranslations).toHaveBeenCalledWith('zh-CN')
  })
})

// Issue #4046: exporting HTML/PDF surfaced an "Unexpected renderer process
// error" — a vue-i18n message-compiler SyntaxError (code 9,
// NOT_ALLOW_NEST_PLACEHOLDER) thrown while lazily compiling a translation whose
// value contained a nested placeholder (e.g. literal `{{type}}`). A single
// malformed translation must degrade to raw text, never crash the renderer.
describe('renderer i18n malformed-message resilience (issue #4046)', () => {
  beforeEach(() => {
    vi.resetModules()
    win.i18nUtils = { loadTranslations: vi.fn() }
  })

  afterEach(() => {
    delete win.i18nUtils
  })

  interface TestComposer {
    setLocaleMessage: (locale: string, message: Record<string, unknown>) => void
    locale: { value: string }
    t: (key: string, named?: Record<string, unknown>) => string
  }

  it('does not throw when a registered message contains a nested placeholder', async() => {
    const { i18n } = await import('../../../src/renderer/src/i18n')
    const composer = i18n.global as unknown as TestComposer

    composer.setLocaleMessage('xx', { export: { failed: 'Failed {{type}} export' } })
    composer.locale.value = 'xx'

    expect(() => composer.t('export.failed', { type: 'PDF' })).not.toThrow()
    expect(composer.t('export.failed', { type: 'PDF' })).toBe('Failed {{type}} export')
  })

  it('still interpolates well-formed messages', async() => {
    const { i18n } = await import('../../../src/renderer/src/i18n')
    const composer = i18n.global as unknown as TestComposer

    composer.setLocaleMessage('xx', { greeting: 'Hello {name}' })
    composer.locale.value = 'xx'

    expect(composer.t('greeting', { name: 'World' })).toBe('Hello World')
  })
})

describe('desktop locale completeness for markdown comments', () => {
  it('ships the comments sidebar strings in every source locale', () => {
    const expectedCommentKeys = [
      'add',
      'all',
      'cancelEdit',
      'defaultAuthor',
      'diagnostics',
      'edit',
      'editPlaceholder',
      'empty',
      'jump',
      'open',
      'reopen',
      'reply',
      'replyPlaceholder',
      'resolve',
      'resolved',
      'saveEdit',
      'selectTextHint',
      'sourceModeUnavailable',
      'summary',
      'title',
      'updateFailed'
    ]

    const localeFiles = readdirSync(localesDir)
      .filter(file => file.endsWith('.json') && !file.endsWith('.min.json'))

    for (const file of localeFiles) {
      const locale = JSON.parse(readFileSync(resolve(localesDir, file), 'utf8')) as {
        sideBar?: {
          comments?: Record<string, unknown>
          icons?: Record<string, unknown>
        }
      }

      expect(Object.keys(locale.sideBar?.comments ?? {}).sort(), file).toEqual(
        expectedCommentKeys.sort()
      )
      expect(locale.sideBar?.icons?.comments, file).toBeTypeOf('string')
    }
  })

  it('ships the Review menu strings in every source locale', () => {
    const localeFiles = readdirSync(localesDir)
      .filter(file => file.endsWith('.json') && !file.endsWith('.min.json'))

    for (const file of localeFiles) {
      const locale = JSON.parse(readFileSync(resolve(localesDir, file), 'utf8')) as {
        menu?: {
          review?: Record<string, unknown>
        }
      }

      expect(locale.menu?.review?.review, file).toBeTypeOf('string')
      expect(locale.menu?.review?.addComment, file).toBeTypeOf('string')
    }
  })

  it('ships Review command-palette strings in every source locale', () => {
    const localeFiles = readdirSync(localesDir)
      .filter(file => file.endsWith('.json') && !file.endsWith('.min.json'))

    for (const file of localeFiles) {
      const locale = JSON.parse(readFileSync(resolve(localesDir, file), 'utf8')) as {
        commands?: {
          review?: Record<string, unknown>
        }
      }

      expect(locale.commands?.review?.addComment, file).toBeTypeOf('string')
    }
  })

  it('ships merge-conflict resolver strings in every source locale', () => {
    const expectedMergeKeys = [
      'acceptMerge',
      'conflictLabel',
      'invalidCommentSyntax',
      'keepEditing',
      'local',
      'markerNotFound',
      'reloadDisk',
      'remote',
      'result',
      'summary',
      'title',
      'unresolvedConflict',
      'useBoth',
      'useLocal',
      'useRemote'
    ]
    const localeFiles = readdirSync(localesDir)
      .filter(file => file.endsWith('.json') && !file.endsWith('.min.json'))

    for (const file of localeFiles) {
      const locale = JSON.parse(readFileSync(resolve(localesDir, file), 'utf8')) as {
        editor?: {
          mergeConflict?: Record<string, unknown>
        }
      }

      expect(Object.keys(locale.editor?.mergeConflict ?? {}).sort(), file).toEqual(
        expectedMergeKeys.sort()
      )
    }
  })

  it('does not describe comment actions as WYSIWYG-only or disabled in source mode', () => {
    const localeFiles = readdirSync(localesDir)
      .filter(file => file.endsWith('.json') && !file.endsWith('.min.json'))

    for (const file of localeFiles) {
      const locale = JSON.parse(readFileSync(resolve(localesDir, file), 'utf8')) as {
        sideBar?: {
          comments?: {
            selectTextHint?: string
            sourceModeUnavailable?: string
          }
        }
      }
      const selectTextHint = locale.sideBar?.comments?.selectTextHint ?? ''
      const sourceModeUnavailable = locale.sideBar?.comments?.sourceModeUnavailable ?? ''

      expect(selectTextHint, file).not.toMatch(/WYSIWYG|source mode|modo fuente|mode source|Quellmodus|ソースモード|소스 모드|modo de código-fonte|Kaynak modu|源码模式|原始碼模式/iu)
      expect(sourceModeUnavailable, file).not.toMatch(/WYSIWYG|source mode|modo fuente|mode source|Quellmodus|ソースモード|소스 모드|modo de código-fonte|Kaynak modu|源码模式|原始碼模式/iu)
    }
  })

  it('ships every external-sync notification string in every source locale', () => {
    const localeFiles = readdirSync(localesDir)
      .filter(file => file.endsWith('.json') && !file.endsWith('.min.json'))

    for (const file of localeFiles) {
      const locale = JSON.parse(readFileSync(resolve(localesDir, file), 'utf8')) as {
        store?: {
          editor?: Record<string, unknown>
        }
      }
      const editor = locale.store?.editor

      expect(editor?.fileChangedOnDiskRecoveryCreated, file).toBeTypeOf('string')
      expect(editor?.fileChangedOnDiskAutoMerged, file).toBeTypeOf('string')
      expect(editor?.fileChangedOnDiskMergeConflict, file).toBeTypeOf('string')
    }
  })

  it('localizes the comments status filter labels in every source locale', () => {
    const localeFiles = readdirSync(localesDir)
      .filter(file => file.endsWith('.json') && !file.endsWith('.min.json'))

    for (const file of localeFiles) {
      const locale = JSON.parse(readFileSync(resolve(localesDir, file), 'utf8')) as {
        sideBar?: { comments?: Record<string, unknown> }
      }
      const comments = locale.sideBar?.comments

      expect(comments?.all, file).toBeTypeOf('string')
      expect(comments?.open, file).toBeTypeOf('string')
      expect(comments?.resolved, file).toBeTypeOf('string')
    }
  })

  it('keeps interpolation placeholders in parity with English for comment/editor strings', () => {
    const localeFiles = readdirSync(localesDir)
      .filter(file => file.endsWith('.json') && !file.endsWith('.min.json'))

    const placeholders = (value: unknown): string =>
      typeof value === 'string'
        ? [...value.matchAll(/\{(\w+)\}/gu)].map(match => match[1]).sort().join(',')
        : ''

    // Scope to the groups this review feature owns/touches. A translation that
    // drops a placeholder silently loses information (e.g. the missing name in
    // a "changed on disk" prompt), so every locale must carry the same set.
    const groups = ['store.editor', 'sideBar.comments']
    const en = JSON.parse(readFileSync(resolve(localesDir, 'en.json'), 'utf8'))
    const pick = (obj: Record<string, unknown>, path: string): Record<string, unknown> =>
      path.split('.').reduce<Record<string, unknown>>((node, key) => (node?.[key] ?? {}) as Record<string, unknown>, obj)

    for (const file of localeFiles) {
      if (file === 'en.json') continue
      const locale = JSON.parse(readFileSync(resolve(localesDir, file), 'utf8'))

      for (const group of groups) {
        const enGroup = pick(en, group)
        const localeGroup = pick(locale, group)
        for (const [key, enValue] of Object.entries(enGroup)) {
          if (typeof enValue !== 'string' || typeof localeGroup[key] !== 'string') continue
          expect(placeholders(localeGroup[key]), `${file} ${group}.${key}`).toBe(placeholders(enValue))
        }
      }
    }
  })

  it('keeps generated minified locale files in parity with source locales', () => {
    const localeFiles = readdirSync(localesDir)
      .filter(file => file.endsWith('.json') && !file.endsWith('.min.json'))

    for (const file of localeFiles) {
      const source = JSON.parse(readFileSync(resolve(localesDir, file), 'utf8'))
      const minifiedPath = resolve(localesDir, file.replace(/\.json$/u, '.min.json'))

      expect(existsSync(minifiedPath), file).toBe(true)
      expect(JSON.parse(readFileSync(minifiedPath, 'utf8')), file).toEqual(source)
    }
  })
})

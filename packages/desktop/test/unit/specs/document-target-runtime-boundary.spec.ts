import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { usePreferencesStore } from '@/store/preferences'
import {
  assertPersistedPreferencePatch,
  MAIN_ONLY_PREFERENCE_KEYS,
  PERSISTED_PREFERENCE_KEYS
} from '@shared/types/preferences'

const DESKTOP_ROOT = path.resolve(__dirname, '../../..')

const REMOVED_VIEW_RUNTIME_PACKAGES = [
  '@electron-toolkit/preload',
  '@popperjs/core',
  'element-resize-detector',
  'execall',
  'flowchart.js',
  'github-markdown-css',
  'html-tags',
  'joplin-turndown-plugin-gfm',
  'katex',
  'mermaid',
  'pako',
  'prismjs',
  'snapsvg-cjs',
  'turndown',
  'vega-embed',
  'webfontloader'
] as const

const REMOVED_DOCUMENT_PREFERENCES = [
  'preferLooseListItem',
  'bulletListMarker',
  'orderListDelimiter',
  'tabSize',
  'listIndentation',
  'preferHeadingStyle',
  'frontmatterType',
  'isHtmlEnabled',
  'trimUnnecessaryCodeBlockEmptyLines',
  'codeBlockLineNumbers'
] as const

const RENAMED_DOCUMENT_PREFERENCES = {
  superSubScript: 'subscriptAndSuperscript',
  footnote: 'footnotes',
  isGitlabCompatibilityEnabled: 'gitLabMath'
} as const

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.resolve(DESKTOP_ROOT, relativePath), 'utf8')
  ) as Record<string, unknown>
}

function containsIdentifier(source: string, identifier: string): boolean {
  return new RegExp(`\\b${identifier}\\b`).test(source)
}

function documentedPreferenceDefaults(
  source: string
): Readonly<Record<string, unknown>> {
  const defaults: Record<string, unknown> = {}
  for (const line of source.split(/\r?\n/)) {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map(cell => cell.trim())
    const [key, _type, rawDefault] = cells
    if (
      key === undefined ||
      rawDefault === undefined ||
      !rawDefault.startsWith('`') ||
      !rawDefault.endsWith('`')
    ) {
      continue
    }
    const literal = rawDefault.slice(1, -1)
    defaults[key] =
      literal === 'true'
        ? true
        : literal === 'false'
          ? false
          : literal === '""'
            ? ''
            : literal === '[]'
              ? []
              : /^-?(?:\d+|\d*\.\d+)$/.test(literal)
                ? Number(literal)
                : literal
  }
  return Object.freeze(defaults)
}

describe('document target runtime boundary', () => {
  it('ships no discarded view runtime package', () => {
    const manifest = readJson('package.json')
    const dependencies = manifest.dependencies as Record<string, string>
    const devDependencies = manifest.devDependencies as Record<string, string>

    expect(
      REMOVED_VIEW_RUNTIME_PACKAGES.filter(
        name => dependencies[name] !== undefined || devDependencies[name] !== undefined
      )
    ).toEqual([])
    expect(devDependencies['@types/element-resize-detector']).toBeUndefined()
    expect(devDependencies['@types/turndown']).toBeUndefined()
    expect(devDependencies['@types/webfontloader']).toBeUndefined()
  })

  it('does not advertise diagram controls without a target-owned renderer', () => {
    const schema = readJson('src/main/preferences/schema.json')
    const defaults = readJson('static/preference.json')
    const publicPreferences = readFileSync(path.resolve(
      DESKTOP_ROOT,
      '../website/content/docs/end-user/PREFERENCES.md'
    ), 'utf8')

    expect(schema.sequenceTheme).toBeUndefined()
    expect(schema.plantumlServer).toBeUndefined()
    expect(defaults.sequenceTheme).toBeUndefined()
    expect(defaults.plantumlServer).toBeUndefined()
    expect(containsIdentifier(publicPreferences, 'sequenceTheme')).toBe(false)
    expect(containsIdentifier(publicPreferences, 'plantumlServer')).toBe(false)
  })

  it('exposes only target-owned document preferences under their parser names', () => {
    const schema = readJson('src/main/preferences/schema.json')
    const defaults = readJson('static/preference.json')
    const documentPreferenceSources = [
      'src/shared/types/preferences.ts',
      'src/renderer/src/store/preferences.ts',
      'src/renderer/src/prefComponents/editor/index.vue',
      'src/renderer/src/prefComponents/editor/config.ts',
      'src/renderer/src/prefComponents/markdown/index.vue',
      '../website/content/docs/end-user/PREFERENCES.md'
    ].map(relativePath =>
      readFileSync(path.resolve(DESKTOP_ROOT, relativePath), 'utf8')
    ).join('\n')

    for (const key of REMOVED_DOCUMENT_PREFERENCES) {
      expect(schema[key], `${key} must not be persisted`).toBeUndefined()
      expect(defaults[key], `${key} must not have a default`).toBeUndefined()
      expect(
        containsIdentifier(documentPreferenceSources, key),
        `${key} must not remain in active UI/types`
      ).toBe(false)
    }

    for (const [discarded, target] of Object.entries(
      RENAMED_DOCUMENT_PREFERENCES
    )) {
      expect(schema[discarded], `${discarded} must be deleted`).toBeUndefined()
      expect(defaults[discarded], `${discarded} must be deleted`).toBeUndefined()
      expect(
        containsIdentifier(documentPreferenceSources, discarded),
        `${discarded} must be deleted`
      ).toBe(false)
      expect(schema[target], `${target} must be schema-validated`).toBeDefined()
      expect(defaults[target], `${target} must have an initial value`)
        .toEqual(expect.any(Boolean))
      expect(
        containsIdentifier(documentPreferenceSources, target),
        `${target} must be target-owned`
      ).toBe(true)
    }
    expect(existsSync(path.resolve(
      DESKTOP_ROOT,
      'src/renderer/src/prefComponents/markdown/config.ts'
    ))).toBe(false)
  })

  it('rejects unknown persisted preference keys instead of ignoring them', () => {
    const schema = readJson('src/main/preferences/schema.json')
    const defaults = readJson('static/preference.json')

    expect(Object.keys(schema).sort()).toEqual([...PERSISTED_PREFERENCE_KEYS].sort())
    expect(Object.keys(defaults).sort()).toEqual([...PERSISTED_PREFERENCE_KEYS].sort())
    for (const key of PERSISTED_PREFERENCE_KEYS) {
      const entry = schema[key] as { readonly default?: unknown }
      expect(
        defaults[key],
        `${key} static default must equal its schema default`
      ).toEqual(entry.default)
    }
    expect(() => assertPersistedPreferencePatch({
      fontSize: 18,
      notADocumentOption: true
    })).toThrow(/notADocumentOption/)
    expect(() => assertPersistedPreferencePatch(null)).toThrow()
    expect(() => assertPersistedPreferencePatch([])).toThrow()
    expect(assertPersistedPreferencePatch({
      fontSize: 18,
      footnotes: true,
      gitLabMath: true
    })).toEqual({
      fontSize: 18,
      footnotes: true,
      gitLabMath: true
    })
    expect(readFileSync(
      path.resolve(DESKTOP_ROOT, 'src/main/preferences/index.ts'),
      'utf8'
    )).toContain('assertPersistedPreferencePatch(settings)')
  })

  it('boots the renderer with the exact renderer-visible persisted defaults', () => {
    const defaults = readJson('static/preference.json')
    setActivePinia(createPinia())
    const rendererPreferences = usePreferencesStore().$state as unknown as
      Record<string, unknown>
    const mainOnly = new Set<string>(MAIN_ONLY_PREFERENCE_KEYS)

    for (const key of PERSISTED_PREFERENCE_KEYS.filter(
      key => !mainOnly.has(key)
    )) {
      expect(
        rendererPreferences[key],
        `${key} renderer default must equal its persisted default`
      ).toEqual(defaults[key])
    }
  })

  it('documents every persisted key with its exact default', () => {
    const defaults = readJson('static/preference.json')
    const documented = documentedPreferenceDefaults(readFileSync(path.resolve(
      DESKTOP_ROOT,
      '../website/content/docs/end-user/PREFERENCES.md'
    ), 'utf8'))

    expect(Object.keys(documented).sort())
      .toEqual([...PERSISTED_PREFERENCE_KEYS].sort())
    for (const key of PERSISTED_PREFERENCE_KEYS) {
      expect(
        documented[key],
        `${key} documented default must equal its persisted default`
      ).toEqual(defaults[key])
    }
  })

  it('localizes only the retained parser grammar switches', () => {
    const localeRoot = path.resolve(DESKTOP_ROOT, 'static/locales')
    const localeFiles = readdirSync(localeRoot)
      .filter(name => name.endsWith('.json') && !name.endsWith('.min.json'))
    expect(localeFiles.length).toBeGreaterThan(0)

    for (const name of localeFiles) {
      const source = readFileSync(path.resolve(localeRoot, name), 'utf8')
      const locale = JSON.parse(source) as {
        readonly preferences?: {
          readonly markdown?: {
            readonly extensions?: Record<string, unknown>
          }
          readonly search?: {
            readonly items?: Record<string, unknown>
          }
        }
      }
      const extensions = locale.preferences?.markdown?.extensions ?? {}
      const searchItems = locale.preferences?.search?.items ?? {}
      for (const key of [
        ...REMOVED_DOCUMENT_PREFERENCES,
        ...Object.keys(RENAMED_DOCUMENT_PREFERENCES)
      ]) {
        expect(extensions[key], `${name} extensions.${key}`)
          .toBeUndefined()
        expect(searchItems[key], `${name} search.items.${key}`)
          .toBeUndefined()
      }
      for (const key of Object.values(RENAMED_DOCUMENT_PREFERENCES)) {
        expect(extensions[key], `${name} extensions.${key}`)
          .toEqual(expect.any(String))
        expect(searchItems[key], `${name} search.items.${key}`)
          .toEqual(expect.any(String))
      }
    }
  })
})

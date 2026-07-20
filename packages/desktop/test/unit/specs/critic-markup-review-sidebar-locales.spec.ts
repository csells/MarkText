import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { minifyLocaleJson } from '../../../../../scripts/minifyLocaleJson'

const desktopRoot = path.resolve(__dirname, '../../..')
const localesRoot = path.join(desktopRoot, 'static/locales')
const localeNames = [
  'de',
  'en',
  'es',
  'fr',
  'ja',
  'ko',
  'pt',
  'tr',
  'zh-CN',
  'zh-TW'
] as const

type LocaleLeaf = string
type LocaleTree = { [key: string]: LocaleLeaf | LocaleTree }

const readLocaleSource = (name: string): string => {
  return fs.readFileSync(path.join(localesRoot, `${name}.json`), 'utf8')
}

const readLocale = (name: string): LocaleTree => {
  return JSON.parse(readLocaleSource(name)) as LocaleTree
}

const flattenLocale = (tree: LocaleTree, prefix = ''): Record<string, LocaleLeaf> => {
  const flattened: Record<string, LocaleLeaf> = {}

  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key

    if (typeof value === 'string') {
      flattened[path] = value
    } else {
      Object.assign(flattened, flattenLocale(value, path))
    }
  }

  return flattened
}

const placeholders = (message: string): string[] => {
  return [...message.matchAll(/\{[A-Za-z][A-Za-z0-9_]*\}/g)]
    .map(match => match[0])
    .sort()
}

const english = flattenLocale(readLocale('en'))
const englishKeys = Object.keys(english).sort()

describe('desktop locale artifact contract', () => {
  it.each(localeNames)('%s localizes the native Edit Comment command', (name) => {
    const locale = flattenLocale(readLocale(name))

    expect(locale['contextMenu.editComment']?.trim(), `${name}.json`).toBeTruthy()
  })

  it.each(localeNames)('%s localizes rejected comment edits', (name) => {
    const locale = flattenLocale(readLocale(name))

    expect(locale['sideBar.review.commentEditFailed']?.trim(), `${name}.json`).toBeTruthy()
  })

  it.each(localeNames)('%s has exact key parity with English', (name) => {
    const locale = flattenLocale(readLocale(name))

    expect(Object.keys(locale).sort(), `${name}.json keys`).toEqual(englishKeys)
  })

  it.each(localeNames)('%s has nonempty messages with matching placeholders', (name) => {
    const locale = flattenLocale(readLocale(name))

    for (const key of englishKeys) {
      expect(locale[key].trim(), `${name}.json: ${key}`).not.toBe('')
      expect(placeholders(locale[key]), `${name}.json: ${key} placeholders`).toEqual(placeholders(english[key]))
    }
  })

  it.each(localeNames)('%s survives build-time locale minification', (name) => {
    const locale = readLocale(name)
    const minified = minifyLocaleJson(readLocaleSource(name))

    expect(minified, `${name}.json minification`).toBe(JSON.stringify(locale))
    expect(JSON.parse(minified), `${name}.json round trip`).toEqual(locale)
  })
})

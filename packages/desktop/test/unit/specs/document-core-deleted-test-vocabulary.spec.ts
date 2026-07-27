import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const desktopRoot = path.resolve(__dirname, '../../..')
const testRoot = path.join(desktopRoot, 'test')
const thisFile = path.resolve(__filename)

const typescriptFilesBelow = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory()
      ? typescriptFilesBelow(absolute)
      : /\.(?:ts|tsx)$/.test(entry.name) && absolute !== thisFile
        ? [absolute]
        : []
  })

const deletedVocabulary = Object.freeze([
  ['active', 'ContentBlock'].join(''),
  ['Paragraph', 'Content'].join(''),
  ['base', 'Float'].join(''),
  ['click', 'Handler'].join(''),
  ['snabb', 'dom'].join(''),
  ['Content', 'State'].join(''),
  ['enter', 'Ctrl'].join(''),
  ['paragraph', 'Content'].join(''),
  ['document', '-view-link'].join(''),
  ['json', 'change'].join('-'),
  ['WYSIWYG', 'engine'].join(' '),
  ['.', 'mu-'].join(''),
  ['@', 'muyajs'].join(''),
  ['packages/', 'muya'].join('')
])

describe('document-core desktop test vocabulary', () => {
  it('contains no dependency on deleted editor implementation concepts', () => {
    const violations = typescriptFilesBelow(testRoot).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return deletedVocabulary
        .filter((word) => source.toLowerCase().includes(word.toLowerCase()))
        .map((word) => `${path.relative(desktopRoot, file)}: ${word}`)
    })

    expect(violations).toEqual([])
  })

  it('keeps Electron Track Changes acceptance off private session IPC', () => {
    const source = readFileSync(
      path.join(testRoot, 'e2e/document-core-track-changes.spec.ts'),
      'utf8'
    )
    const privateTokens = [
      ['ipc', 'Renderer.invoke'].join(''),
      ['document-core::', 'open-start'].join(''),
      ['document-core::', 'dispatch-start'].join(''),
      ['document-core::', 'dispatch-complete'].join('')
    ]

    for (const token of privateTokens) {
      expect(source, token).not.toContain(token)
    }
  })
})

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('document-core file policy cutover', () => {
  it('has no renderer-owned encoding EOL or final-newline policy', () => {
    for (const retiredPath of [
      'src/renderer/src/commands/fileEncoding.ts',
      'src/renderer/src/commands/lineEnding.ts',
      'src/renderer/src/commands/trailingNewline.ts',
      'src/common/encoding.ts'
    ]) {
      expect(existsSync(resolve(process.cwd(), retiredPath)), retiredPath)
        .toBe(false)
    }

    const rendererStore = source('src/renderer/src/store/editor.ts')
    const rendererFileState = source('src/shared/types/files.ts')
    const preferences = source('src/shared/types/preferences.ts')
    for (const retiredToken of [
      'mt::set-file-encoding',
      'mt::set-line-ending',
      'mt::set-final-newline',
      'trimTrailingNewline',
      'adjustLineEndingOnSave',
      'autoNormalizeLineEndings',
      'autoGuessEncoding',
      'defaultEncoding'
    ]) {
      expect(rendererStore, retiredToken).not.toContain(retiredToken)
      expect(rendererFileState, retiredToken).not.toContain(retiredToken)
      expect(preferences, retiredToken).not.toContain(retiredToken)
    }
  })

  it('has one exact main-owned file snapshot path and no alternate writer', () => {
    const markdownAdmission = source('src/main/filesystem/markdown.ts')
    const desktopDependencies = source('package.json')

    expect(markdownAdmission).not.toContain('writeMarkdownFile')
    expect(markdownAdmission).not.toContain('iconv')
    expect(markdownAdmission).not.toContain('convertLineEndings')
    expect(desktopDependencies).not.toContain('"ced"')
  })
})

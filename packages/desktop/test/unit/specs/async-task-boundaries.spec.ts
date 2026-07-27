import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(__dirname, '../../../../..')

const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8')

describe('async renderer task boundaries', () => {
  it('reports desktop callbacks that launch asynchronous editor work', () => {
    const editor = read(
      'packages/desktop/src/renderer/src/components/editorWithTabs/editor.vue'
    )

    expect(editor).toMatch(
      /reportAsyncTask\(\s*targetEditor\.pasteAsPlainText\(\),\s*'Paste as plain text'/
    )
    expect(editor).toMatch(
      /isImageSourceCapability\(source\)[^]*reportAsyncTask\(\s*insertPersistedImage\(source\),\s*'Screenshot image insertion'/
    )
    expect(editor).toMatch(
      /reportAsyncTask\(\s*targetEditor\.convertBlock\([^]*'Paragraph conversion'/
    )
    expect(editor).toMatch(
      /reportAsyncTask\(\s*operation,\s*`Paragraph \$\{action\}`/
    )
    expect(editor).toMatch(
      /reportAsyncTask\(\s*targetEditor\.formatText\([^]*'Inline formatting'/
    )
    expect(editor).toMatch(
      /reportAsyncTask\(\s*targetEditor\.configure\(options\),\s*context/
    )
    expect(editor).toMatch(
      /reportAsyncTask\(\s*targetEditor\.replaceCurrentWord\([^]*'Replace misspelling'/
    )
    expect(editor).toMatch(
      /reportAsyncTask\(\s*targetEditor\.undo\(\),\s*'Undo'/
    )
    expect(editor).toMatch(
      /reportAsyncTask\(\s*targetEditor\.redo\(\),\s*'Redo'/
    )
    expect(editor).toMatch(
      /reportAsyncTask\(\s*targetEditor\.createTable\([^]*'Create table'/
    )
    expect(editor).toMatch(
      /reportAsyncTask\(\s*targetEditor\.insertParagraph\([^]*'Insert paragraph'/
    )
    expect(editor).not.toMatch(/pasteImage\(filePath\)/)

    const review = read(
      'packages/desktop/src/renderer/src/components/editorWithTabs/useCriticMarkupReviewController.ts'
    )
    expect(review).toMatch(
      /reportAsyncTask\(\s*handleReviewAction\(action\),\s*'CriticMarkup Review action'/
    )
    expect(review).toMatch(
      /reportAsyncTask\(\s*executeCriticMarkupSidebarItemAction\([^]*'CriticMarkup sidebar action'/
    )
  })
})

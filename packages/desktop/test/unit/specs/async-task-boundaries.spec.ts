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
      /reportAsyncTask\(\s*targetEditor\.dispatchTargetedIntent\(\{\s*kind: 'convert-block',[^]*'Paragraph conversion'/
    )
    expect(editor).toMatch(
      /reportAsyncTask\(\s*operation,\s*`Paragraph \$\{action\}`/
    )
    expect(editor).toMatch(
      /reportAsyncTask\(\s*targetEditor\.dispatchTargetedIntent\(\{\s*kind: 'format-text',[^]*'Inline formatting'/
    )
    expect(editor).toMatch(
      /reportAsyncTask\(\s*targetEditor\.configure\(options\),\s*context/
    )
    expect(editor).toMatch(
      /reportAsyncTask\(\s*targetEditor\.replaceCurrentWord\([^]*'Replace misspelling'/
    )
    expect(editor).toMatch(
      /reportAsyncTask\(\s*targetEditor\.dispatchIntent\(\{ kind: 'undo' \}\),\s*'Undo'/
    )
    expect(editor).toMatch(
      /reportAsyncTask\(\s*targetEditor\.dispatchIntent\(\{ kind: 'redo' \}\),\s*'Redo'/
    )
    expect(editor).toMatch(
      /reportAsyncTask\(\s*targetEditor\.requestTable\(\),\s*'Create table'/
    )
    expect(editor).not.toContain('createTable(tableChecker)')
    expect(editor).toMatch(
      /const flushActiveEditor[^]*cancelTableShapeRequest\(\)[^]*target\?\.flush\(\)/
    )
    expect(editor).toMatch(
      /reportAsyncTask\(\s*targetEditor\.dispatchTargetedIntent\(\{\s*kind: 'insert-paragraph',[^]*'Insert paragraph'/
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

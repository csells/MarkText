import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(__dirname, '../../../../..')

const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8')

describe('async renderer task boundaries', () => {
  it('reports every synchronous callback that launches async clipboard/image work', () => {
    const clipboard = read('packages/muya/src/clipboard/index.ts')
    const dragDrop = read('packages/muya/src/editor/dragDropImage.ts')
    const editor = read(
      'packages/desktop/src/renderer/src/components/editorWithTabs/editor.vue'
    )

    expect(clipboard).toMatch(
      /reportAsyncTask\(\s*this\.pasteHandler\(event\),\s*'Clipboard paste'/
    )
    expect(dragDrop.match(/reportAsyncTask\(/g)).toHaveLength(2)
    expect(editor).toMatch(
      /reportAsyncTask\(\s*editor\.value\.pasteAsPlainText\(\),\s*'Paste as plain text'/
    )
    expect(editor).toMatch(
      /reportAsyncTask\(\s*editor\.value\.pasteImage\(filePath\),\s*'Screenshot image insertion'/
    )
  })
})

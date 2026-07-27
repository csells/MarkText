import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Menu } from 'electron'
import {
  setSemanticClipboardMenuState
} from 'main_renderer/menu/actions/edit'

const desktopRoot = path.resolve(__dirname, '../../..')
const read = (relativePath: string): string =>
  fs.readFileSync(path.resolve(desktopRoot, relativePath), 'utf8')

const atPath = (value: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((current, segment) => (
    current !== null &&
    typeof current === 'object' &&
    !Array.isArray(current)
      ? (current as Record<string, unknown>)[segment]
      : undefined
  ), value)

const sourceOperationKeys = Object.freeze([
  'edit',
  'undo',
  'redo',
  'paste',
  'cut',
  'copy',
  'selection',
  'attachment',
  'headingSelection'
])

describe('Source mode localized and honest UX', () => {
  it('binds the Source surface and failure operation to locale keys', () => {
    const source = read(
      'src/renderer/src/components/editorWithTabs/sourceCode.vue'
    )

    expect(source).toContain(
      ':aria-label="t(\'editor.sourceCode.label\')"'
    )
    expect(source).toContain(
      'operation: t(SOURCE_MODE_OPERATION_I18N_KEYS[operation])'
    )
    expect(source).not.toContain('aria-label="Source code"')
    expect(source).not.toContain("'heading selection'")
  })

  it('removes the hidden semantic surface from accessibility and focus', () => {
    const editor = read(
      'src/renderer/src/components/editorWithTabs/editor.vue'
    )

    expect(editor).toContain(
      ':aria-hidden="sourceCode || imageViewerVisible ? \'true\' : undefined"'
    )
    expect(editor).toContain(
      ':inert="sourceCode || imageViewerVisible || undefined"'
    )
    expect(editor).not.toContain(
      ':aria-hidden="imageViewerVisible ? \'true\' : undefined"'
    )
  })

  it('ships every Source UX message in every locale artifact', () => {
    const localeRoot = path.resolve(desktopRoot, 'static/locales')
    const localeFiles = fs.readdirSync(localeRoot)
      .filter(file => file.endsWith('.json'))
    const keys = [
      'editor.sourceCode.label',
      'editor.sourceCode.operationFailed',
      'editor.sourceCode.semanticClipboardUnavailableTitle',
      'editor.sourceCode.semanticClipboardUnavailable',
      ...sourceOperationKeys.map(operation =>
        `editor.sourceCode.operations.${operation}`)
    ]

    expect(localeFiles).toHaveLength(20)
    for (const file of localeFiles) {
      const locale = JSON.parse(
        fs.readFileSync(path.resolve(localeRoot, file), 'utf8')
      ) as unknown
      for (const key of keys) {
        const message = atPath(locale, key)
        expect(message, `${file}: ${key}`).toEqual(expect.any(String))
        expect(String(message).trim(), `${file}: ${key}`).not.toBe('')
      }
    }
  })

  it('disables semantic clipboard menu commands and rejects stale routing', () => {
    const template = read('src/main/menu/templates/edit.ts')
    const menu = read('src/main/menu/index.ts')
    const editor = read(
      'src/renderer/src/components/editorWithTabs/editor.vue'
    )

    for (const id of [
      'editCopyAsRichMenuItem',
      'editCopyAsHtmlMenuItem',
      'editPasteAsPlainTextMenuItem'
    ]) {
      expect(template).toContain(`id: '${id}'`)
    }
    expect(menu).toContain("'mt::set-document-clipboard-menu-state'")
    expect(menu).toMatch(
      /if \(isSourceMode\)[^]*surface: 'source'[^]*hasSelection: false/
    )
    expect(editor).toMatch(
      /const handleCopyPaste[^]*if \(sourceCode\.value\)[^]*semanticClipboardUnavailable[^]*return[^]*const targetEditor/
    )
  })

  it('sets copy and paste application-menu items independently', () => {
    const items = new Map([
      ['editCopyAsRichMenuItem', { enabled: true }],
      ['editCopyAsHtmlMenuItem', { enabled: true }],
      ['editPasteAsPlainTextMenuItem', { enabled: true }]
    ])
    const menu = {
      getMenuItemById: (id: string) => items.get(id) ?? null
    } as unknown as Menu

    setSemanticClipboardMenuState(menu, {
      copyAsRich: true,
      copyAsHtml: true,
      pasteAsPlainText: false
    })
    expect(items.get('editCopyAsRichMenuItem')?.enabled).toBe(true)
    expect(items.get('editCopyAsHtmlMenuItem')?.enabled).toBe(true)
    expect(items.get('editPasteAsPlainTextMenuItem')?.enabled).toBe(false)

    setSemanticClipboardMenuState(menu, {
      copyAsRich: false,
      copyAsHtml: false,
      pasteAsPlainText: true
    })
    expect(items.get('editCopyAsRichMenuItem')?.enabled).toBe(false)
    expect(items.get('editCopyAsHtmlMenuItem')?.enabled).toBe(false)
    expect(items.get('editPasteAsPlainTextMenuItem')?.enabled).toBe(true)
  })
})

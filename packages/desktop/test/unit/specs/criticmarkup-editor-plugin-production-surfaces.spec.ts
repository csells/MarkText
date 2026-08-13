import { describe, expect, it, vi } from 'vitest'

const core = vi.hoisted(() => {
  class Muya {
    static use = vi.fn()
  }
  return {
    Muya,
    CodeBlockLanguageSelector: { id: 'CodeBlockLanguageSelector' },
    EmojiSelector: { id: 'EmojiSelector' },
    FootnoteTool: { id: 'FootnoteTool' },
    ImageEditTool: { id: 'ImageEditTool' },
    ImagePathPicker: { id: 'ImagePathPicker' },
    ImageResizeBar: { id: 'ImageResizeBar' },
    ImageToolBar: { id: 'ImageToolBar' },
    InlineFormatToolbar: { id: 'InlineFormatToolbar' },
    LinkTools: { id: 'LinkTools' },
    ParagraphFrontButton: { id: 'ParagraphFrontButton' },
    ParagraphFrontMenu: { id: 'ParagraphFrontMenu' },
    ParagraphQuickInsertMenu: { id: 'ParagraphQuickInsertMenu' },
    PreviewToolBar: { id: 'PreviewToolBar' },
    TableChessboard: { id: 'TableChessboard' },
    TableColumnToolbar: { id: 'TableColumnToolbar' },
    TableDragBar: { id: 'TableDragBar' },
    TableRowColumMenu: { id: 'TableRowColumMenu' }
  }
})

vi.mock('@muyajs/core', () => core)

import { registerDesktopMuyaPlugins } from '@/components/editorWithTabs/muyaPluginRegistration'

describe('CriticMarkup desktop Muya plugin production surfaces', () => {
  it('registers every editor plugin with exact options once per renderer', () => {
    const imageAction = vi.fn()
    const imagePathPicker = vi.fn()
    const imagePathAutoComplete = vi.fn()
    const jumpClick = vi.fn()

    const options = {
      imageAction,
      imagePathPicker,
      imagePathAutoComplete,
      jumpClick
    }
    registerDesktopMuyaPlugins(options)
    registerDesktopMuyaPlugins(options)

    const expected = [
      ['editor-plugin:TableChessboard', [core.TableChessboard]],
      ['editor-plugin:ParagraphQuickInsertMenu', [core.ParagraphQuickInsertMenu]],
      ['editor-plugin:CodeBlockLanguageSelector', [core.CodeBlockLanguageSelector]],
      ['editor-plugin:EmojiSelector', [core.EmojiSelector]],
      ['editor-plugin:ImagePathPicker', [core.ImagePathPicker]],
      ['editor-plugin:ImageEditTool', [core.ImageEditTool, {
        imageAction,
        imagePathPicker,
        imagePathAutoComplete
      }]],
      ['editor-plugin:ImageResizeBar', [core.ImageResizeBar]],
      ['editor-plugin:ImageToolBar', [core.ImageToolBar]],
      ['editor-plugin:InlineFormatToolbar', [core.InlineFormatToolbar]],
      ['editor-plugin:ParagraphFrontButton', [core.ParagraphFrontButton]],
      ['editor-plugin:ParagraphFrontMenu', [core.ParagraphFrontMenu]],
      ['editor-plugin:PreviewToolBar', [core.PreviewToolBar]],
      ['editor-plugin:LinkTools', [core.LinkTools, { jumpClick }]],
      ['editor-plugin:FootnoteTool', [core.FootnoteTool]],
      ['editor-plugin:TableColumnToolbar', [core.TableColumnToolbar]],
      ['editor-plugin:TableDragBar', [core.TableDragBar]],
      ['editor-plugin:TableRowColumMenu', [core.TableRowColumMenu]]
    ] as const

    expect(expected.map(([itemId], index) => ({
      itemId,
      call: core.Muya.use.mock.calls[index]
    }))).toEqual(expected.map(([itemId, call]) => ({ itemId, call })))
  })
})

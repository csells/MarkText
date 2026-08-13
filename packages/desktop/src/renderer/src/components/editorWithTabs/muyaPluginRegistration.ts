import {
  Muya,
  CodeBlockLanguageSelector,
  EmojiSelector,
  FootnoteTool,
  ImageEditTool,
  ImagePathPicker,
  ImageResizeBar,
  ImageToolBar,
  InlineFormatToolbar,
  LinkTools,
  ParagraphFrontButton,
  ParagraphFrontMenu,
  ParagraphQuickInsertMenu,
  PreviewToolBar,
  TableChessboard,
  TableColumnToolbar,
  TableDragBar,
  TableRowColumMenu
} from '@muyajs/core'

export interface DesktopMuyaPluginOptions {
  readonly imageAction: unknown
  readonly imagePathPicker: unknown
  readonly imagePathAutoComplete: unknown
  readonly jumpClick: unknown
}

// `Muya.use(...)` appends to the static `Muya.plugins` array, and every
// `init()` instantiates the full list. Registration is process-global, so guard
// it here: window reuse or HMR must not spawn duplicate plugin UI handlers.
let registered = false

export const registerDesktopMuyaPlugins = (
  options: DesktopMuyaPluginOptions
): void => {
  if (registered) return
  registered = true

  Muya.use(TableChessboard)
  Muya.use(ParagraphQuickInsertMenu)
  Muya.use(CodeBlockLanguageSelector)
  Muya.use(EmojiSelector)
  Muya.use(ImagePathPicker)
  Muya.use(ImageEditTool, {
    imageAction: options.imageAction,
    imagePathPicker: options.imagePathPicker,
    imagePathAutoComplete: options.imagePathAutoComplete
  })
  Muya.use(ImageResizeBar)
  Muya.use(ImageToolBar)
  Muya.use(InlineFormatToolbar)
  Muya.use(ParagraphFrontButton)
  Muya.use(ParagraphFrontMenu)
  Muya.use(PreviewToolBar)
  Muya.use(LinkTools, { jumpClick: options.jumpClick })
  Muya.use(FootnoteTool)
  Muya.use(TableColumnToolbar)
  Muya.use(TableDragBar)
  Muya.use(TableRowColumMenu)
}

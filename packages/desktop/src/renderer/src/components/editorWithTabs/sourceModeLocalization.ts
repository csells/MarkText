export type SourceModeOperation =
  | 'edit'
  | 'undo'
  | 'redo'
  | 'paste'
  | 'cut'
  | 'copy'
  | 'selection'
  | 'attachment'
  | 'headingSelection'

type SourceModeOperationI18nKey =
  `editor.sourceCode.operations.${SourceModeOperation}`

export const SOURCE_MODE_OPERATION_I18N_KEYS: Readonly<
  Record<SourceModeOperation, SourceModeOperationI18nKey>
> = Object.freeze({
  edit: 'editor.sourceCode.operations.edit',
  undo: 'editor.sourceCode.operations.undo',
  redo: 'editor.sourceCode.operations.redo',
  paste: 'editor.sourceCode.operations.paste',
  cut: 'editor.sourceCode.operations.cut',
  copy: 'editor.sourceCode.operations.copy',
  selection: 'editor.sourceCode.operations.selection',
  attachment: 'editor.sourceCode.operations.attachment',
  headingSelection: 'editor.sourceCode.operations.headingSelection'
})

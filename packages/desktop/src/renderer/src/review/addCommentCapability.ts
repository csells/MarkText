import bus from '../bus'

export const ADD_COMMENT_CAPABILITY_CHANGED = 'editor-add-comment-enabled-changed'

let addCommentEnabled = false

export const setAddCommentCapability = (enabled: boolean): void => {
  addCommentEnabled = enabled
}

export const isAddCommentCapabilityEnabled = (): boolean => addCommentEnabled

export const publishAddCommentCapability = (enabled: boolean): void => {
  setAddCommentCapability(enabled)
  bus.emit(ADD_COMMENT_CAPABILITY_CHANGED, enabled)
}

export const publishSourceAddCommentCapability = (enabled: boolean): void => {
  publishAddCommentCapability(enabled)
  const { windowId } = window.marktext?.env ?? { windowId: -1 }
  window.electron.ipcRenderer.send('mt::editor-add-comment-selection-changed', windowId, enabled)
}

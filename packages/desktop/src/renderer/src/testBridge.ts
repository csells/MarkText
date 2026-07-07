import type { Pinia } from 'pinia'
import bus from './bus'
import { useEditorStore } from './store/editor'

// Provider side of the e2e markdown bridge
// (specs/architecture/test-infrastructure.md). The preload exposes
// window.__marktextTest only on test-harness launches, so outside test mode
// this is a no-op. The flush is the same commit path saving uses, so a read
// never races a pending keystroke debounce.
export const initTestBridge = (pinia: Pinia): void => {
  const bridge = window.__marktextTest
  if (!bridge) return

  const editorStore = useEditorStore(pinia)
  bridge.registerTabMarkdownProvider(() => {
    bus.emit('flush-active-editor')
    const tab = editorStore.currentFile
    if (!tab) throw new Error('getTabMarkdown: no active tab')
    return tab.markdown
  })
}

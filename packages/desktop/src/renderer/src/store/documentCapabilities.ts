import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { IntentCapabilitySnapshot } from '@marktext/document-core'
import {
  EDITOR_COMMAND_INTENTS,
  type EditorCommandId
} from '@shared/types/editorCommands'

/**
 * G5: the active document's published capability snapshot, held for every
 * renderer availability predicate — the palette today, context menus next.
 * A command id resolves through EDITOR_COMMAND_INTENTS to its intent kind;
 * with no snapshot (no open document) every intent-backed command is
 * unavailable.
 */
export const useDocumentCapabilityStore = defineStore(
  'documentCapabilities',
  () => {
    const snapshot = shallowRef<IntentCapabilitySnapshot | null>(null)

    function UPDATE_CAPABILITIES(next: IntentCapabilitySnapshot): void {
      snapshot.value = next
    }

    function CLEAR_CAPABILITIES(): void {
      snapshot.value = null
    }

    const commandEnabled = (command: EditorCommandId): boolean => {
      const kind = EDITOR_COMMAND_INTENTS[command]
      if (kind === undefined) return true
      const current = snapshot.value
      return current !== null && current[kind].enabled
    }

    return {
      snapshot,
      UPDATE_CAPABILITIES,
      CLEAR_CAPABILITIES,
      commandEnabled
    }
  }
)

import type { DocumentSelection } from '@marktext/document-core'
import { expect } from 'vitest'
import type { CoreAppliedReply } from '@/documentAuthority/coreProtocol'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'

export const modelInputOptions = {
  autoPairBracket: false,
  autoPairQuote: false,
  autoPairMarkdownSyntax: false
}

/**
 * Drives the Muya Core adapter through its model input entry point. Each input
 * continues at the previous operation's resulting model selection unless the
 * test places the caret explicitly, as a click would.
 */
export const openModelInputSession = (
  source: string,
  { documentId = 'model-input.md', seededEdits = [] as readonly string[] } = {}
) => {
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  binding.open({ documentId, source })
  let offset = source.replace(/\n$/u, '').length
  for (const insert of seededEdits) {
    binding.submit({ edits: [{ start: offset, end: offset, insert }], projections: [] })
    offset += insert.length
  }
  const view = () => {
    const reply = binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view') throw new Error('Expected view')
    return reply.view
  }
  let selection: DocumentSelection | undefined
  const outcomes: CoreAppliedReply[] = []
  const reconcile = (outcome: CoreAppliedReply) => {
    outcomes.push(outcome)
    selection = outcome.inputResult?.selection ?? outcome.historyResult?.selection ?? selection
    return view().bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(
    view().bindings,
    binding,
    undefined,
    1 + seededEdits.length
  )
  const select = (anchor: number, focus = anchor) => {
    selection = { ranges: [{ anchor, focus }], primary: 0 }
  }
  const currentSelection = () => {
    if (selection === undefined || !('ranges' in selection)) {
      throw new Error('Expected a model text selection')
    }
    return selection
  }
  const input = (inputType: string, data: string | null = null, tracked = false) => {
    const current = currentSelection()
    const { anchor, focus } = current.ranges[current.primary]
    return adapter.input(
      {
        range: { start: Math.min(anchor, focus), end: Math.max(anchor, focus) },
        selection: current,
        inputType,
        data,
        options: modelInputOptions
      },
      reconcile,
      tracked
    )
  }
  const type = (text: string, tracked = false) => {
    for (const data of text) {
      expect(input('insertText', data, tracked)).toEqual({ accepted: true, changed: true })
    }
  }
  const command = (action: Record<string, unknown>, tracked = false) =>
    adapter.input(
      {
        kind: 'command',
        selection: currentSelection(),
        options: modelInputOptions,
        ...action
      } as never,
      reconcile,
      tracked
    )
  const source_ = () => {
    const reply = binding.sourceAtBarrier()
    if (reply.type !== 'source') throw new Error('Expected source')
    return reply.source
  }
  const undoUntil = async(target: string) => {
    for (let undo = 0; undo < 24 && source_() !== target; undo += 1) {
      await adapter.history('undo', reconcile)
    }
  }
  return {
    binding,
    adapter,
    reconcile,
    outcomes,
    view,
    select,
    selection: currentSelection,
    input,
    type,
    command,
    source: source_,
    undoUntil,
    dispose() {
      adapter.dispose()
      binding.dispose()
    }
  }
}

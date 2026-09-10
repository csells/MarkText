// @vitest-environment jsdom

import { Muya } from '@muyajs/core'
import { beforeEach, describe, expect, it } from 'vitest'

import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'
import type { CoreAppliedReply } from '@/documentAuthority/coreProtocol'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'
import {
  muyaActiveFormats,
  muyaInputToModel,
  muyaFormatToModel
} from '@/documentAuthority/muyaModelSelection'
import { reconcileMuyaDocumentView } from '@/documentAuthority/reconcileMuyaDocumentView'
import {
  createMuyaPlainTextCoreAdapter,
  type MuyaPlainTextCoreAdapter
} from '@/documentAuthority/muyaPlainTextCoreAdapter'

beforeEach(() => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
})

interface InputCase {
  browserNormalizedTarget?: boolean
  betweenSubstitutionArms?: boolean
  name: string
  source: string
  selection: readonly [number, number]
  key: string
  inputType: string
  data: string | null
  browserText: string
  caret: number
  expectedSource: string
  lastBlock?: number
  followup?: readonly string[]
  holdSaveBarrier?: boolean
  tracked?: boolean
  immediateCaret?: number
  immediateText?: string
  acknowledgedCaret?: number
  acknowledgedText?: string
  undoSources?: readonly string[]
}

const cases: readonly InputCase[] = [
  {
    name: 'replaces the actual alpha-to-gamma selection through one model input',
    source: 'alpha\n\nbeta\n\ngamma\n',
    selection: [2, 2],
    lastBlock: 2,
    key: 'X',
    inputType: 'insertText',
    data: 'X',
    browserText: 'alXmma',
    caret: 3,
    expectedSource: 'alXmma\n'
  },
  {
    name: 'types between substitution arms without moving before the entire annotation',
    source: '{~~a~>b~~}\n',
    selection: [1, 1],
    betweenSubstitutionArms: true,
    key: 'x',
    inputType: 'insertText',
    data: 'x',
    browserText: 'axb',
    caret: 2,
    followup: ['y'],
    expectedSource: '{~~a~>xyb~~}\n'
  },
  {
    name: 'preserves queued keystrokes after select-all replaces annotated paragraphs',
    source: 'a{==mark==}{>>note<<}\n\nlast\n',
    selection: [0, 4],
    lastBlock: 1,
    key: 'h',
    inputType: 'insertText',
    data: 'h',
    browserText: 'h',
    caret: 1,
    followup: ['e', 'l', 'l', 'o'],
    holdSaveBarrier: true,
    expectedSource: 'hello{>>note<<}\n'
  },
  {
    name: 'keeps queued typing at the caret after deleting a complete addition',
    source: 'a{++bc++}d\n',
    selection: [1, 3],
    key: 'Backspace',
    inputType: 'deleteContentBackward',
    data: null,
    browserText: 'ad',
    caret: 1,
    followup: ['x'],
    holdSaveBarrier: true,
    expectedSource: 'axd\n',
    // Existing native history separates deletion from subsequent insertion.
    undoSources: ['ad\n', 'a{++bc++}d\n']
  },
  {
    name: 'keeps queued tracked typing in the replacement arm after retained deletion text appears',
    source: 'abcdef\n',
    selection: [1, 3],
    key: 'X',
    inputType: 'insertText',
    data: 'X',
    browserText: 'aXdef',
    caret: 2,
    followup: ['y'],
    holdSaveBarrier: true,
    tracked: true,
    immediateCaret: 4,
    immediateText: 'abcXdef',
    acknowledgedCaret: 5,
    acknowledgedText: 'abcXydef',
    expectedSource: 'a{~~bc~>Xy~~}def\n'
  },
  {
    name: 'preserves hidden comments during whole-document replacement across paragraphs',
    source: 'a{==mark==}{>>note<<}\n\nlast\n',
    selection: [0, 4],
    lastBlock: 1,
    key: 'h',
    inputType: 'insertText',
    data: 'hello',
    browserText: 'hello',
    caret: 5,
    expectedSource: 'hello{>>note<<}\n'
  },
  {
    name: 'groups rapid repeated input while save is waiting for the view into one undo entry',
    source: 'a{++a++}a\n',
    selection: [0, 0],
    key: 'a',
    inputType: 'insertText',
    data: 'a',
    browserText: 'aaaa',
    caret: 1,
    followup: ['a', 'a'],
    holdSaveBarrier: true,
    expectedSource: 'aaaa{++a++}a\n'
  },
  {
    name: 'keeps queued text after an escaped closer inside its owning addition',
    source: '{++seed++}\n',
    selection: [4, 4],
    key: '+',
    inputType: 'insertText',
    data: '++}',
    browserText: 'seed++}',
    caret: 7,
    followup: ['x'],
    holdSaveBarrier: true,
    expectedSource: '{++seed\\++}x++}\n',
    immediateCaret: 8,
    immediateText: 'seed\\++}',
    acknowledgedCaret: 9,
    acknowledgedText: 'seed\\++}x'
  },
  {
    name: 'replaces the selected repeated prefix rather than the identical suffix',
    source: 'a{++a++}a\n',
    selection: [0, 2],
    key: 'a',
    inputType: 'insertText',
    data: 'a',
    browserText: 'aa',
    caret: 1,
    expectedSource: 'aa\n'
  },
  {
    name: 'inserts repeated text at the actual caret before an addition',
    source: 'a{++a++}a\n',
    selection: [0, 0],
    key: 'a',
    inputType: 'insertText',
    data: 'a',
    browserText: 'aaaa',
    caret: 1,
    expectedSource: 'aa{++a++}a\n'
  },
  {
    name: 'deletes repeated text behind the actual caret before an addition',
    source: 'a{++a++}a\n',
    selection: [1, 1],
    key: 'Backspace',
    inputType: 'deleteContentBackward',
    data: null,
    browserText: 'aa',
    caret: 0,
    expectedSource: '{++a++}a\n'
  },
  {
    name: 'types at the model-selected source boundary before the remaining addition',
    source: 'a{++a++}a\n',
    selection: [1, 1],
    key: 'Backspace',
    inputType: 'deleteContentBackward',
    data: null,
    browserText: 'aa',
    caret: 0,
    followup: ['x'],
    expectedSource: 'x{++a++}a\n',
    undoSources: ['{++a++}a\n', 'a{++a++}a\n']
  },
  {
    name: 'keeps the exterior caret when the browser normalizes its insertion target into an annotation',
    source: 'a{++a++}a\n',
    selection: [1, 1],
    key: 'Backspace',
    inputType: 'deleteContentBackward',
    data: null,
    browserText: 'aa',
    caret: 0,
    followup: ['x', 'y'],
    browserNormalizedTarget: true,
    expectedSource: 'xy{++a++}a\n',
    undoSources: ['{++a++}a\n', 'a{++a++}a\n']
  },
  {
    name: 'replaces selected visible text even when its spelling is unchanged',
    source: 'a{++bc++}d\n',
    selection: [0, 4],
    key: 'a',
    inputType: 'insertText',
    data: 'abcd',
    browserText: 'abcd',
    caret: 4,
    expectedSource: 'abcd\n'
  },
  {
    name: 'preserves an addition when unrelated selected text has a distinct replacement',
    source: 'a{++a++}a\n',
    selection: [0, 1],
    key: 'x',
    inputType: 'insertText',
    data: 'x',
    browserText: 'xaa',
    caret: 1,
    expectedSource: 'x{++a++}a\n'
  },
  {
    name: 'retains ordinary Markdown input and history through the same native entry point',
    source: 'aaa\n',
    selection: [0, 0],
    key: 'a',
    inputType: 'insertText',
    data: 'a',
    browserText: 'aaaa',
    caret: 1,
    expectedSource: 'aaaa\n'
  }
]

describe('native input locations in the shared document', () => {
  it.each(cases)('$name', async(testCase) => {
    let release: (() => void) | undefined
    let reportHeld: (() => void) | undefined
    const firstHeld = new Promise<void>((resolve) => {
      reportHeld = resolve
    })
    let held = false
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(createLocalCoreOwner())
    })
    await manager.open({ documentId: 'native-input.md', source: testCase.source, lineEnding: '\n' })
    const lease = manager.lease('native-input.md')
    const binding = lease.binding
    let pendingSave: ReturnType<typeof manager.saveBarrier> | undefined
    const initial = await manager.plainTextViewBarrier('native-input.md')
    if (initial.type !== 'plain-text-view' || !('state' in initial.view)) {
      throw new Error('Missing initial native view')
    }
    let currentView = initial.view
    let presentation = createMuyaMarkupPresentationIndex(initial.view)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const muya = new Muya(host)
    const reconcile = (outcome: CoreAppliedReply) => {
      const next = lease.projectAcknowledgedPlainTextView(outcome.revision)
      if (next.type !== 'plain-text-view' || !('state' in next.view)) {
        throw new Error('Missing acknowledged native view')
      }
      currentView = next.view
      presentation = createMuyaMarkupPresentationIndex(next.view, presentation)
      muya.setInlinePresentation(presentation.render)
      if (!adapter.hasPendingEdits()) {
        reconcileMuyaDocumentView({
          muya,
          view: next.view,
          outcome,
          sourcePosition: adapter.reconciledSourcePosition,
          dirtyPaths: presentation.changedPaths,
          applyEditability: (bindings) =>
            muya.setEditablePaths(
              bindings.filter((item) => item.editable !== false).map((item) => item.path)
            )
        })
      }
      return next.view.bindings
    }
    const adapter: MuyaPlainTextCoreAdapter = createMuyaPlainTextCoreAdapter(
      initial.view.bindings,
      binding,
      undefined,
      reconcile
    )
    lease.settleView(async() => {
      if (testCase.holdSaveBarrier && !held) {
        held = true
        await new Promise<void>((resolve) => {
          release = resolve
          reportHeld?.()
        })
      }
      await adapter.settled()
    })
    try {
      muya.setInlinePresentation(presentation.render)
      muya.init()
      muya.setContent(structuredClone([...initial.view.state]))
      const results: string[] = []
      muya.editor.bindDocumentEditing({
        prepareImage() {
          throw new Error('Unexpected image preparation')
        },
        prepareClipboard() {
          throw new Error('Unexpected async clipboard preparation in this test')
        },
        activeFormats: (selection) => muyaActiveFormats(muya, currentView, selection),
        clipboard() {
          throw new Error('Unexpected clipboard action in this input test')
        },
        compositionStart() {
          throw new Error('Unexpected composition in this input test')
        },
        compositionUpdate() {
          throw new Error('Unexpected composition in this input test')
        },
        compositionEnd() {
          throw new Error('Unexpected composition in this input test')
        },
        format: (operation) =>
          adapter.format(
            muyaFormatToModel(muya, currentView, operation, testCase.tracked ?? false),
            reconcile
          ).changed,
        input(operation, present) {
          const result = adapter.input(
            muyaInputToModel(muya, currentView, operation),
            reconcile,
            testCase.tracked
          )
          results.push(!result.accepted ? 'unsupported' : 'accepted')
          if (!result.accepted) present()
          return result.changed
        }
      })
      const block = muya.editor.scrollPage?.queryBlock([0, 'text'])
      if (block == null || !block.isContent() || block.domNode == null) {
        throw new Error('Missing native paragraph')
      }
      muya.editor.activeContentBlock = block
      if (testCase.lastBlock === undefined) {
        block.setCursor(...testCase.selection)
      } else {
        const last = muya.editor.scrollPage?.queryBlock([testCase.lastBlock, 'text'])
        if (last == null || !last.isContent()) throw new Error('Missing selection endpoint')
        muya.editor.selection.setSelection(
          { block, path: block.path, offset: testCase.selection[0] },
          { block: last, path: last.path, offset: testCase.selection[1] }
        )
      }
      if (testCase.betweenSubstitutionArms) {
        const arm = block.domNode.querySelector('[data-critic-arm="new"]')
        if (arm?.parentNode == null) throw new Error('Missing rendered substitution arm')
        const point = {
          node: arm.parentNode,
          offset: Array.from(arm.parentNode.childNodes).indexOf(arm)
        }
        muya.editor.selection.setDOMSelection(point, point)
      }
      expect(muya.getSelection()).toMatchObject({
        anchor: { path: [0, 'text'], offset: testCase.selection[0] },
        focus: { path: [testCase.lastBlock ?? 0, 'text'], offset: testCase.selection[1] }
      })
      muya.on('json-change', (change: { source: string }) => {
        if (change.source === 'user') results.push(adapter.accept(change))
      })

      block.domNode.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: testCase.key,
          bubbles: true,
          cancelable: true
        })
      )
      const beforeInput = new InputEvent('beforeinput', {
        data: testCase.data,
        inputType: testCase.inputType,
        bubbles: true,
        cancelable: true
      })
      block.domNode.dispatchEvent(beforeInput)
      // jsdom does not perform browser text editing. Supply only that DOM
      // mutation, then use Muya's real input handler and emitted change event.
      if (!beforeInput.defaultPrevented) {
        block.domNode.textContent = testCase.browserText
        block.setCursor(testCase.caret, testCase.caret)
        block.domNode.dispatchEvent(
          new InputEvent('input', {
            data: testCase.data,
            inputType: testCase.inputType,
            bubbles: true
          })
        )
      }
      muya.flush()
      if (testCase.holdSaveBarrier) {
        pendingSave = manager.saveBarrier('native-input.md')
        await firstHeld
      }
      const immediateText = testCase.immediateText ?? testCase.browserText
      const immediateCaret = testCase.immediateCaret ?? testCase.caret
      expect(muya.editor.scrollPage?.firstContentInDescendant()?.domNode?.textContent).toBe(
        immediateText
      )
      expect.soft(muya.getSelection()).toMatchObject({
        anchor: { path: [0, 'text'], offset: immediateCaret },
        focus: { path: [0, 'text'], offset: immediateCaret }
      })
      let queuedText = ''
      for (const text of testCase.followup ?? []) {
        const current = muya.editor.scrollPage?.firstContentInDescendant()
        if (current?.domNode == null) throw new Error('Missing active input paragraph')
        current.domNode.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: text,
            bubbles: true,
            cancelable: true
          })
        )
        const followup = new InputEvent('beforeinput', {
          data: text,
          inputType: 'insertText',
          bubbles: true,
          cancelable: true
        })
        if (testCase.browserNormalizedTarget && queuedText === '') {
          const target = muya.editor.selection.getDOMPoint({ path: current.path, offset: 0 })
          if (target == null) throw new Error('Missing normalized insertion target')
          const range = document.createRange()
          range.setStart(target.node, target.offset)
          range.collapse(true)
          Object.defineProperty(followup, 'getTargetRanges', { value: () => [range] })
        }
        current.domNode.dispatchEvent(followup)
        expect(followup.defaultPrevented).toBe(true)
        muya.flush()
        queuedText += text
        expect(muya.getSelection()).toMatchObject({
          anchor: { path: [0, 'text'], offset: immediateCaret + queuedText.length },
          focus: { path: [0, 'text'], offset: immediateCaret + queuedText.length }
        })
        expect(muya.editor.scrollPage?.firstContentInDescendant()?.domNode?.textContent).toBe(
          immediateText.slice(0, immediateCaret) + queuedText + immediateText.slice(immediateCaret)
        )
      }
      if (testCase.holdSaveBarrier) {
        await firstHeld
        expect(held).toBe(true)
        expect(muya.editor.scrollPage?.firstContentInDescendant()?.text).toBe(
          immediateText.slice(0, immediateCaret) +
            (testCase.followup ?? []).join('') +
            immediateText.slice(immediateCaret)
        )
        release?.()
        expect(await pendingSave).toMatchObject({ source: testCase.expectedSource })
      }
      await adapter.settled()

      expect(beforeInput.defaultPrevented).toBe(true)
      expect(results).toEqual(Array(1 + (testCase.followup?.length ?? 0)).fill('accepted'))
      expect(await manager.saveBarrier('native-input.md')).toMatchObject({
        source: testCase.expectedSource
      })
      const acknowledgedCaret = testCase.acknowledgedCaret ?? immediateCaret + queuedText.length
      expect(muya.getSelection()).toMatchObject({
        anchor: { path: [0, 'text'], offset: acknowledgedCaret },
        focus: { path: [0, 'text'], offset: acknowledgedCaret }
      })
      expect(muya.editor.scrollPage?.firstContentInDescendant()?.text).toBe(
        testCase.acknowledgedText ??
          immediateText.slice(0, immediateCaret) + queuedText + immediateText.slice(immediateCaret)
      )
      const undoSources = testCase.undoSources ?? [testCase.source]
      for (const source of undoSources) {
        await adapter.history('undo', reconcile)
        expect(await manager.saveBarrier('native-input.md')).toMatchObject({ source })
      }
      for (const source of [...undoSources.slice(0, -1).reverse(), testCase.expectedSource]) {
        await adapter.history('redo', reconcile)
        expect(await manager.saveBarrier('native-input.md')).toMatchObject({ source })
      }
      const saved = await manager.saveBarrier('native-input.md')
      expect(saved).toMatchObject({ source: testCase.expectedSource })
      const reopened = createEditorCoreBinding(createLocalCoreOwner())
      try {
        await reopened.open({ documentId: 'reopened-input.md', source: saved.source })
        expect(await reopened.sourceAtBarrier()).toMatchObject({ source: testCase.expectedSource })
      } finally {
        reopened.dispose()
      }
    } finally {
      release?.()
      await pendingSave
      await manager.handoff(lease)
      adapter.dispose()
      await manager.close('native-input.md')
      muya.destroy()
      muya.domNode.remove()
      host.remove()
      document.getSelection()?.removeAllRanges()
    }
  })
})

// @vitest-environment jsdom

import { Muya } from '@muyajs/core'
import { beforeEach, describe, expect, it } from 'vitest'

import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
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
  name: string
  source: string
  selection: readonly [number, number]
  key: string
  inputType: string
  data: string | null
  browserText: string
  caret: number
  expectedSelection?: readonly [number, number]
  expectedSource: string
  expectedViewText?: string
  queuedKeys?: readonly string[]
  afterFirstInput?: { source: string; text: string; selection: readonly [number, number] }
  unchanged?: boolean
  literal?: 'code' | 'math'
  targetSelection?: readonly [number, number]
  options: {
    autoPairBracket?: boolean
    autoPairQuote?: boolean
    autoPairMarkdownSyntax?: boolean
  }
}

const cases: readonly InputCase[] = [
  {
    name: 'deletes paired substitution arms with Backspace',
    source: '{~~(~>)~~}\n',
    selection: [1, 1],
    key: 'Backspace',
    inputType: 'deleteContentBackward',
    data: null,
    browserText: ')',
    caret: 0,
    expectedSource: '\n',
    expectedViewText: '',
    options: {}
  },
  {
    name: 'deletes paired substitution arms with Delete',
    source: '{~~(~>)~~}\n',
    selection: [1, 1],
    key: 'Delete',
    inputType: 'deleteContentForward',
    data: null,
    browserText: '(',
    caret: 0,
    expectedSource: '\n',
    expectedViewText: '',
    options: {}
  },
  {
    name: 'deletes paired substitution arms with Backspace retaining their hidden comment',
    source: '{~~({>>note<<}~>)~~}\n',
    selection: [1, 1],
    key: 'Backspace',
    inputType: 'deleteContentBackward',
    data: null,
    browserText: ')',
    caret: 0,
    expectedSource: '{>>note<<}\n',
    expectedViewText: '',
    options: {}
  },
  {
    name: 'deletes paired substitution arms with Delete retaining their hidden comment',
    source: '{~~({>>note<<}~>)~~}\n',
    selection: [1, 1],
    key: 'Delete',
    inputType: 'deleteContentForward',
    data: null,
    browserText: '(',
    caret: 0,
    expectedSource: '{>>note<<}\n',
    expectedViewText: '',
    options: {}
  },
  {
    name: 'uses the wrapped selection for the next key before acknowledgement',
    source: 'a{++b++}c\n',
    selection: [0, 3],
    key: '(',
    inputType: 'insertText',
    data: '(',
    browserText: '(',
    queuedKeys: ['x'],
    afterFirstInput: { source: '(a{++b++}c)\n', text: '(abc)', selection: [1, 4] },
    caret: 2,
    expectedSource: '(x)\n',
    expectedViewText: '(x)',
    options: { autoPairBracket: true }
  },
  {
    name: 'wraps the actual selected text without replacing its enclosed suggestion',
    source: 'a{++b++}c\n',
    selection: [0, 3],
    key: '(',
    inputType: 'insertText',
    data: '(',
    browserText: '(',
    caret: 1,
    expectedSelection: [1, 4],
    expectedSource: '(a{++b++}c)\n',
    expectedViewText: '(abc)',
    options: { autoPairBracket: true }
  },
  {
    name: 'preserves Markdown pairing while earlier native input awaits acknowledgement',
    source: 'seed\n',
    selection: [4, 4],
    key: ' ',
    inputType: 'insertText',
    data: ' ',
    browserText: 'seed ',
    caret: 6,
    queuedKeys: ['*'],
    expectedSource: 'seed **\n',
    options: { autoPairMarkdownSyntax: true }
  },
  {
    name: 'honors enabled autoPairBracket',
    source: 'seed\n',
    selection: [4, 4],
    key: '(',
    inputType: 'insertText',
    data: '(',
    browserText: 'seed(',
    caret: 5,
    expectedSource: 'seed()\n',
    options: {
      autoPairBracket: true
    }
  },
  {
    name: 'honors disabled autoPairBracket',
    source: 'seed\n',
    selection: [4, 4],
    key: '(',
    inputType: 'insertText',
    data: '(',
    browserText: 'seed(',
    caret: 5,
    expectedSource: 'seed(\n',
    options: {
      autoPairBracket: false
    }
  },
  {
    name: 'honors enabled autoPairQuote',
    source: 'seed\n',
    selection: [4, 4],
    key: '"',
    inputType: 'insertText',
    data: '"',
    browserText: 'seed"',
    caret: 5,
    expectedSource: 'seed""\n',
    options: {
      autoPairQuote: true
    }
  },
  {
    name: 'honors disabled autoPairQuote',
    source: 'seed\n',
    selection: [4, 4],
    key: '"',
    inputType: 'insertText',
    data: '"',
    browserText: 'seed"',
    caret: 5,
    expectedSource: 'seed"\n',
    options: {
      autoPairQuote: false
    }
  },
  {
    name: 'honors enabled autoPairMarkdownSyntax',
    source: 'seed \n',
    selection: [5, 5],
    key: '*',
    inputType: 'insertText',
    data: '*',
    browserText: 'seed *',
    caret: 6,
    expectedSource: 'seed **\n',
    options: {
      autoPairMarkdownSyntax: true
    }
  },
  {
    name: 'honors disabled autoPairMarkdownSyntax',
    source: 'seed \n',
    selection: [5, 5],
    key: '*',
    inputType: 'insertText',
    data: '*',
    browserText: 'seed *',
    caret: 6,
    expectedSource: 'seed *\n',
    options: {
      autoPairMarkdownSyntax: false
    }
  },
  {
    name: 'deletes both paired brackets with Backspace',
    source: '()\n',
    selection: [1, 1],
    key: 'Backspace',
    inputType: 'deleteContentBackward',
    data: null,
    browserText: ')',
    caret: 0,
    expectedSource: '\n',
    options: {}
  },
  {
    name: 'deletes both paired brackets with Backspace using browser target range',
    source: '()\n',
    selection: [1, 1],
    key: 'Backspace',
    inputType: 'deleteContentBackward',
    data: null,
    browserText: ')',
    caret: 0,
    expectedSource: '\n',
    options: {},
    targetSelection: [0, 1]
  },
  {
    name: 'deletes both paired brackets with Delete',
    source: '()\n',
    selection: [1, 1],
    key: 'Delete',
    inputType: 'deleteContentForward',
    data: null,
    browserText: '(',
    caret: 0,
    expectedSource: '\n',
    options: {}
  },
  {
    name: 'deletes both paired brackets with Delete using browser target range',
    source: '()\n',
    selection: [1, 1],
    key: 'Delete',
    inputType: 'deleteContentForward',
    data: null,
    browserText: '(',
    caret: 0,
    expectedSource: '\n',
    options: {},
    targetSelection: [1, 2]
  },
  {
    name: 'skips a matching closer without a source or history edit',
    source: '()\n',
    selection: [1, 1],
    key: ')',
    inputType: 'insertText',
    data: ')',
    browserText: '())',
    caret: 2,
    expectedSource: '()\n',
    unchanged: true,
    options: {}
  },
  {
    name: 'suppresses Markdown pairing inside code',
    literal: 'code',
    source: '` foo`\n',
    selection: [1, 1],
    key: '*',
    inputType: 'insertText',
    data: '*',
    browserText: '`* foo`',
    caret: 2,
    expectedSource: '`* foo`\n',
    expectedViewText: '`* foo`',
    options: {
      autoPairMarkdownSyntax: true
    }
  },
  {
    name: 'suppresses Markdown pairing inside CM code',
    literal: 'code',
    source: '{++` foo`++}\n',
    selection: [1, 1],
    key: '*',
    inputType: 'insertText',
    data: '*',
    browserText: '`* foo`',
    caret: 2,
    expectedSource: '{++`* foo`++}\n',
    expectedViewText: '`* foo`',
    options: {
      autoPairMarkdownSyntax: true
    }
  },
  {
    name: 'suppresses Markdown pairing inside math',
    literal: 'math',
    source: '$x+y$\n',
    selection: [1, 1],
    key: '*',
    inputType: 'insertText',
    data: '*',
    browserText: '$*x+y$',
    caret: 2,
    expectedSource: '$*x+y$\n',
    expectedViewText: '$*x+y$',
    options: {
      autoPairMarkdownSyntax: true
    }
  },
  {
    name: 'suppresses Markdown pairing inside CM math',
    literal: 'math',
    source: '{++$x+y$++}\n',
    selection: [1, 1],
    key: '*',
    inputType: 'insertText',
    data: '*',
    browserText: '$*x+y$',
    caret: 2,
    expectedSource: '{++$*x+y$++}\n',
    expectedViewText: '$*x+y$',
    options: {
      autoPairMarkdownSyntax: true
    }
  },
  {
    name: 'preserves bracket pairing while earlier typing awaits acknowledgement',
    source: 'seed\n',
    selection: [4, 4],
    key: 'a',
    inputType: 'insertText',
    data: 'a',
    browserText: 'seeda',
    queuedKeys: ['('],
    caret: 6,
    expectedSource: 'seeda()\n',
    options: { autoPairBracket: true }
  }
]

describe('native input preferences in the shared document', () => {
  it.each(cases)('$name', async(testCase) => {
    const binding = createEditorCoreBinding(createLocalCoreOwner())
    await binding.open({ documentId: 'native-input.md', source: testCase.source })
    const initial = await binding.plainTextViewAtBarrier()
    if (initial.type !== 'plain-text-view' || !('state' in initial.view)) {
      throw new Error('Missing initial native view')
    }
    let currentView = initial.view
    let presentation = createMuyaMarkupPresentationIndex(initial.view)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const muya = new Muya(host, testCase.options)
    const reconcile = (outcome: CoreAppliedReply) => {
      const next = binding.plainTextViewAtBarrier()
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
    try {
      muya.setInlinePresentation(presentation.render)
      muya.init()
      muya.setContent(structuredClone([...initial.view.state]))
      const sourceBeforeInput = await binding.sourceAtBarrier()
      const nativeHistoryBeforeInput = muya.getHistory()
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
          adapter.format(muyaFormatToModel(muya, currentView, operation, false), reconcile).changed,
        input(operation, present) {
          const result = adapter.input(muyaInputToModel(muya, currentView, operation), reconcile)
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
      block.setCursor(...testCase.selection)
      expect(muya.getSelection()).toMatchObject({
        anchor: { offset: testCase.selection[0] },
        focus: { offset: testCase.selection[1] }
      })
      if (testCase.literal !== undefined) {
        expect(
          presentation.syntaxContext({ path: block.path, offset: testCase.selection[0] })
        ).toMatchObject(
          testCase.literal === 'code' ? { isInInlineCode: true } : { isInInlineMath: true }
        )
      }
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
      if (testCase.targetSelection !== undefined) {
        block.setCursor(...testCase.targetSelection)
        const range = document.getSelection()?.getRangeAt(0).cloneRange()
        if (range === undefined) throw new Error('Missing browser target range')
        block.setCursor(...testCase.selection)
        Object.defineProperty(beforeInput, 'getTargetRanges', { value: () => [range] })
      }
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
      if (testCase.afterFirstInput !== undefined) {
        // No await: the next key consumes this exact accepted state.
        expect(binding.sourceAtBarrier()).toMatchObject({ source: testCase.afterFirstInput.source })
        expect(muya.editor.scrollPage?.queryBlock([0, 'text'])?.text).toBe(
          testCase.afterFirstInput.text
        )
        expect(muya.getSelection()).toMatchObject({
          anchor: { offset: testCase.afterFirstInput.selection[0] },
          focus: { offset: testCase.afterFirstInput.selection[1] }
        })
      }
      // Keep these events in the same task: the next action must already see
      // the accepted model selection, without a microtask or delayed correction.
      for (const key of testCase.queuedKeys ?? []) {
        const current = muya.editor.scrollPage?.queryBlock([0, 'text'])
        if (current == null || !current.isContent() || current.domNode == null) {
          throw new Error('Missing paragraph for queued native input')
        }
        current.domNode.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
        )
        const queuedInput = new InputEvent('beforeinput', {
          data: key,
          inputType: 'insertText',
          bubbles: true,
          cancelable: true
        })
        current.domNode.dispatchEvent(queuedInput)
        expect(queuedInput.defaultPrevented).toBe(true)
      }
      muya.flush()
      expect.soft(muya.getSelection()).toMatchObject({
        anchor: { offset: testCase.expectedSelection?.[0] ?? testCase.caret },
        focus: { offset: testCase.expectedSelection?.[1] ?? testCase.caret }
      })
      expect
        .soft(muya.editor.scrollPage?.queryBlock([0, 'text'])?.text)
        .toBe(testCase.expectedViewText ?? testCase.expectedSource.replace(/\n$/u, ''))
      await adapter.settled()

      expect(beforeInput.defaultPrevented).toBe(true)
      // Even a source-preserving closer skip is now decided by the model.
      expect(results).toEqual(
        Array.from({ length: 1 + (testCase.queuedKeys?.length ?? 0) }, () => 'accepted')
      )
      expect.soft(muya.getSelection()).toMatchObject({
        anchor: { offset: testCase.expectedSelection?.[0] ?? testCase.caret },
        focus: { offset: testCase.expectedSelection?.[1] ?? testCase.caret }
      })
      expect
        .soft(await binding.sourceAtBarrier())
        .toMatchObject({ source: testCase.expectedSource })
      if (testCase.unchanged) {
        if (sourceBeforeInput.type !== 'source') throw new Error('Missing source before input')
        expect(await binding.sourceAtBarrier()).toMatchObject({
          source: sourceBeforeInput.source,
          revision: sourceBeforeInput.revision,
          recoveryHistory: sourceBeforeInput.recoveryHistory
        })
        expect(muya.getHistory()).toEqual(nativeHistoryBeforeInput)
      }
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: testCase.source })
      await adapter.history('redo', reconcile)
      const saved = await binding.sourceAtBarrier()
      expect(saved).toMatchObject({ source: testCase.expectedSource })
      if (saved.type !== 'source') throw new Error('Missing source at save barrier')
      const reopened = createEditorCoreBinding(createLocalCoreOwner())
      try {
        await reopened.open({ documentId: 'reopened-input.md', source: saved.source })
        expect(await reopened.sourceAtBarrier()).toMatchObject({ source: testCase.expectedSource })
      } finally {
        reopened.dispose()
      }
    } finally {
      adapter.dispose()
      binding.dispose()
      muya.destroy()
      muya.domNode.remove()
      host.remove()
      document.getSelection()?.removeAllRanges()
    }
  })
})

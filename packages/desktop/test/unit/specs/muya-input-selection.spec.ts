// @vitest-environment jsdom

import { Muya } from '@muyajs/core'
import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { reconcileMuyaDocumentView } from '@/documentAuthority/reconcileMuyaDocumentView'

interface SelectionCase {
  name: string
  source: string
  range: readonly [number, number]
  sourceSelection?: readonly [number, number]
  data: string | null
  inputType?: string
  selection: readonly [number, number]
  expected: string
  tracked: boolean
}

const cases: readonly SelectionCase[] = [
  {
    name: 'empty document caret after paired deletion',
    source: '()\n',
    range: [0, 1],
    sourceSelection: [1, 1],
    data: null,
    inputType: 'deleteContentBackward',
    selection: [0, 0],
    expected: '\n',
    tracked: false
  },
  {
    name: 'caret inside an inserted pair',
    source: 'seed\n',
    range: [4, 4],
    data: '(',
    selection: [5, 5],
    expected: 'seed()\n',
    tracked: false
  },
  {
    name: 'caret inside a tracked pair',
    source: 'seed\n',
    range: [4, 4],
    data: '(',
    selection: [5, 5],
    expected: 'seed{++()++}\n',
    tracked: true
  },
  {
    name: 'closer skip with unchanged source revision',
    source: '()\n',
    range: [1, 1],
    data: ')',
    selection: [2, 2],
    expected: '()\n',
    tracked: false
  },
  {
    name: 'selection wrapped around an existing suggestion',
    source: 'a{++b++}c\n',
    range: [0, 9],
    data: '(',
    selection: [1, 4],
    expected: '(a{++b++}c)\n',
    tracked: false
  }
]

it.each(cases)('restores the model-selected $name', async(testCase) => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({
    request: (request) => actor.handle(request),
    dispose: () => actor.dispose()
  })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const muya = new Muya(host)
  try {
    await binding.open({ documentId: 'paired-selection.md', source: testCase.source })
    muya.init()
    const initial = binding.plainTextViewAtBarrier()
    if (initial.type !== 'plain-text-view' || !('state' in initial.view)) { throw new Error('Missing initial model view') }
    muya.setContent(structuredClone([...initial.view.state]))
    const block = muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (!block?.isContent()) throw new Error('Missing native paragraph')
    block.setCursor(0, 0, true)
    const outcome = await binding.submit({
      kind: 'input',
      action: {
        range: { start: testCase.range[0], end: testCase.range[1] },
        selection: {
          ranges: [
            {
              anchor: (testCase.sourceSelection ?? testCase.range)[0],
              focus: (testCase.sourceSelection ?? testCase.range)[1]
            }
          ],
          primary: 0
        },
        inputType: testCase.inputType ?? 'insertText',
        data: testCase.data,
        options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
      },
      tracked: testCase.tracked,
      projections: []
    }).acknowledged
    const next = await binding.plainTextViewAtBarrier()
    if (outcome.type !== 'applied' || next.type !== 'plain-text-view') { throw new Error('Missing accepted input') }
    reconcileMuyaDocumentView({
      muya,
      view: next.view,
      outcome,
      dirtyPaths: [],
      applyEditability: () => {}
    })
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: testCase.expected })
    expect(muya.getSelection()).toMatchObject({
      anchor: { offset: testCase.selection[0] },
      focus: { offset: testCase.selection[1] }
    })
  } finally {
    muya.destroy()
    muya.domNode.remove()
    host.remove()
    binding.dispose()
    document.getSelection()?.removeAllRanges()
  }
})

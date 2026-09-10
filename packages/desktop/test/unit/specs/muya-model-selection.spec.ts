// @vitest-environment jsdom

import { Muya } from '@muyajs/core'
import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'
import {
  createMuyaModelSelection,
  muyaClipboardToModel,
  muyaClipboardInputSelection,
  muyaClipboardSelection,
  muyaInputToModel
} from '@/documentAuthority/muyaModelSelection'

it.each([
  ...['![aaa](url)\n', '![a{++a++}a](url)\n'].map((source) => ({
    source,
    positions: [0, source.length - 1],
    editableBoundary: true
  })),
  { source: 'aa{++\n\n++}aa\n', positions: [0, 2, 5, 7, 10, 12] },
  { source: '> \n\noutside{>>keep<<}\n', positions: [2] },
  { source: '{++a++}\n', positions: [0, 3, 4, 7] },
  { source: '{~~a~>b~~}\n', positions: [0, 3, 4, 6, 7, 10] },
  { source: 'a{++b{==c==}d++}e{>>note<<}\n', positions: [0, 1, 4, 5, 8, 9, 12, 13, 16, 17, 27] },
  { source: '{>>note<<}\n', positions: [0, 10] },
  { source: '{--| aa | aa |\n| :--- | ---: |--}\n', positions: [0, 33], exterior: true },
  { source: '{--|  |  |\n| --- | --- |\n|  |  |--}\n', positions: [0, 35], exterior: true },
  { source: '| aa | bb |\n| --- | --- |{++\n|     |     |++}\n| cc | dd |\n', positions: [35, 41] }
])('preserves exact model boundaries through live DOM selection in $source', (example) => {
  const { source, positions } = example
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({
    request: (request) => actor.handle(request),
    dispose: () => actor.dispose()
  })
  const host = document.body.appendChild(document.createElement('div'))
  const muya = new Muya(host)
  try {
    binding.open({ documentId: 'dom-boundaries.md', source })
    const reply = binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) { throw new Error('Missing model view') }
    const presentation = createMuyaMarkupPresentationIndex(reply.view)
    muya.setInlinePresentation(presentation.render)
    muya.init()
    muya.setContent(structuredClone([...reply.view.state]))
    const bridge = createMuyaModelSelection(muya, reply.view)
    // Reverse and revisit positions to reject a remembered-selection shortcut.
    for (const sourcePosition of [...positions, ...positions.slice().reverse()]) {
      const point = bridge.modelPointToDOM(sourcePosition)
      expect(point, `render source position ${sourcePosition}`).toBeDefined()
      if (point === undefined) throw new Error('Missing source boundary')
      if ('editableBoundary' in example) {
        const element = point.node instanceof Element ? point.node : point.node.parentElement
        expect(
          element?.closest('[contenteditable="false"], .mu-hide'),
          `editable source boundary ${sourcePosition}`
        ).toBeNull()
      }
      muya.editor.selection.setDOMSelection(point, point)
      const selection = muya.editor.selection.getDOMSelection()
      expect(selection).not.toBeNull()
      if (selection === null) throw new Error('Native selection disappeared')
      expect(bridge.domPointToModel(selection.anchor)).toBe(sourcePosition)
      expect(bridge.domPointToModel(selection.focus)).toBe(sourcePosition)
      if ('exterior' in example) {
        expect(bridge.domSelectionToModel(selection)).toEqual({
          ranges: [{ anchor: sourcePosition, focus: sourcePosition }],
          primary: 0
        })
      }
    }
  } finally {
    muya.destroy()
    muya.domNode.remove()
    host.remove()
    binding.dispose()
  }
})

it('round-trips each omitted cell through the live DOM without confusing shared source positions', () => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({
    request: (request) => actor.handle(request),
    dispose: () => actor.dispose()
  })
  const host = document.body.appendChild(document.createElement('div'))
  const muya = new Muya(host)
  const source = '| a | b | c |\n| --- | --- | --- |\n| x |\n'
  try {
    binding.open({ documentId: 'implicit-cell-boundaries.md', source })
    const reply = binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) { throw new Error('Missing model view') }
    muya.setInlinePresentation(createMuyaMarkupPresentationIndex(reply.view).render)
    muya.init()
    muya.setContent(structuredClone([...reply.view.state]))
    const bridge = createMuyaModelSelection(muya, reply.view)
    for (const column of [2, 1, 2]) {
      const selection = {
        kind: 'table-cell' as const,
        cell: { table: { start: 0, end: 39 }, row: 1, column },
        anchor: 0,
        focus: 0
      }
      const point = bridge.modelCellPointToDOM(selection, 0)
      expect(point).toBeDefined()
      if (point === undefined) throw new Error('Missing model cell boundary')
      muya.editor.selection.setDOMSelection(point, point)
      const native = muya.editor.selection.getDOMSelection()
      if (native === null) throw new Error('Missing native cell selection')
      expect(bridge.domSelectionToModel(native)).toEqual(selection)
      expect(
        muyaClipboardToModel(
          muya,
          reply.view,
          { kind: 'paste', selection: native, markdown: 'y' },
          false
        ).selection
      ).toEqual(selection)
      expect(
        muyaClipboardToModel(muya, reply.view, { kind: 'cut', selection: native }, false).selection
      ).toEqual(selection)
      expect(muyaClipboardInputSelection(muya, reply.view)).toEqual(selection)
      const target = { table: { start: 0, end: source.length - 1 }, row: 0, column: 0 }
      const targetPoint = bridge.modelCellPointToDOM(
        { kind: 'table-cell', cell: target, anchor: 0, focus: 0 },
        0
      )
      if (targetPoint === undefined) throw new Error('Missing alignment target cell')
      const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
      expect(
        muyaInputToModel(muya, reply.view, {
          kind: 'command',
          command: 'alignTableColumn',
          target: targetPoint,
          alignment: 'center',
          selection: native,
          options
        })
      ).toEqual({
        kind: 'command',
        command: 'alignTableColumn',
        target,
        alignment: 'center',
        selection,
        options
      })
      // Copy's empty projection remains a source range; it is not a paste target.
      expect(muyaClipboardSelection(muya, reply.view)).toEqual({ start: 39, end: 39 })
      const cell =
        native.anchor.node.parentElement?.closest('td') ??
        (native.anchor.node as Element).closest('td')
      expect(Array.from(muya.domNode.querySelectorAll('td.mu-table-cell')).indexOf(cell!)).toBe(
        3 + column
      )
    }
    expect(binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    muya.destroy()
    muya.domNode.remove()
    host.remove()
    binding.dispose()
  }
})

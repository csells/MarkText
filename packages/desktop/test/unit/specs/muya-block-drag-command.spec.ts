// @vitest-environment jsdom
import { ParagraphFrontButton } from '@muyajs/core'
import { expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it('dragging the actual annotated block moves its source, directed selection and history before the next key', async() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  const source = 'same\n\ns{++a++}me{>>keep<<}\n\nlast\n'
  const moved = 'same\n\nlast\n\ns{++a++}me{>>keep<<}\n'
  const typed = 'same\n\nlast\n\ns{++a++}X{>>keep<<}\n'
  const app = bootBoundMuya(source)
  const button = new ParagraphFrontButton(app.muya)
  const pointDescriptor = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint')
  try {
    const leaf = app.muya.editor.scrollPage?.queryBlock([1, 'text'])
    const destination = app.muya.editor.scrollPage?.queryBlock([2, 'text'])
    if (!leaf?.isContent() || !destination?.isContent()) {
      throw new Error('Expected actual block targets')
    }
    const last = leaf.domNode!.childNodes[2]
    if (last?.textContent !== 'me') throw new Error('Expected exact source-owned final text')
    app.muya.editor.selection.setDOMSelection({ node: last, offset: 2 }, { node: last, offset: 0 })
    button.show(leaf.outMostBlock!)
    button.render()
    const drag = document.querySelector('.mu-front-button')
    if (!drag) throw new Error('Expected native drag button')
    drag.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 320))
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [destination.outMostBlock!.domNode]
    })
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 20, clientY: 20, bubbles: true, cancelable: true })
    )
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: moved })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { path: [2, 'text'], offset: 4 },
      focus: { path: [2, 'text'], offset: 2 }
    })
    const input = app.muya.editor.selection.getSelection()?.anchor.block
    if (!input) throw new Error('Expected moved selection')
    input.domNode!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'X',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { path: [1, 'text'], offset: 4 },
      focus: { path: [1, 'text'], offset: 2 }
    })
    await app.adapter.history('redo', app.reconcile)
    await app.adapter.history('redo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    const reopened = bootBoundMuya(typed)
    try {
      expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    } finally {
      reopened.dispose()
    }
  } finally {
    if (pointDescriptor === undefined) Reflect.deleteProperty(document, 'elementsFromPoint')
    else Object.defineProperty(document, 'elementsFromPoint', pointDescriptor)
    button.destroy()
    app.dispose()
    vi.unstubAllGlobals()
  }
})

it.each([
  {
    name: 'normalized literal',
    source: 'top\n\n  ```math\n\tx\n  ```\n\nbottom\n',
    moved: 'top\n\nbottom\n\n  ```math\n\tx\n  ```\n',
    typed: 'top\n\nbottom\n\n  ```math\n   y x\n  ```\n'
  },
  {
    name: 'table cell',
    source: 'top\n\n| abc |\n| --- |\n| def |\n\nbottom\n',
    moved: 'top\n\nbottom\n\n| abc |\n| --- |\n| def |\n',
    // The cell edit changes only its own bytes (ADR 0007).
    typed: 'top\n\nbottom\n\n| aybc |\n| --- |\n| def |\n'
  }
])('block move retains the intrinsic $name caret and next input', async(example) => {
  const app = bootBoundMuya(example.source, { texMathGfm: true })
  try {
    const block = app.muya.editor.scrollPage?.queryBlock([1])
    const destination = app.muya.editor.scrollPage?.queryBlock([2, 'text'])
    const leaf = block?.isParent() ? block.firstContentInDescendant() : undefined
    if (!leaf || !destination?.isContent()) throw new Error('Expected owned drag endpoints')
    leaf.setCursor(1, 1, true)
    const from = app.muya.editor.selection.getDOMPoint({ path: leaf.path, offset: 0 })
    const to = app.muya.editor.selection.getDOMPoint({ path: destination.path, offset: 0 })
    if (!from || !to) throw new Error('Expected rendered drag endpoints')
    const selection = app.muya.editor.selection.getDOMSelection()
    if (!selection) throw new Error('Expected intrinsic native selection')
    app.muya.editor.documentEditing!.input(
      {
        kind: 'command',
        command: 'moveBlock',
        from,
        to,
        placement: 'after',
        selection,
        options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
      },
      () => {}
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: example.moved })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
    const input = app.muya.editor.selection.getSelection()?.anchor.block
    if (!input) throw new Error('Expected intrinsic selection')
    input.domNode!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'y',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: example.typed })
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: example.source })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
  } finally {
    app.dispose()
  }
})

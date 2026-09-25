// @vitest-environment jsdom
import { FootnoteTool, ParagraphFrontMenu, PreviewToolBar } from '@muyajs/core'
import { expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it('generic reset owns the explicit heading target independently of the original selection', async() => {
  const source = 'first\n\n# s{++a++}me{>>keep<<}\n'
  const app = bootBoundMuya(source)
  try {
    const page = app.muya.editor.scrollPage!
    page.firstContentInDescendant()!.setCursor(2, 2, true)
    const heading = page.queryBlock([1, 'text'])
    if (!heading?.isContent()) throw new Error('Expected target heading')
    app.muya.resetToParagraph(heading.parent!)
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: 'first\n\ns{++a++}me{>>keep<<}\n'
    })
    const input = app.muya.editor.selection.getSelection()!.anchor.block
    input.domNode!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: 'first\n\ns{++a++}mex{>>keep<<}\n'
    })
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { path: [0, 'text'], offset: 2 },
      focus: { path: [0, 'text'], offset: 2 }
    })
  } finally {
    app.dispose()
  }
})

it.each([
  {
    source: 'first\n\n$$\nx+y\n$$\n\nlast\n',
    changed: 'first\n\n\n\nlast\n',
    typed: 'first\n\nx\n\nlast\n'
  },
  {
    source: 'first{>>keep<<}\n\n{++$$\nx+y\n$$++}\n\nlast\n',
    changed: 'first{>>keep<<}\n\n\n\nlast\n',
    typed: 'first{>>keep<<}\n\nx\n\nlast\n'
  }
])(
  'preview Delete creates a model paragraph before the next key in $source',
  async({ source, changed, typed }) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const app = bootBoundMuya(source)
    const tool = new PreviewToolBar(app.muya)
    const original = document.elementsFromPoint
    try {
      const page = app.muya.editor.scrollPage!
      page.firstContentInDescendant()!.setCursor(2, 2, true)
      const math = page.queryBlock([1])!
      document.elementsFromPoint = () => [math.domNode!]
      document.body.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 2, clientY: 2 })
      )
      await new Promise((resolve) => setTimeout(resolve, 320))
      ;(tool.container!.querySelector('li.delete') as HTMLElement).click()
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: changed })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      const input = app.muya.editor.selection.getSelection()!.anchor.block
      input.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
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
        anchor: { path: [0, 'text'], offset: 2 },
        focus: { path: [0, 'text'], offset: 2 }
      })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      const reopened = bootBoundMuya(typed)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      } finally {
        reopened.dispose()
      }
    } finally {
      document.elementsFromPoint = original
      tool.destroy()
      app.dispose()
      vi.unstubAllGlobals()
    }
  }
)

it.each([
  {
    command: 'duplicate',
    source: 's{++a++}me{>>keep<<}\n\nlast\n',
    changed: 's{++a++}me{>>keep<<}\n\ns{++a++}me{>>keep<<}\n\nlast\n',
    typed: 's{++a++}me{>>keep<<}\n\nxs{++a++}me{>>keep<<}\n\nlast\n'
  },
  {
    command: 'delete',
    source: 's{++a++}me{>>keep<<}\n\nlast\n',
    changed: 'last\n',
    typed: 'xlast\n'
  },
  {
    command: 'before',
    source: 's{++a++}me{>>keep<<}\n\nlast\n',
    changed: 'new\n\ns{++a++}me{>>keep<<}\n\nlast\n',
    typed: 'xnew\n\ns{++a++}me{>>keep<<}\n\nlast\n'
  },
  {
    command: 'after',
    source: 's{++a++}me{>>keep<<}\n\nlast\n',
    changed: 's{++a++}me{>>keep<<}\n\nnew\n\nlast\n',
    typed: 's{++a++}me{>>keep<<}\n\nxnew\n\nlast\n'
  },
  {
    command: 'before',
    source: '> s{++a++}me{>>keep<<}\n\nlast\n',
    changed: '> new\n>\n> s{++a++}me{>>keep<<}\n\nlast\n',
    typed: '> xnew\n>\n> s{++a++}me{>>keep<<}\n\nlast\n'
  },
  {
    command: 'after',
    source: '- s{++a++}me{>>keep<<}\n\nlast\n',
    changed: '- s{++a++}me{>>keep<<}\n\n  new\n\nlast\n',
    typed: '- s{++a++}me{>>keep<<}\n\n  xnew\n\nlast\n'
  }
])(
  'public $command preserves the common document and native target scope in $source',
  async({ command, source, changed, typed }) => {
    const app = bootBoundMuya(source)
    try {
      app.muya.editor.scrollPage!.firstContentInDescendant()!.setCursor(2, 2, true)
      if (command === 'duplicate') app.muya.duplicate()
      else if (command === 'delete') app.muya.deleteParagraph()
      else app.muya.insertParagraph(command as 'before' | 'after', 'new')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: changed })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      const input = app.muya.editor.selection.getSelection()!.anchor.block
      input.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
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
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 2 }, focus: { offset: 2 } })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      const reopened = bootBoundMuya(typed)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)

it.each(['text[^fresh]\n', 't{++ext++}[^fresh]{>>keep<<}\n', 'text[^fr{++esh++}]{>>keep<<}\n'])(
  'footnote Create owns the new definition and its next key in %s',
  async(source) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const app = bootBoundMuya(source, { footnotes: true })
    const tool = new FootnoteTool(app.muya)
    try {
      const block = app.muya.editor.scrollPage!.firstContentInDescendant()!
      block.setCursor(2, 2, true)
      ;(block.domNode!.querySelector('#noteref-fresh a') as HTMLElement).click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      ;(tool.container!.querySelector('a.btn') as HTMLAnchorElement).click()
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: source + '\n[^fresh]: ' })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      const input = app.muya.editor.selection.getSelection()!.anchor.block
      input.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      const typed = source + '\n[^fresh]: x'
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      const reopened = bootBoundMuya(typed, { footnotes: true })
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      } finally {
        reopened.dispose()
      }
    } finally {
      tool.destroy()
      app.dispose()
      vi.unstubAllGlobals()
    }
  }
)

it('duplicates the actual repeated annotated block before the next key', async() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  const source = 'same\n\ns{++a++}me{>>keep<<}\n\nlast\n'
  const duplicated = 'same\n\ns{++a++}me{>>keep<<}\n\ns{++a++}me{>>keep<<}\n\nlast\n'
  const typed = 'same\n\ns{++a++}me{>>keep<<}\n\nxs{++a++}me{>>keep<<}\n\nlast\n'
  const app = bootBoundMuya(source)
  const menu = new ParagraphFrontMenu(app.muya)
  try {
    const block = app.muya.editor.scrollPage?.queryBlock([1, 'text'])
    if (!block?.isContent()) throw new Error('Expected annotated paragraph')
    const origin = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (!origin?.isContent()) throw new Error('Expected original selection paragraph')
    origin.setCursor(2, 2, true)
    app.muya.eventCenter.emit('muya-front-menu', {
      reference: block.domNode,
      block: block.outMostBlock
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    menu.selectItem(new MouseEvent('click'), { label: 'duplicate' })
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: duplicated })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
    const input = app.muya.editor.selection.getSelection()?.anchor.block
    if (!input) throw new Error('Expected duplicate selection')
    input.domNode!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
    // Upstream History groups the front menu's action with the key typed
    // within its one-second window.
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { offset: 2, path: [0, 'text'] },
      focus: { offset: 2, path: [0, 'text'] }
    })
    await app.adapter.history('redo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    const reopened = bootBoundMuya(typed)
    try {
      expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    } finally {
      reopened.dispose()
    }
  } finally {
    menu.destroy()
    app.dispose()
    vi.unstubAllGlobals()
  }
})

it('Backspace at an annotated heading start resets through the model', async() => {
  const source = '# s{++a++}me{>>keep<<}\n'
  const app = bootBoundMuya(source)
  try {
    const block = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!block) throw new Error('Expected heading')
    expect(block.blockName).toBe('atxheading.content')
    block.setCursor(0, 0, true)
    block.domNode!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 's{++a++}me{>>keep<<}\n' })
    const input = app.muya.editor.selection.getSelection()?.anchor.block
    if (!input) throw new Error('Expected model paragraph')
    expect(input.blockName).toBe('paragraph.content')
    input.domNode!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'xs{++a++}me{>>keep<<}\n' })
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    app.dispose()
  }
})

it('reset of an existing paragraph retains native end-caret behavior without rewriting annotations', () => {
  const app = bootBoundMuya('s{++a++}me{>>keep<<}\n')
  try {
    const block = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!block) throw new Error('Expected paragraph')
    block.setCursor(1, 1, true)
    app.muya.updateParagraph('reset-to-paragraph')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 's{++a++}me{>>keep<<}\n' })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 4 }, focus: { offset: 4 } })
    const input = app.muya.editor.selection.getSelection()?.anchor.block
    if (!input) throw new Error('Expected paragraph insertion point')
    input.domNode!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 's{++a++}mex{>>keep<<}\n' })
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
  }
})

it.each([
  {
    label: 'new',
    source: 'same\n\ns{++a++}me{>>keep<<}\n\nlast\n',
    changed: 'same\n\ns{++a++}me{>>keep<<}\n\n\n\nlast\n',
    typed: 'same\n\ns{++a++}me{>>keep<<}\n\nx\n\nlast\n'
  },
  {
    label: 'delete',
    source: 'same\n\ns{++a++}me{>>keep<<}\n\nlast\n',
    changed: 'same\n\nlast\n',
    typed: 'xsame\n\nlast\n'
  }
])(
  '$label targets the annotated block and owns subsequent input',
  async({ label, source, changed, typed }) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const app = bootBoundMuya(source)
    const menu = new ParagraphFrontMenu(app.muya)
    try {
      const block = app.muya.editor.scrollPage?.queryBlock([1, 'text'])
      if (!block?.isContent()) throw new Error('Expected middle paragraph')
      block.setCursor(2, 2, true)
      app.muya.eventCenter.emit('muya-front-menu', {
        reference: block.domNode,
        block: block.outMostBlock
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      menu.selectItem(new MouseEvent('click'), { label })
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: changed })
      const input = app.muya.editor.selection.getSelection()?.anchor.block
      if (!input) throw new Error('Expected model-owned insertion point')
      input.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      // Upstream History groups the front menu's action with the key typed
      // within its one-second window.
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      const reopened = bootBoundMuya(typed)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      } finally {
        reopened.dispose()
      }
    } finally {
      menu.destroy()
      app.dispose()
      vi.unstubAllGlobals()
    }
  }
)

it.each([
  { name: 'math', source: '$$\nx+y\n$$\n', changed: 'x+y\n', typed: 'x+yx\n' },
  {
    name: 'annotated math',
    source: '{++$$\nx+y\n$$++}\n',
    changed: '{++x+y++}\n',
    typed: '{++x+yx++}\n'
  },
  {
    name: 'front matter',
    source: '---\ntitle: hi\n---\n',
    changed: 'title: hi\n',
    typed: 'title: hix\n'
  }
])('reset of $name enters the common model', async({ source, changed, typed }) => {
  const app = bootBoundMuya(source)
  try {
    const block = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!block) throw new Error('Expected literal content')
    block.setCursor(1, 1, true)
    app.muya.updateParagraph('reset-to-paragraph')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: changed })
    const input = app.muya.editor.selection.getSelection()?.anchor.block
    if (!input) throw new Error('Expected reset paragraph')
    input.domNode!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
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
    app.dispose()
  }
})

it('duplicates the whole annotated list and selects its last item', async() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  const source = '- first\n- s{++a++}me{>>keep<<}\n\nlast\n'
  const duplicated = '- first\n- s{++a++}me{>>keep<<}\n\n- first\n- s{++a++}me{>>keep<<}\n\nlast\n'
  const typed = '- first\n- s{++a++}me{>>keep<<}\n\n- first\n- xs{++a++}me{>>keep<<}\n\nlast\n'
  const app = bootBoundMuya(source)
  const menu = new ParagraphFrontMenu(app.muya)
  try {
    const block = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!block) throw new Error('Expected list')
    block.setCursor(2, 2, true)
    app.muya.eventCenter.emit('muya-front-menu', {
      reference: block.domNode,
      block: block.outMostBlock
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    menu.selectItem(new MouseEvent('click'), { label: 'duplicate' })
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: duplicated })
    const input = app.muya.editor.selection.getSelection()?.anchor.block
    if (!input) throw new Error('Expected duplicate final item')
    expect(input.text).toBe('same')
    input.domNode!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    expect(app.legacyChanges).toEqual([])
    // Upstream History groups the front menu's action with the key typed
    // within its one-second window.
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    menu.destroy()
    app.dispose()
    vi.unstubAllGlobals()
  }
})

it('tracks a literal reset as one operation and edits its resulting paragraph', async() => {
  const app = bootBoundMuya('$$\nx+y\n$$\n')
  app.track(true)
  try {
    const block = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!block) throw new Error('Expected math content')
    block.setCursor(1, 1, true)
    app.muya.updateParagraph('reset-to-paragraph')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '{~~$$\nx+y\n$$~>x+y~~}\n' })
    const input = app.muya.editor.selection.getSelection()?.anchor.block
    if (!input) throw new Error('Expected reset paragraph')
    expect(input.blockName).toBe('paragraph.content')
    input.domNode!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '{~~$$\nx+y\n$$~>x+yx~~}\n' })
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '$$\nx+y\n$$\n' })
  } finally {
    app.dispose()
  }
})

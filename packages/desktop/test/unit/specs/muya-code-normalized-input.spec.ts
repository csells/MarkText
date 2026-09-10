// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each([false, true])(
  'uses a wrapped normalized selection for the next key before acknowledgement (tracked addition=%s)',
  async(tracked) => {
    const source = tracked ? '{++  ```\n\tbody\n  ```++}\n' : '  ```\n\tbody\n  ```\n'
    const wrapped = tracked ? '{++  ```\n   ( )body\n  ```++}\n' : '  ```\n   ( )body\n  ```\n'
    const typed = tracked ? '{++  ```\n   (x)body\n  ```++}\n' : '  ```\n   (x)body\n  ```\n'
    const app = bootBoundMuya(source)
    try {
      app.track(tracked)
      const block = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
      if (!block?.isContent()) throw new Error('Expected code body')
      block.setCursor(2, 1, true)
      block.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: '(',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: wrapped })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 3 }, focus: { offset: 2 } })
      const input = app.muya.editor.selection.getSelection()?.anchor.block
      if (!input) throw new Error('Expected wrapped code body')
      expect(input.text).toBe(' ( )body')
      input.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 3 }, focus: { offset: 3 } })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      // Consecutive native input uses the existing canonical typing group.
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 2 }, focus: { offset: 1 } })
      await app.adapter.history('redo', app.reconcile)
      const saved = app.binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Expected acknowledged source')
      expect(saved.source).toBe(typed)
      const reopened = bootBoundMuya(saved.source)
      try {
        expect(reopened.muya.getState()).toMatchObject([{ name: 'code-block', text: ' (x)body' }])
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)

it('tracks normalized wrapping and its next key in the same live model', async() => {
  const source = '  ```\n\tbody\n  ```\n'
  const wrapped = '  {~~```\n\tbody\n  ```\n~>```\n   ( )body\n  ```\n~~}'
  const typed = '  {~~```\n\tbody\n  ```\n~>```\n   (x)body\n  ```\n~~}'
  const app = bootBoundMuya(source)
  try {
    app.track(true)
    const block = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (!block?.isContent()) throw new Error('Expected code body')
    block.setCursor(2, 1, true)
    block.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: '(',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: wrapped })
    expect
      .soft(app.muya.getSelection())
      .toMatchObject({ anchor: { offset: 3 }, focus: { offset: 2 } })
    const input = app.muya.editor.selection.getSelection()?.anchor.block
    if (!input) throw new Error('Expected tracked code body')
    expect.soft(input.text).toBe(' ( )body')
    input.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 3 }, focus: { offset: 3 } })
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 2 }, focus: { offset: 1 } })
    await app.adapter.history('redo', app.reconcile)
    const saved = app.binding.sourceAtBarrier()
    if (saved.type !== 'source') throw new Error('Expected acknowledged source')
    expect(saved.source).toBe(typed)
    const reopened = bootBoundMuya(saved.source)
    try {
      if (reopened.binding.consumerProjectionAtBarrier === undefined) { throw new Error('Expected synchronous projection owner') }
      expect(reopened.binding.consumerProjectionAtBarrier()).toMatchObject({
        projection: { markdown: '  ```\n   (x)body\n  ```\n' }
      })
    } finally {
      reopened.dispose()
    }
  } finally {
    app.dispose()
  }
})

it('edits inside parser-normalized tab indentation without losing literal text or source history', async() => {
  const source = '  ```\n\tbody\n  ```\n'
  // Two spaces belong to the opening fence indentation. The rendered two
  // remaining tab columns become space, x, space after typing at offset one.
  const typed = '  ```\n   x body\n  ```\n'
  const app = bootBoundMuya(source)
  try {
    const block = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (!block?.isContent()) throw new Error('Expected code body')
    expect(block.text).toBe('  body')
    block.setCursor(1, 1, true)
    block.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    const edited = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (!edited?.isContent()) throw new Error('Expected edited code body')
    expect(edited.text).toBe(' x body')
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 2 }, focus: { offset: 2 } })
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
    await app.adapter.history('redo', app.reconcile)
    const saved = app.binding.sourceAtBarrier()
    if (saved.type !== 'source') throw new Error('Expected acknowledged source')
    expect(saved.source).toBe(typed)
    const reopened = bootBoundMuya(saved.source)
    try {
      expect(reopened.muya.getState()).toMatchObject([{ name: 'code-block', text: ' x body' }])
    } finally {
      reopened.dispose()
    }
  } finally {
    app.dispose()
  }
})

it('keeps normalized literal selection and exact source through a formatting no-op', async() => {
  const source = '  ```\n\tbody\n  ```\n'
  const app = bootBoundMuya(source)
  try {
    const block = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (!block?.isContent()) throw new Error('Expected code body')
    block.setCursor(1, 1, true)
    app.muya.format('strong')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
    block.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '  ```\n   x body\n  ```\n' })
    expect(app.legacyChanges).toEqual([])
    await expect(app.adapter.settled()).resolves.toBeUndefined()
  } finally {
    app.dispose()
  }
})

it('restores an interior tab caret after canceled native composition before the next key', async() => {
  const source = '  ```\n\tbody\n  ```\n'
  const app = bootBoundMuya(source)
  try {
    const block = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (!block?.isContent()) throw new Error('Expected code body')
    block.setCursor(1, 1, true)
    block.domNode.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true, data: '' })
    )
    expect(app.adapter.isSettled()).toBe(false)
    block.domNode.dispatchEvent(
      new CompositionEvent('compositionupdate', { bubbles: true, data: 'n' })
    )
    block.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        inputType: 'insertCompositionText',
        data: 'n',
        isComposing: true
      })
    )
    block.domNode.textContent = ' n body'
    block.setCursor(2, 2, true)
    block.domNode.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertCompositionText',
        data: 'n',
        isComposing: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    block.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', isComposing: true })
    )
    block.domNode.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
    const restored = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (!restored?.isContent()) throw new Error('Expected restored code body')
    expect(restored.text).toBe('  body')
    restored.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '  ```\n   x body\n  ```\n' })
    expect(app.legacyChanges).toEqual([])
    await expect(app.adapter.settled()).resolves.toBeUndefined()
  } finally {
    app.dispose()
  }
})

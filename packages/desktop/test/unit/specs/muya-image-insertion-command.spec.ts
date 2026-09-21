// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each([
  {
    source: 'same same{>>keep<<}\n',
    range: [5, 9],
    image: '![same](images/cat.png)',
    changed: 'same ![same](images/cat.png){>>keep<<}\n'
  },
  {
    source: 'same s{++am++}e{>>keep<<}\n',
    range: [5, 9],
    image: '![s{++am++}e](images/cat.png)',
    changed: 'same ![s{++am++}e](images/cat.png){>>keep<<}\n'
  },
  {
    source: 'same {>>keep<<}\n',
    range: [5, 5],
    image: '![cat](images/cat.png)',
    changed: 'same ![cat](images/cat.png){>>keep<<}\n'
  }
])(
  'native image insertion uses the selected model payload: $source',
  async({ source, range, image, changed }) => {
    const app = bootBoundMuya(source)
    try {
      app.muya.editor.scrollPage!.firstContentInDescendant()!.setCursor(range[0]!, range[1]!, true)
      app.muya.insertImage({ src: 'images/cat.png' })
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: changed })
      app.muya.editor.selection.getSelection()!.anchor.block.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({
        source: changed.replace(image, image + 'x')
      })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: range[0] },
        focus: { offset: range[1] }
      })
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: changed })
      const reopened = bootBoundMuya(changed)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: changed })
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)

it.each([false, true])('tracks image insertion (collapsed=%s)', async(collapsed) => {
  const source = 'same\n'
  const changed = collapsed
    ? 'same{++![cat](images/cat.png)++}\n'
    : '{~~same~>![same](images/cat.png)~~}\n'
  const app = bootBoundMuya(source)
  try {
    app.track(true)
    app.muya.editor.scrollPage!.firstContentInDescendant()!.setCursor(collapsed ? 4 : 0, 4, true)
    app.muya.insertImage({ src: 'images/cat.png' })
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: changed })
    app.muya.editor.selection.getSelection()!.anchor.block.domNode!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: changed.replace(')++}', ')x++}').replace(')~~}', ')x~~}')
    })
    await app.adapter.history('undo', app.reconcile)
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    app.dispose()
  }
})

it.each(['https://example.test/cat.svg#view', 'https://example.test/a%20cat.svg#view'])(
  'keeps URL spelling when Insert Image authors %s',
  (src) => {
    const app = bootBoundMuya('same\n')
    try {
      app.muya.editor.scrollPage!.firstContentInDescendant()!.setCursor(4, 4, true)
      app.muya.insertImage({ src, alt: 'cat' })
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: `same![cat](${src})\n` })
    } finally {
      app.dispose()
    }
  }
)

it.each([
  { source: 'a]b\n', image: '![a\\]b](cat.png)' },
  { source: 'a{++]++}b\n', image: '![a{++\\]++}b](cat.png)' },
  { source: 'a\\]b\n', image: '![a\\]b](cat.png)' },
  { source: 'a&#93;b\n', image: '![a&#93;b](cat.png)' }
])(
  'image insertion safely spells the selected literal bracket in $source',
  async({ source, image }) => {
    const app = bootBoundMuya(source)
    try {
      const leaf = app.muya.editor.scrollPage!.firstContentInDescendant()!
      leaf.setCursor(0, leaf.text.length, true)
      app.muya.insertImage({ src: 'cat.png' })
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: image + '\n' })
      const widget = app.muya.domNode.querySelector('[data-core-image]')
      expect(widget).not.toBeNull()
      expect(JSON.parse(widget!.getAttribute('data-core-image')!).alt).toBe('a]b')
      app.muya.editor.selection
        .getSelection()!
        .anchor.block.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'X',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: image + 'X\n' })
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      const reopened = bootBoundMuya(image + 'X\n')
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: image + 'X\n' })
        expect(reopened.muya.domNode.querySelector('[data-core-image]')).not.toBeNull()
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)

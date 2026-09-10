// @vitest-environment jsdom
import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

for (const ending of ['\n', '\r\n', '\r']) {
  for (const tracked of [false, true]) {
    for (const annotated of [false, true]) {
      it(`native Tab and Shift+Tab govern list topology and the next key (${JSON.stringify(ending)}, tracked=${tracked}, CM=${annotated})`, async() => {
        const first = annotated ? '{++first++}{>>keep<<}' : 'first'
        const source = '- ' + first + ending + '- second' + ending
        const indented = '- ' + first + ending + (tracked ? '{++  ++}' : '  ') + '- second' + ending
        const typed = indented.replace('second', tracked ? 'se{++x++}cond' : 'sexcond')
        const app = bootBoundMuya(source)
        app.track(tracked)
        try {
          const block = app.muya.editor.scrollPage
            ?.firstContentInDescendant()
            ?.nextContentInContext()
          if (!block) throw new Error('Expected second item')
          block.setCursor(2, 2, true)
          block.domNode.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
          )
          expect(app.binding.sourceAtBarrier()).toMatchObject({ source: indented })
          expect(app.muya.getSelection()).toMatchObject({
            anchor: { offset: 2 },
            focus: { offset: 2 }
          })
          const input = app.muya.editor.selection.getSelection()?.anchor.block
          if (!input) throw new Error('Expected live nested item')
          expect(input.domNode.closest('li')?.parentElement?.closest('li')).not.toBeNull()
          input.domNode.dispatchEvent(
            new InputEvent('beforeinput', {
              inputType: 'insertText',
              data: 'x',
              bubbles: true,
              cancelable: true
            })
          )
          expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
          expect(app.legacyChanges).toEqual([])
          await app.adapter.history('undo', app.reconcile)
          expect(app.binding.sourceAtBarrier()).toMatchObject({ source: indented })
          const outdent = app.muya.editor.selection.getSelection()?.anchor.block
          if (!outdent) throw new Error('Expected nested item after undo')
          outdent.domNode.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Tab',
              shiftKey: true,
              bubbles: true,
              cancelable: true
            })
          )
          expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
          expect(app.muya.getSelection()).toMatchObject({
            anchor: { offset: 2 },
            focus: { offset: 2 }
          })
          await app.adapter.history('undo', app.reconcile)
          expect(app.binding.sourceAtBarrier()).toMatchObject({ source: indented })
          await app.adapter.history('undo', app.reconcile)
          expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
          await app.adapter.history('redo', app.reconcile)
          const core = createDocumentCore()
          const saved = app.binding.sourceAtBarrier()
          if (saved.type !== 'source') throw new Error('Expected accepted source')
          const reopened = core.open(saved.source)
          expect(reopened.source).toBe(indented)
          expect(core.project(reopened, 'revised').markdown).toBe(
            '- first' + ending + '  - second' + ending
          )
          expect(core.project(reopened, 'original').markdown).toBe(
            '- ' + (annotated ? '' : 'first') + ending + (tracked ? '' : '  ') + '- second' + ending
          )
        } finally {
          app.dispose()
        }
      })
    }
  }
}

it.each(
  [
    { text: '**bold**', before: 6, after: 8 },
    { text: '*word*', before: 5, after: 6 },
    { text: '~~word~~', before: 6, after: 8 },
    { text: '`word`', before: 5, after: 6 },
    { text: '$word$', before: 5, after: 6 },
    { text: '[label](dest)', before: 6, after: 8 },
    { text: '[label](dest)', before: 12, after: 13 },
    { text: '<u>word</u>', before: 7, after: 11 },
    { text: '<span>word</span>', before: 10, after: 17 }
  ].flatMap((example) => [false, true].map((annotated) => ({ ...example, annotated })))
)(
  'Tab closes $text before considering list indentation (CM=$annotated)',
  ({ text, before, after, annotated }) => {
    const source = '- first' + (annotated ? '{>>keep<<}' : '') + '\n- ' + text + '\n'
    const app = bootBoundMuya(source)
    try {
      const block = app.muya.editor.scrollPage?.firstContentInDescendant()?.nextContentInContext()
      if (!block) throw new Error('Expected second item')
      block.setCursor(before, before, true)
      block.domNode.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: after },
        focus: { offset: after }
      })
      expect(app.legacyChanges).toEqual([])
    } finally {
      app.dispose()
    }
  }
)

it.each([
  { source: '- - A\n  - B\n', expected: '- B\n  - A\n', target: 'B', shift: true },
  {
    source: '- first\n  - second\n  - third\n- final\n',
    expected: '- first\n- second\n  - third\n- final\n',
    target: 'second',
    shift: true
  },
  {
    source: '- first\n  1. second\n- third\n',
    expected: '- first\n  1. second\n  2. third\n',
    target: 'third',
    shift: false
  },
  {
    source: '1. first\n   - second\n2. third\n',
    expected: '1. first\n2. second\n2. third\n',
    target: 'second',
    shift: true
  }
])(
  'Tab retains native structural behavior in $source',
  async({ source, expected, target, shift }) => {
    const app = bootBoundMuya(source)
    try {
      let block = app.muya.editor.scrollPage?.firstContentInDescendant()
      while (block && block.text !== target) block = block.nextContentInContext()
      if (!block) throw new Error('Expected target item')
      block.setCursor(1, 1, true)
      block.domNode.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: shift,
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      app.dispose()
    }
  }
)

it.each([
  { source: '- - A\n  - B\n', expected: '- A\n  - B\n', target: 'A' },
  { source: '- - A\n', expected: '- A\n', target: 'A' }
])('Shift+Tab promotes the leading nested paragraph in $source', ({ source, expected, target }) => {
  const app = bootBoundMuya(source)
  try {
    let block = app.muya.editor.scrollPage?.firstContentInDescendant()
    while (block && block.text !== target) block = block.nextContentInContext()
    if (!block) throw new Error('Expected target item')
    block.setCursor(1, 1, true)
    block.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
  }
})

it.each([
  { source: '- - A\n', revised: '- A\n', exact: '- {--- --}A\n', target: 'A', shift: true },
  {
    source: '- - A\n  - B\n',
    revised: '- B\n  - A\n',
    exact: '- {++B\n  ++}- A\n{--  - B\n--}',
    target: 'B',
    shift: true
  },
  {
    source: '- first\n  1. second\n- third\n',
    revised: '- first\n  1. second\n  2. third\n',
    exact: '- first\n  1. second\n{~~- ~>  2. ~~}third\n',
    target: 'third',
    shift: false
  }
])(
  'tracked Tab preserves both projections and history in $source',
  async({ source, revised, exact, target, shift }) => {
    const app = bootBoundMuya(source)
    app.track(true)
    try {
      let block = app.muya.editor.scrollPage?.firstContentInDescendant()
      while (block && block.text !== target) block = block.nextContentInContext()
      if (!block) throw new Error('Expected target item')
      block.setCursor(1, 1, true)
      block.domNode.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: shift,
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: exact })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
      const core = createDocumentCore()
      const reopened = core.open(exact)
      expect(core.project(reopened, 'original').markdown).toBe(source)
      expect(core.project(reopened, 'revised').markdown).toBe(revised)
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: exact })
    } finally {
      app.dispose()
    }
  }
)

it('Tab skips an HTML closer nested inside strong before list indentation', () => {
  const source = '- first\n- **<u>word</u>**\n'
  const app = bootBoundMuya(source)
  try {
    const block = app.muya.editor.scrollPage?.firstContentInDescendant()?.nextContentInContext()
    if (!block) throw new Error('Expected second item')
    block.setCursor(9, 9, true)
    block.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 13 }, focus: { offset: 13 } })
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
  }
})

it.each([
  { source: '- first\n- [ ] second\n', expected: '- first\n- [ ] se    cond\n' },
  { source: '- [ ] first\n- second\n', expected: '- [ ] first\n- se    cond\n' }
])(
  'Tab respects the first item of each native task/plain list group in $source',
  ({ source, expected }) => {
    const app = bootBoundMuya(source)
    try {
      const block = app.muya.editor.scrollPage?.firstContentInDescendant()?.nextContentInContext()
      if (!block) throw new Error('Expected second group')
      block.setCursor(2, 2, true)
      block.domNode.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 6 }, focus: { offset: 6 } })
      expect(app.legacyChanges).toEqual([])
    } finally {
      app.dispose()
    }
  }
)

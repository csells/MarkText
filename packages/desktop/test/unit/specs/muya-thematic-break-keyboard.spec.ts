// @vitest-environment jsdom
import { Muya } from '@muyajs/core'
import { expect, it } from 'vitest'
import { createMuyaModelSelection } from '@/documentAuthority/muyaModelSelection'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

const cases = [
  {
    name: 'Backspace at the rule start',
    key: 'Backspace',
    anchor: 0,
    focus: 0,
    caret: 0,
    inserted: '\n\n\n\n',
    typed: '\n\nx\n\n',
    text: ''
  },
  {
    name: 'Enter at the rule start',
    key: 'Enter',
    anchor: 0,
    focus: 0,
    caret: 0,
    inserted: '\n\n\n\n---\n\n',
    typed: '\n\n\n\nx---\n\n',
    text: '---'
  },
  {
    name: 'Enter inside the rule',
    key: 'Enter',
    anchor: 1,
    focus: 1,
    caret: 0,
    inserted: '\n\n---\n\n\n\n',
    typed: '\n\n---\n\nx\n\n',
    text: ''
  },
  {
    name: 'Enter with selected rule text',
    key: 'Enter',
    anchor: 0,
    focus: 2,
    caret: 0,
    inserted: '\n\n---\n\n\n\n',
    typed: '\n\n---\n\nx\n\n',
    text: ''
  }
]

const trackedCases = [
  // Markup retains the three deleted marker characters. Its exterior is
  // local offset three; the source-boundary test below proves it is outside
  // the deletion and subsequent input leaves the old rule untouched.
  {
    ...cases[0],
    caret: 3,
    text: '---',
    inserted: '\n\n{-------}\n\n',
    typed: '\n\n{-------}{++x++}\n\n'
  },
  { ...cases[1], inserted: '\n\n{++\n\n++}---\n\n', typed: '\n\n{++\n\nx++}---\n\n' },
  { ...cases[2], inserted: '\n\n---{++\n\n++}\n\n', typed: '\n\n---{++\n\nx++}\n\n' },
  { ...cases[3], inserted: '\n\n---{++\n\n++}\n\n', typed: '\n\n---{++\n\nx++}\n\n' }
]

it.each(cases)('retains native $name spelling and resulting selection', (example) => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const host = document.body.appendChild(document.createElement('div'))
  const muya = new Muya(host, { markdown: 'a\n\n---\n\nb\n' })
  muya.init()
  try {
    const rule = muya.editor.scrollPage?.firstContentInDescendant()?.nextContentInContext()
    if (!rule || rule.blockName !== 'thematicbreak.content') throw new Error('Expected native rule')
    rule.setCursor(example.anchor, example.focus, true)
    const event = new KeyboardEvent('keydown', {
      key: example.key,
      bubbles: true,
      cancelable: true
    })
    rule.domNode.dispatchEvent(event)
    muya.flush()
    expect(event.defaultPrevented).toBe(true)
    expect(muya.getMarkdown()).toBe('a' + example.inserted + 'b\n')
    expect(muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
    expect(muya.editor.selection.getSelection()?.anchor.block.text).toBe(example.text)
  } finally {
    muya.destroy()
    host.remove()
    document.getSelection()?.removeAllRanges()
  }
})

it('tracked rule reset selects its deletion exterior before the next input', () => {
  const prefix = 'a{>>keep<<}\n\n'
  const suffix = '\n\nb{>>tail<<}\n'
  const app = bootBoundMuya(prefix + '---' + suffix)
  app.track(true)
  try {
    const rule = app.muya.editor.scrollPage?.firstContentInDescendant()?.nextContentInContext()
    if (!rule) throw new Error('Expected selected rule')
    rule.setCursor(0, 0, true)
    rule.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    )
    const dom = app.muya.editor.selection.getDOMSelection()
    if (!dom) throw new Error('Expected exterior selection')
    expect(createMuyaModelSelection(app.muya, app.view()).domPointToModel(dom.anchor)).toBe(
      prefix.length + '{-------}'.length
    )
    expect(createMuyaModelSelection(app.muya, app.view()).domPointToModel(dom.focus)).toBe(
      prefix.length + '{-------}'.length
    )
    const input = app.muya.editor.selection.getSelection()?.anchor.block
    if (!input) throw new Error('Expected live editable selection')
    input.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: prefix + '{-------}{++x++}' + suffix
    })
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
  }
})

it.each([
  ...cases.flatMap((example) =>
    ['\n', '\r\n', '\r'].map((ending) => ({ ...example, ending, tracked: false }))
  ),
  ...trackedCases.map((example) => ({ ...example, ending: '\n', tracked: true }))
])('model owns $name before the next key ($ending, Track=$tracked)', async(example) => {
  const source = 'a{>>keep<<}\n\n---\n\nb{>>tail<<}\n'.replaceAll('\n', example.ending)
  const inserted = ('a{>>keep<<}' + example.inserted + 'b{>>tail<<}\n').replaceAll(
    '\n',
    example.ending
  )
  const typed = ('a{>>keep<<}' + example.typed + 'b{>>tail<<}\n').replaceAll('\n', example.ending)
  const app = bootBoundMuya(source)
  app.track(example.tracked)
  try {
    const rule = app.muya.editor.scrollPage?.firstContentInDescendant()?.nextContentInContext()
    if (!rule || rule.blockName !== 'thematicbreak.content') { throw new Error('Expected model-owned rule') }
    rule.setCursor(example.anchor, example.focus, true)
    const event = new KeyboardEvent('keydown', {
      key: example.key,
      bubbles: true,
      cancelable: true
    })
    rule.domNode.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: inserted })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { offset: example.caret },
      focus: { offset: example.caret }
    })
    const input = app.muya.editor.selection.getSelection()?.anchor.block
    if (!input?.domNode.isConnected) throw new Error('Expected live model-selected input')
    expect(input.text).toBe(example.text)
    input.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { offset: example.caret + 1 },
      focus: { offset: example.caret + 1 }
    })
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: inserted })
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { offset: example.anchor },
      focus: { offset: example.focus }
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
    app.dispose()
  }
})

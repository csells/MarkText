// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each([
  { label: 'id', text: 'same' },
  { label: 'a+b', text: 's{++am++}e{>>keep<<}' }
])('updates references from the common model when editing [$label]', async({ label, text }) => {
  const source = `[${text}][${label}] [same][${label}]\n\n[${label}]: /old\n`
  const changed = `[${text}][${label}] [same][${label}]\n\n[${label}]: /new\n`
  const probe = bootBoundMuya('')
  const labelScan = vi.spyOn(
    Object.getPrototypeOf(probe.muya.editor.inlineRenderer),
    'getLabelInfo'
  )
  probe.dispose()
  const app = bootBoundMuya(source)
  const links = () => [...app.muya.editor.scrollPage!.domNode!.querySelectorAll('a.mu-link')]
  const expectLinks = (href: string) => {
    expect(
      links()
        .map((link) => link.textContent)
        .join('')
    ).toBe('samesame')
    expect(new Set(links().map((link) => link.getAttribute('href')))).toEqual(new Set([href]))
  }
  try {
    const definition = app.muya.editor.scrollPage!.lastContentInDescendant()!
    expect(definition.text).toBe(`[${label}]: /old\n`)
    const start = definition.text.length - 4
    definition.setCursor(start, start + 3, true)
    definition.domNode!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertReplacementText',
        data: 'new',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: changed })
    expectLinks('/new')
    const live = app.muya.editor.selection.getSelection()!.anchor.block
    live.domNode!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    const typed = changed.replace('/new', '/newx')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    expectLinks('/newx')
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
    expect(labelScan.mock.calls.length).toBe(0)
    await app.adapter.history('undo', app.reconcile)
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { offset: start },
      focus: { offset: start + 3 }
    })
    await app.adapter.history('redo', app.reconcile)
    await app.adapter.history('redo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    const reopened = bootBoundMuya(typed)
    try {
      const links = [...reopened.muya.editor.scrollPage!.domNode!.querySelectorAll('a.mu-link')]
      expect(links.map((link) => link.textContent).join('')).toBe('samesame')
      expect(new Set(links.map((link) => link.getAttribute('href')))).toEqual(new Set(['/newx']))
    } finally {
      reopened.dispose()
    }
  } finally {
    labelScan.mockRestore()
    app.dispose()
  }
})

// @vitest-environment jsdom
import { Muya, ParagraphQuickInsertMenu } from '@muyajs/core'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

it.each([
  { kind: 'list', source: '- /hr\n- other\n', inserted: '- ---\n\n  \n- other\n', container: 'li' },
  {
    kind: 'quote',
    source: '> /hr\n\noutside\n',
    inserted: '> ---\n>\n> \n\noutside\n',
    container: 'blockquote'
  }
])('native Quick Horizontal Line retains a following paragraph inside its $kind', (example) => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const host = document.body.appendChild(document.createElement('div'))
  const muya = new Muya(host, { markdown: example.source })
  muya.init()
  const menu = new ParagraphQuickInsertMenu(muya)
  if (menu.container) menu.container.scrollTo = () => {}
  try {
    const block = muya.editor.scrollPage?.firstContentInDescendant()
    if (!block) throw new Error('Expected nested native trigger')
    block.setCursor(3, 3, true)
    muya.eventCenter.emit('content-change', { block })
    const entry = menu.renderArray.find(
      (item: { label: string }) => item.label === 'thematic-break'
    )
    if (!entry) throw new Error('Expected native Horizontal Line entry')
    menu.selectItem(entry)
    muya.flush()
    expect(muya.getMarkdown()).toBe(example.inserted)
    expect(muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
    const selected = muya.editor.selection.getSelection()?.anchor.block
    expect(selected?.blockName).toBe('paragraph.content')
    expect(selected?.text).toBe('')
    expect(selected?.domNode.closest(example.container)).not.toBeNull()
  } finally {
    menu.destroy()
    muya.destroy()
    host.remove()
    document.getSelection()?.removeAllRanges()
  }
})

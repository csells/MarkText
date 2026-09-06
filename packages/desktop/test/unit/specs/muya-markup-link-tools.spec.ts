// @vitest-environment happy-dom
import { Muya } from '@muyajs/core'
import { createDocumentCore } from '@marktext/document-core'
import { expect, it, vi } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'

it.each([
  { raw: '[name](https://example.com)', end: 34, suffix: '' },
  { raw: '[name][ref]', end: 18, suffix: '\n[ref]: https://example.com\n' }
])('offers native tools for $raw inside an addition and preserves its annotation through unlink/undo', async({ raw, end, suffix }) => {
  const source = `prefix {++${raw}++} tail\n${suffix}`
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => {} })
  await binding.open({ documentId: 'native-link.md', source })
  const initial = await binding.plainTextViewAtBarrier()
  if (initial.type !== 'plain-text-view' || !('state' in initial.view)) throw new Error('Expected typed view')
  const host = document.createElement('div')
  document.body.append(host)
  const muya = new Muya(host)
  muya.init()
  const install = (view: typeof initial.view) => {
    muya.setInlinePresentation(createMuyaMarkupPresentationIndex(view).render)
    muya.setContent(structuredClone([...view.state]) as Parameters<Muya['setContent']>[0])
  }
  install(initial.view)
  const reconcile = async() => {
    const next = await binding.plainTextViewAtBarrier()
    if (next.type !== 'plain-text-view' || !('state' in next.view)) throw new Error('Expected typed view')
    if (!adapter.hasPendingEdits()) install(next.view)
    return next.view.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(initial.view.bindings, binding, undefined, reconcile)
  muya.eventCenter.on('json-change', (change: unknown) => adapter.accept(change))
  type LinkInfo = { range: { start: number, end: number }, raw: string, text: string, href: string }
  let tools: { linkInfo: LinkInfo, block: { unlink: (info: LinkInfo) => void } } | undefined
  muya.eventCenter.on('muya-link-tools', (value: typeof tools) => { tools = value })
  try {
    const anchor = muya.domNode.querySelector('a')
    expect(anchor).not.toBeNull()
    anchor?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(tools?.linkInfo).toEqual({
      range: { start: 7, end }, raw, text: 'name', href: 'https://example.com'
    })
    expect(tools?.block).toBeTruthy()
    tools?.block.unlink(tools.linkInfo)
    muya.flush()
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: `prefix {++name++} tail\n${suffix}` })
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    adapter.dispose()
    muya.destroy()
    muya.domNode.remove()
  }
})

it('follows Core angle and bare autolinks with modifier click and offers no unlink action', () => {
  const core = createDocumentCore()
  const revision = core.open('{++<https://example.com> https://example.org++}')
  const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
  const host = document.createElement('div')
  document.body.append(host)
  const muya = new Muya(host)
  muya.init()
  muya.setInlinePresentation(createMuyaMarkupPresentationIndex(view).render)
  muya.setContent(structuredClone([...view.state]) as Parameters<Muya['setContent']>[0])
  const hover = vi.fn()
  const follow = vi.fn()
  muya.eventCenter.on('muya-link-tools', hover)
  muya.eventCenter.on('format-click', follow)
  try {
    const anchors = [...muya.domNode.querySelectorAll('a')]
    expect(anchors).toHaveLength(2)
    for (const anchor of anchors) {
      anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      const plain = new MouseEvent('click', { bubbles: true, cancelable: true })
      anchor.dispatchEvent(plain)
      expect(plain.defaultPrevented).toBe(true)
    }
    expect(hover).not.toHaveBeenCalled()
    expect(follow).not.toHaveBeenCalled()
    for (const anchor of anchors) anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))
    expect(follow.mock.calls.map(([event]) => event.data.href)).toEqual(['https://example.com', 'https://example.org'])
  } finally {
    muya.destroy()
    muya.domNode.remove()
  }
})

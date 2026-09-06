// @vitest-environment happy-dom
import { Muya } from '@muyajs/core'
import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'

it.each([
  { source: '{~~old~>new~~}\n', expected: '# {~~old~>new~~}\n', original: '# old\n', revised: '# new\n', headings: 1 },
  { source: '{~~old~>new~~} tail\n', expected: '# {~~old~>new~~} tail\n', original: '# old tail\n', revised: '# new tail\n', headings: 1 },
  { source: '{--plain--}\n', expected: '{--# plain--}\n', original: '# plain\n', revised: '\n', headings: 1 },
  { source: '{~~plain~># new~~}\n', expected: '{~~# plain~># new~~}\n', original: '# plain\n', revised: '# new\n', headings: 2 },
  { source: '{~~# old~>plain~~}\n', expected: '{~~# old~># plain~~}\n', original: '# old\n', revised: '# plain\n', headings: 2 }
])('formats only the paragraph-owned arm of $source', async(example) => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => {} })
  await binding.open({ documentId: 'native-arm-heading.md', source: example.source })
  const initial = await binding.plainTextViewAtBarrier()
  if (initial.type !== 'plain-text-view' || !('state' in initial.view)) throw new Error('Expected typed view')
  const host = document.createElement('div')
  document.body.append(host)
  const muya = new Muya(host)
  muya.init()
  muya.setContent(structuredClone([...initial.view.state]) as Parameters<Muya['setContent']>[0])
  const reconcile = async() => {
    const next = await binding.plainTextViewAtBarrier()
    if (next.type !== 'plain-text-view' || !('state' in next.view)) throw new Error('Expected typed view')
    if (!adapter.hasPendingEdits()) muya.setContent(structuredClone([...next.view.state]) as Parameters<Muya['setContent']>[0])
    return next.view.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(initial.view.bindings, binding, undefined, reconcile)
  const admissions: string[] = []
  muya.eventCenter.on('json-change', (change: unknown) => { admissions.push(adapter.accept(change)) })
  try {
    const index = initial.view.state.findIndex(block => block.name === 'paragraph')
    const paragraph = muya.editor.scrollPage?.queryBlock([index, 'text'])
    if (paragraph == null || !paragraph.isContent()) throw new Error('Expected paragraph')
    muya.editor.activeContentBlock = paragraph
    paragraph.setCursor(0, 0)
    muya.updateParagraph('heading 1')
    muya.flush()
    expect(admissions).toEqual(['accepted'])
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: example.expected })
    expect(muya.domNode.querySelectorAll('h1')).toHaveLength(example.headings)
    const core = createDocumentCore()
    const revision = core.open(example.expected)
    expect(core.project(revision, 'original').markdown).toBe(example.original)
    expect(core.project(revision, 'revised').markdown).toBe(example.revised)
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: example.source })
  } finally {
    adapter.dispose()
    muya.destroy()
    muya.domNode.remove()
  }
})

it('keeps a queued heading command at its paragraph boundary after an earlier tracked insertion', async() => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => {} })
  await binding.open({ documentId: 'queued-heading.md', source: 'p\n\n{~~old~>new~~}\n' })
  const initial = await binding.plainTextViewAtBarrier()
  if (initial.type !== 'plain-text-view' || !('state' in initial.view)) throw new Error('Expected typed view')
  const host = document.createElement('div')
  document.body.append(host)
  const muya = new Muya(host)
  muya.init()
  muya.setContent(structuredClone([...initial.view.state]) as Parameters<Muya['setContent']>[0])
  const reconcile = async() => {
    const next = await binding.plainTextViewAtBarrier()
    if (next.type !== 'plain-text-view') throw new Error('Expected view')
    return next.view.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(initial.view.bindings, binding, undefined, reconcile)
  const admissions: string[] = []
  let tracking = true
  muya.eventCenter.on('json-change', (change: unknown) => {
    admissions.push(tracking ? adapter.acceptTracked(change, reconcile) : adapter.accept(change))
  })
  try {
    const first = muya.editor.scrollPage?.queryBlock([0, 'text'])
    const second = muya.editor.scrollPage?.queryBlock([1, 'text'])
    if (!first?.isContent() || !second?.isContent()) throw new Error('Expected paragraphs')
    first.domNode.textContent = 'pX'
    first.setCursor(2, 2)
    first.inputHandler(new InputEvent('input', { data: 'X', inputType: 'insertText', bubbles: true }))
    muya.flush()
    tracking = false
    second.setCursor(0, 0)
    muya.updateParagraph('heading 1')
    muya.flush()
    expect(admissions).toEqual(['accepted', 'accepted'])
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'p{++X++}\n\n# {~~old~>new~~}\n' })
  } finally {
    adapter.dispose()
    binding.dispose()
    muya.destroy()
    muya.domNode.remove()
  }
})

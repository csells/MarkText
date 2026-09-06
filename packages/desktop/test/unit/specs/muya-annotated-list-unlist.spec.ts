// @vitest-environment happy-dom
import { Muya } from '@muyajs/core'
import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'

it.each([
  { kind: 'bullet', command: 'ul-bullet', source: '- {++first++}{>>keep<<}\n- second\n', expected: '{++first++}{>>keep<<}\n\nsecond\n' },
  { kind: 'ordered', command: 'ol-order', source: '1. {++first++}{>>keep<<}\n2. second\n', expected: '{++first++}{>>keep<<}\n\nsecond\n' },
  { kind: 'task', command: 'ul-task', source: '- [X] {++first++}{>>keep<<}\n- [ ] second\n', expected: '{++first++}{>>keep<<}\n\nsecond\n' },
  { kind: 'code', command: 'ul-bullet', source: '- {++first++}{>>keep<<}\n\n  ```js\n  const x = 1\n  ```\n- second\n', expected: '{++first++}{>>keep<<}\n\n```js\nconst x = 1\n```\n\nsecond\n' },
  { kind: 'quote', command: 'ul-bullet', source: '- {++first++}{>>keep<<}\n\n  > quoted\n  > continued\n- second\n', expected: '{++first++}{>>keep<<}\n\n> quoted\n> continued\n\nsecond\n' }
].flatMap(example => ['\n', '\r\n', '\r'].flatMap(ending => [false, true].map(tracked => ({ ...example, ending, tracked })))))('removes $kind list formatting with $ending endings (tracked=$tracked) while preserving annotated items', async({ command, source: original, expected, ending, tracked }) => {
  const source = original.replaceAll('\n', ending)
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => actor.dispose() })
  await binding.open({ documentId: 'unlist.md', source })
  const view = async() => {
    const result = await binding.plainTextViewAtBarrier()
    if (result.type !== 'plain-text-view' || !('state' in result.view)) throw new Error('Expected native view')
    return result.view
  }
  const initial = await view()
  const host = document.createElement('div')
  document.body.append(host)
  const muya = new Muya(host)
  muya.init()
  muya.setContent(structuredClone([...initial.state]) as Parameters<Muya['setContent']>[0])
  const reconcile = async() => {
    const next = await view()
    if (!adapter.hasPendingEdits()) muya.setContent(structuredClone([...next.state]) as Parameters<Muya['setContent']>[0])
    return next.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
  const admissions: string[] = []
  muya.eventCenter.on('json-change', (change: unknown) => { admissions.push(tracked ? adapter.acceptTracked(change, reconcile) : adapter.accept(change)) })
  try {
    const first = muya.editor.scrollPage?.firstContentInDescendant()
    if (!first) throw new Error('Expected first item')
    muya.editor.activeContentBlock = first
    first.setCursor(0, 0)
    muya.updateParagraph(command)
    muya.flush()
    expect(admissions).toEqual(['accepted'])
    await adapter.settled()
    const saved = await binding.sourceAtBarrier()
    if (saved.type !== 'source') throw new Error('Expected canonical source')
    if (tracked) {
      const core = createDocumentCore()
      const revision = core.open(saved.source)
      expect(core.project(revision, 'revised').markdown).toBe(expected.replace('{++first++}{>>keep<<}', 'first').replaceAll('\n', ending))
      expect(core.project(revision, 'original').markdown).toBe(source.replace('{++first++}{>>keep<<}', ''))
    } else {
      expect(saved.source).toBe(expected.replaceAll('\n', ending))
      expect(muya.domNode.querySelectorAll('ul li, ol li')).toHaveLength(0)
    }
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    adapter.dispose()
    binding.dispose()
    muya.destroy()
    host.remove()
  }
})

import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'

it.each([
  { before: 'word', after: '', final: 'Y', first: [{ d: 'word' }], second: ['Y'], source: '{--word--}{++Y++}\n' },
  { before: '`word`', after: '`woXrd`', final: '`woXYrd`', first: [3, 'X'], second: [4, 'Y'], source: '{~~`word`~>`woXYrd`~~}\n' },
  { before: 'word', after: 'wXd', final: 'wXYd', first: [1, { d: 'or' }, 'X'], second: [2, 'Y'], source: 'w{~~or~>XY~~}d\n' },
  { before: 'word', after: 'wd', final: 'wYd', first: [1, { d: 'or' }], second: [1, 'Y'], source: 'w{--or--}{++Y++}d\n' }
])('preserves queued tracked input when Markup exposes old content ($source)', async fixture => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => {} })
  await binding.open({ documentId: 'tracked-queue.md', source: fixture.before + '\n' })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view') throw new Error('Expected view')
    return reply.view.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(await view(), binding, undefined, view)
  const paragraph = (text: string) => [{ name: 'paragraph', text }]
  try {
    expect(adapter.acceptTracked({ source: 'user', prevDoc: paragraph(fixture.before), doc: paragraph(fixture.after), op: [0, 'text', { es: fixture.first }] }, view)).toBe('accepted')
    expect(adapter.acceptTracked({ source: 'user', prevDoc: paragraph(fixture.after), doc: paragraph(fixture.final), op: [0, 'text', { es: fixture.second }] }, view)).toBe('accepted')
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: fixture.source })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})

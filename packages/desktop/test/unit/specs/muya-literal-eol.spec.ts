import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import { createMuyaPlainTextSourceEditAdapter } from '@/documentAuthority/muyaPlainTextSourceEdit'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'

for (const ending of ['\r', '\r\n', '\n']) {
  it(
    'creates a body line when typing immediately between empty code fences, ' +
      JSON.stringify(ending),
    async() => {
      const source = '~~~ts' + ending + '~~~' + ending
      const actor = createCoreActor()
      const binding = createEditorCoreBinding({
        request: (request) => actor.handle(request),
        dispose: () => {}
      })
      await binding.open({ documentId: 'empty-code.md', source })
      const initial = await binding.plainTextViewAtBarrier()
      if (initial.type !== 'plain-text-view' || !('state' in initial.view)) { throw new Error('Expected view') }
      const reconcile = () => {
        const next = binding.plainTextViewAtBarrier()
        if (next.type !== 'plain-text-view') throw new Error('Expected view')
        return next.view.bindings
      }
      const adapter = createMuyaPlainTextCoreAdapter(
        initial.view.bindings,
        binding,
        undefined,
        reconcile
      )
      const first = [{ ...initial.view.state[0], text: 'x' }]
      const second = [{ ...initial.view.state[0], text: 'xy' }]
      expect(
        adapter.accept({
          source: 'user',
          prevDoc: initial.view.state,
          doc: first,
          op: [0, 'text', { es: ['x'] }]
        })
      ).toBe('accepted')
      expect(
        adapter.accept({
          source: 'user',
          prevDoc: first,
          doc: second,
          op: [0, 'text', { es: [1, 'y'] }]
        })
      ).toBe('accepted')
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source: '~~~ts' + ending + 'xy' + ending + '~~~' + ending
      })
      await adapter.history('undo', reconcile)
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
      adapter.dispose()
      binding.dispose()
    }
  )

  it.each(['$$', '```'])(
    'inserts into the empty body of %s before its retained newline, ' + JSON.stringify(ending),
    (fence) => {
      const core = createDocumentCore()
      const source = fence + ending + ending + fence + ending
      const revision = core.open(source)
      const view = createMuyaMarkupView(core.project(revision, 'markup'))
      const adapter = createMuyaPlainTextSourceEditAdapter(view.bindings[0])
      const result = adapter.accept({
        source: 'user',
        prevDoc: view.state,
        doc: [{ ...view.state[0], text: 'x^2' }],
        op: [0, 'text', { es: ['x^2'] }]
      })
      if (result.kind !== 'edit') throw new Error('Expected mapped insertion')
      expect(core.apply(revision, [result.edit]).revision.source).toBe(
        fence + ending + 'x^2' + ending + fence + ending
      )
    }
  )

  it(`maps literal ${JSON.stringify(ending)} and retains exact surrounding source while editing its newline`, () => {
    const core = createDocumentCore()
    const source = `\`\`\`${ending}a${ending}b${ending}\`\`\`${ending}`
    const revision = core.open(source)
    const view = createMuyaMarkupView(core.project(revision, 'markup'))
    const apply = (edit: Parameters<typeof core.apply>[1][number]) => {
      const candidate = createDocumentCore()
      return candidate.apply(candidate.open(source), [edit]).revision.source
    }
    expect(view.bindings[0].text).toBe('a\nb')
    for (const [offset, expected] of [
      [1, `a!${ending}b`],
      [2, `a${ending}!b`]
    ] as const) {
      const adapter = createMuyaPlainTextSourceEditAdapter(view.bindings[0])
      const text = 'a\nb'.slice(0, offset) + '!' + 'a\nb'.slice(offset)
      const result = adapter.accept({
        source: 'user',
        prevDoc: view.state,
        doc: [{ ...view.state[0], text }],
        op: [0, 'text', { es: [offset, '!'] }]
      })
      if (result.kind !== 'edit') throw new Error('Expected mapped edit')
      expect(apply(result.edit)).toBe(`\`\`\`${ending}${expected}${ending}\`\`\`${ending}`)
    }
    const adapter = createMuyaPlainTextSourceEditAdapter(view.bindings[0])
    const result = adapter.accept({
      source: 'user',
      prevDoc: view.state,
      doc: [{ ...view.state[0], text: 'ab' }],
      op: [0, 'text', { es: [1, { d: '\n' }] }]
    })
    if (result.kind !== 'edit') throw new Error('Expected mapped deletion')
    expect(apply(result.edit)).toBe(`\`\`\`${ending}ab${ending}\`\`\`${ending}`)
  })

  it(`preserves same-task literal ${JSON.stringify(ending)} edits and exact history through the actor`, async() => {
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => actor.dispose()
    })
    const source = `\`\`\`${ending}a${ending}b${ending}\`\`\`${ending}`
    await binding.open({ documentId: 'literal-eol.md', source })
    const initial = await binding.plainTextViewAtBarrier()
    if (initial.type !== 'plain-text-view' || !('state' in initial.view)) { throw new Error('Expected typed view') }
    const reconcile = () => {
      const next = binding.plainTextViewAtBarrier()
      if (next.type !== 'plain-text-view') throw new Error('Expected typed view')
      return next.view.bindings
    }
    const adapter = createMuyaPlainTextCoreAdapter(
      initial.view.bindings,
      binding,
      undefined,
      reconcile
    )
    const joined = [{ ...initial.view.state[0], text: 'ab' }]
    expect(
      adapter.accept({
        source: 'user',
        prevDoc: initial.view.state,
        doc: joined,
        op: [0, 'text', { es: [1, { d: '\n' }] }]
      })
    ).toBe('accepted')
    expect(
      adapter.accept({
        source: 'user',
        prevDoc: joined,
        doc: [{ ...joined[0], text: 'a!b' }],
        op: [0, 'text', { es: [1, '!'] }]
      })
    ).toBe('accepted')
    expect(binding.sourceAtBarrier()).toMatchObject({
      source: `\`\`\`${ending}a!b${ending}\`\`\`${ending}`
    })
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({
      source: `\`\`\`${ending}ab${ending}\`\`\`${ending}`
    })
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    adapter.dispose()
  })
}

it('maps quoted CR-only literal content without exposing container prefixes', () => {
  const core = createDocumentCore()
  const revision = core.open('> ```\r> a\r> b\r> ```\r')
  const view = createMuyaMarkupView(core.project(revision, 'markup'))
  expect(view.bindings[0].text).toBe('a\nb')
})

it('keeps literal annotation decorations inside normalized text coordinates', () => {
  const core = createDocumentCore()
  const revision = core.open('{++```\r\na\r\nb\r\n```\r\n++}')
  const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
  expect(view.bindings[0].text).toBe('a\nb')
  expect(view.decorations[0].range).toEqual({ start: 0, end: 3 })
})

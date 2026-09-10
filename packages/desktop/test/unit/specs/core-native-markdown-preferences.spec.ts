// @vitest-environment happy-dom
import { Muya } from '@muyajs/core'
import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'

it('reinterprets a hidden native view with footnotes and GitLab math without admitting a source edit', async() => {
  const source =
    'H~2~O and 2^n^; note[^a].\n\n[^a]: Footnote body.\n\n' +
    '```math\nx^2\n```\n\nText.{>>Comment 2^n^.<<}\n'
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({
    request: (request) => actor.handle(request),
    dispose: () => actor.dispose()
  })
  await binding.open({
    documentId: 'preferences.md',
    source,
    options: { footnotes: false, gitLabMath: false, subscriptAndSuperscript: false }
  })
  const view = () => {
    const result = binding.plainTextViewAtBarrier()
    if (result.type !== 'plain-text-view' || !('state' in result.view)) {
      throw new Error('Expected native view')
    }
    return result.view
  }
  const initial = await view()
  const host = document.createElement('div')
  document.body.append(host)
  const muya = new Muya(host, {
    footnote: false,
    superSubScript: false,
    isGitlabCompatibilityEnabled: false
  })
  muya.init()
  const install = (next: typeof initial) => {
    muya.setInlinePresentation(createMuyaMarkupPresentationIndex(next).render)
    muya.flush()
    muya.setContent(structuredClone([...next.state]) as Parameters<Muya['setContent']>[0], false, {
      preserveInputGrouping: true
    })
    muya.setEditablePaths(
      next.bindings.filter((item) => item.editable !== false).map((item) => [...item.path])
    )
  }
  install(initial)
  muya.domNode.style.display = 'none'
  const reconcile = () => {
    const next = view()
    install(next)
    return next.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
  const changes: unknown[] = []
  muya.on('json-change', (change: unknown) => {
    changes.push(change)
    adapter.accept(change)
  })
  try {
    await adapter.configure(
      { footnotes: true, subscriptAndSuperscript: true, gitLabMath: true },
      () => {
        muya.setOptions({
          footnote: true,
          superSubScript: true,
          isGitlabCompatibilityEnabled: true
        })
        return reconcile()
      }
    )
    muya.flush()
    await adapter.settled()
    expect(changes).toEqual([])
    expect(muya.getState().map((item: { name: string }) => item.name)).toEqual([
      'paragraph',
      'footnote',
      'math-block',
      'paragraph'
    ])
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    expect(await binding.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({
      type: 'rejected',
      reason: 'history-empty'
    })
  } finally {
    adapter.dispose()
    binding.dispose()
    muya.destroy()
    muya.domNode.remove()
  }
})

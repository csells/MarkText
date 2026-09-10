// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each([false, true])(
  'toggles an annotated checkbox from checked=%s without rewriting its annotations',
  async(checked) => {
    const source = `- [${checked ? 'X' : ' '}] {++task++}{>>keep<<}\n`
    const app = bootBoundMuya(source)
    const { muya, binding, view, adapter, reconcile } = app
    const initial = view()
    const after = structuredClone(initial.state) as unknown as Array<{
      children: Array<{ meta: { checked: boolean } }>
    }>
    after[0].children[0].meta.checked = !checked
    try {
      ;(muya.domNode as HTMLElement)
        .querySelector<HTMLInputElement>('.mu-task-list-checkbox')!
        .click()
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source: `- [${checked ? ' ' : 'x'}] {++task++}{>>keep<<}\n`
      })
      expect(view().state).toEqual(after)
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      app.dispose()
    }
  }
)

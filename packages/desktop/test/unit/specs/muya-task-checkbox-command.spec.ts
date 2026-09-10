// @vitest-environment jsdom
import { createDocumentCore } from '@marktext/document-core'
import { expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

const fixtures = [
  {
    name: 'check parent and descendants',
    before: [false, false, false],
    after: [true, true, true],
    target: 0
  },
  {
    name: 'uncheck parent and descendants',
    before: [true, true, true],
    after: [false, false, false],
    target: 0
  },
  {
    name: 'complete last child and derive parent',
    before: [false, true, false],
    after: [true, true, true],
    target: 2
  },
  {
    name: 'uncheck child and derive parent',
    before: [true, true, true],
    after: [false, true, false],
    target: 2
  }
] as const

it.each(
  fixtures.flatMap((fixture) =>
    [false, true].flatMap((annotated) =>
      [false, true].map((tracked) => ({ ...fixture, annotated, tracked }))
    )
  )
)(
  'native checkbox $name uses the live owner (annotated=$annotated tracked=$tracked)',
  async({ before, after, target, annotated, tracked }) => {
    const labels = annotated
      ? [
        '{++parent++}{>>parent note<<}',
        'same{>>first child note<<}',
        '{++same++}{>>second child note<<}'
      ]
      : ['parent', 'same', 'same']
    const sourceWith = (flags: readonly boolean[]) =>
      `- [${flags[0] ? 'x' : ' '}] ${labels[0]}\n\n  - [${flags[1] ? 'x' : ' '}] ${labels[1]}\n  - [${flags[2] ? 'x' : ' '}] ${labels[2]}\n`
    const source = sourceWith(before)
    const marker = (index: number) =>
      tracked && before[index] !== after[index]
        ? `{~~${before[index] ? 'x' : ' '}~>${after[index] ? 'x' : ' '}~~}`
        : after[index]
          ? 'x'
          : ' '
    const expected = tracked
      ? `- [${marker(0)}] ${labels[0]}\n\n  - [${marker(1)}] ${labels[1]}\n  - [${marker(2)}] ${labels[2]}\n`
      : sourceWith(after)
    const app = bootBoundMuya(source)
    const { muya, adapter, binding, reconcile, legacyChanges } = app
    muya.setOptions({ autoCheck: true, autoMoveCheckedToEnd: false })
    app.track(tracked)
    const replace = vi.spyOn(muya.editor.jsonState, 'replaceOperation')
    const core = createDocumentCore()
    try {
      const checkboxes = Array.from(
        (muya.domNode as HTMLElement).querySelectorAll<HTMLInputElement>('.mu-task-list-checkbox')
      )
      expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual(before)
      checkboxes[target]!.click()
      expect.soft(binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect.soft(replace).not.toHaveBeenCalled()
      expect(
        Array.from(
          (muya.domNode as HTMLElement).querySelectorAll<HTMLInputElement>(
            '.mu-task-list-checkbox'
          ),
          (checkbox) => checkbox.checked
        )
      ).toEqual(after)
      expect.soft(muya.getState()).toEqual(app.view().state)
      expect(muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      const selected = muya.editor.selection.getSelection()?.anchor.block
      expect(selected?.domNode.isConnected).toBe(true)
      expect(selected?.text).toBe(target === 0 ? 'parent' : 'same')
      // No delivery wait between the click and the next native key.
      app.track(false)
      selected!.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'X',
          bubbles: true,
          cancelable: true
        })
      )
      const targetLabel = labels[target]!
      const at = expected.lastIndexOf(targetLabel) + (annotated ? 3 : 0)
      const typed = expected.slice(0, at) + 'X' + expected.slice(at)
      expect.soft(binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
      muya.flush()
      expect.soft(legacyChanges).toEqual([])
      await adapter.history('undo', reconcile)
      expect.soft(binding.sourceAtBarrier()).toMatchObject({ source: expected })
      await adapter.history('undo', reconcile)
      expect.soft(binding.sourceAtBarrier()).toMatchObject({ source })
      await adapter.history('redo', reconcile)
      expect.soft(binding.sourceAtBarrier()).toMatchObject({ source: expected })
      await adapter.history('redo', reconcile)
      expect.soft(binding.sourceAtBarrier()).toMatchObject({ source: typed })
      const saved = binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Expected exact saved source')
      const reopened = core.open(saved.source)
      const projected = (original: boolean) => {
        const flags = original && tracked ? before : after
        const text = annotated && original ? ['', 'same', ''] : ['parent', 'same', 'same']
        if (!annotated || !original) text[target] = 'X' + text[target]
        return `- [${flags[0] ? 'x' : ' '}] ${text[0]}\n\n  - [${flags[1] ? 'x' : ' '}] ${text[1]}\n  - [${flags[2] ? 'x' : ' '}] ${text[2]}\n`
      }
      expect.soft(core.project(reopened, 'original').markdown).toBe(projected(true))
      expect.soft(core.project(reopened, 'revised').markdown).toBe(projected(false))
    } finally {
      replace.mockRestore()
      app.dispose()
    }
  }
)

it.each([false, true])(
  'moves a checked task with its comment and next key (tracked=%s)',
  async(tracked) => {
    const source = '- [ ] {++same++}{>>first<<}\n- [ ] same{>>second<<}\n- [x] final\n'
    const expected = '- [ ] same{>>second<<}\n- [x] {++same++}{>>first<<}\n- [x] final\n'
    const app = bootBoundMuya(source)
    app.muya.setOptions({ autoCheck: false, autoMoveCheckedToEnd: true })
    app.track(tracked)
    try {
      ;(app.muya.domNode as HTMLElement)
        .querySelector<HTMLInputElement>('.mu-task-list-checkbox')!
        .click()
      const saved = app.binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Expected authoritative source')
      const accepted = tracked
        ? '{~~- [ ] {++same++}{>>first<<}~>- [ ] same{>>second<<}~~}\n{~~- [ ] same{>>second<<}~>- [x] {++same++}{>>first<<}~~}\n- [x] final\n'
        : expected
      expect(saved.source).toBe(accepted)
      expect(
        Array.from(
          (app.muya.domNode as HTMLElement).querySelectorAll<HTMLInputElement>(
            '.mu-task-list-checkbox'
          ),
          (box) => box.checked
        )
      ).toEqual(tracked ? [false, false, false, true, true] : [false, true, true])
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      app.track(false)
      app.muya.editor.selection
        .getSelection()!
        .anchor.block.domNode.dispatchEvent(
          new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: 'X',
            bubbles: true,
            cancelable: true
          })
        )
      const at = accepted.lastIndexOf('{++same++}') + 3
      const typed = accepted.slice(0, at) + 'X' + accepted.slice(at)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: accepted })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      const core = createDocumentCore()
      const reopened = core.open(typed)
      expect(core.project(reopened, 'original').markdown).toBe(
        tracked ? '- [ ] \n- [ ] same\n- [x] final\n' : '- [ ] same\n- [x] \n- [x] final\n'
      )
      expect(core.project(reopened, 'revised').markdown).toBe(
        '- [ ] same\n- [x] Xsame\n- [x] final\n'
      )
    } finally {
      app.dispose()
    }
  }
)

it('does not move tasks across an intervening ordinary list item', () => {
  const source = '- [x] first\n- ordinary\n- [ ] last\n'
  const app = bootBoundMuya(source)
  app.muya.setOptions({ autoCheck: false, autoMoveCheckedToEnd: true })
  try {
    ;(app.muya.domNode as HTMLElement)
      .querySelectorAll<HTMLInputElement>('.mu-task-list-checkbox')[1]!
      .click()
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: '- [x] first\n- ordinary\n- [x] last\n'
    })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
    app.muya.editor.selection
      .getSelection()!
      .anchor.block.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'X',
          bubbles: true,
          cancelable: true
        })
      )
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: '- [x] first\n- ordinary\n- [x] Xlast\n'
    })
  } finally {
    app.dispose()
  }
})

it.each([false, true])(
  'keeps an empty checked task ready for the immediate next key (tracked=%s)',
  async(tracked) => {
    const source = '- [ ] \n'
    const expected = tracked ? '- [{~~ ~>x~~}] \n' : '- [x] \n'
    const app = bootBoundMuya(source)
    app.track(tracked)
    try {
      ;(app.muya.domNode as HTMLElement)
        .querySelector<HTMLInputElement>('.mu-task-list-checkbox')!
        .click()
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect(
        (app.muya.domNode as HTMLElement).querySelector<HTMLInputElement>('.mu-task-list-checkbox')
          ?.checked
      ).toBe(true)
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      app.track(false)
      app.muya.editor.selection
        .getSelection()!
        .anchor.block.domNode.dispatchEvent(
          new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: 'X',
            bubbles: true,
            cancelable: true
          })
        )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected.replace('\n', 'X\n') })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
      await app.adapter.history('undo', app.reconcile)
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      app.dispose()
    }
  }
)

it.each([false, true])(
  'unchecks and moves a nested last task before its sibling while deriving its parent (tracked=%s)',
  async(tracked) => {
    const source =
      '- [x] parent{>>p<<}\n\n  - [x] {++same++}{>>first<<}\n  - [x] same{>>second<<}\n'
    const expected = tracked
      ? '- [{~~x~> ~~}] parent{>>p<<}\n\n  {~~- [x] {++same++}{>>first<<}~>- [ ] same{>>second<<}~~}\n  {~~- [x] same{>>second<<}~>- [x] {++same++}{>>first<<}~~}\n'
      : '- [ ] parent{>>p<<}\n\n  - [ ] same{>>second<<}\n  - [x] {++same++}{>>first<<}\n'
    const app = bootBoundMuya(source)
    app.muya.setOptions({ autoCheck: true, autoMoveCheckedToEnd: true })
    app.track(tracked)
    try {
      ;(app.muya.domNode as HTMLElement)
        .querySelectorAll<HTMLInputElement>('.mu-task-list-checkbox')[2]!
        .click()
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect(
        Array.from(
          (app.muya.domNode as HTMLElement).querySelectorAll<HTMLInputElement>(
            '.mu-task-list-checkbox'
          ),
          (box) => box.checked
        )
      ).toEqual(tracked ? [false, true, false, true, true] : [false, false, true])
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      app.track(false)
      app.muya.editor.selection
        .getSelection()!
        .anchor.block.domNode.dispatchEvent(
          new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: 'X',
            bubbles: true,
            cancelable: true
          })
        )
      const at = expected.indexOf('- [ ] same') + 6
      const typed = expected.slice(0, at) + 'X' + expected.slice(at)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      const core = createDocumentCore()
      const reopened = core.open(typed)
      expect(core.project(reopened, 'original').markdown).toBe(
        tracked
          ? '- [x] parent\n\n  - [x] \n  - [x] same\n'
          : '- [ ] parent\n\n  - [ ] Xsame\n  - [x] \n'
      )
      expect(core.project(reopened, 'revised').markdown).toBe(
        '- [ ] parent\n\n  - [ ] Xsame\n  - [x] same\n'
      )
    } finally {
      app.dispose()
    }
  }
)

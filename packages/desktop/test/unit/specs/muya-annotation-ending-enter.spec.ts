// @vitest-environment jsdom
import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

type BoundMuya = ReturnType<typeof bootBoundMuya>

const dispatchInput = ({ muya }: BoundMuya, inputType: string, data: string | null): void => {
  const target = muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Expected live selection')
  if (inputType === 'insertParagraph') {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    )
  }
  const event = new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  muya.flush()
}

const caret = ({ muya }: BoundMuya) => {
  const selection = muya.getSelection()
  if (selection === null) return undefined
  return {
    path: selection.anchor.block?.path,
    anchor: selection.anchor.offset,
    focus: selection.focus.offset
  }
}

const pressEnterAt = (app: BoundMuya, offset?: number): void => {
  const content = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
  if (content == null || !content.isContent()) throw new Error('Expected content leaf')
  const at = offset ?? content.text.length
  content.setCursor(at, at, true)
  dispatchInput(app, 'insertParagraph', null)
}

// A caret beside hidden CriticMarkup delimiters has one visible position; Enter
// there splits outside the annotation, as upstream Enter does after `**bold**`.
describe('native Enter at a closed annotation ending', () => {
  for (const ending of [
    '{~~old~>new~~}',
    '{++add++}',
    '{--del--}',
    '{==hi==}',
    '{>>note<<}',
    '{==hi==}{>>note<<}',
    '**bold**'
  ]) {
    it(`starts an empty paragraph after ${ending} and keeps typing there`, async() => {
      const source = `word ${ending}\n`
      const app = bootBoundMuya(source)
      try {
        pressEnterAt(app)
        const split = `word ${ending}\n\n\n`
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source: split })
        expect(caret(app)).toEqual({ path: [1, 'text'], anchor: 0, focus: 0 })
        for (const data of '```') dispatchInput(app, 'insertText', data)
        await app.adapter.settled()
        const typed = `word ${ending}\n\n\`\`\`\n`
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
        expect(caret(app)).toEqual({ path: [1, 'text'], anchor: 3, focus: 3 })
        expect(app.legacyChanges).toEqual([])
        await app.adapter.history('undo', app.reconcile)
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source: split })
        await app.adapter.history('undo', app.reconcile)
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
        await app.adapter.history('redo', app.reconcile)
        await app.adapter.history('redo', app.reconcile)
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
        expect(createDocumentCore().open(typed).source).toBe(typed)
      } finally {
        app.dispose()
      }
    })
  }

  it.each([
    { source: 'a {++b++} c\n', offset: 3, expected: 'a {++b++}\n\n c\n', next: ' c' },
    { source: 'a {~~b~>c~~} d\n', offset: 4, expected: 'a {~~b~>c~~}\n\n d\n', next: ' d' }
  ])(
    'splits after the closer at a mid-line edge of $source',
    async({ source, offset, expected, next }) => {
      const app = bootBoundMuya(source)
      try {
        pressEnterAt(app, offset)
        await app.adapter.settled()
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
        expect(caret(app)).toEqual({ path: [1, 'text'], anchor: 0, focus: 0 })
        expect(app.muya.editor.scrollPage?.queryBlock([1, 'text'])?.text).toBe(next)
      } finally {
        app.dispose()
      }
    }
  )

  it.each([
    { ending: '{--del--}', expected: 'word {--del--}{++\n\n++}\n' },
    { ending: '{==hi==}', expected: 'word {==hi==}{++\n\n++}\n' },
    { ending: '{==hi==}{>>note<<}', expected: 'word {==hi==}{>>note<<}{++\n\n++}\n' },
    // Tracked input continues the author's adjacent insertion arm.
    { ending: '{~~old~>new~~}', expected: 'word {~~old~>new\n\n~~}\n' },
    { ending: '{++add++}', expected: 'word {++add\n\n++}\n' }
  ])(
    'tracks Enter after $ending with the caret on the new paragraph',
    async({ ending, expected }) => {
      const source = `word ${ending}\n`
      const app = bootBoundMuya(source)
      app.track(true)
      try {
        pressEnterAt(app)
        await app.adapter.settled()
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
        expect(caret(app)).toEqual({ path: [1, 'text'], anchor: 0, focus: 0 })
        dispatchInput(app, 'insertText', 'x')
        await app.adapter.settled()
        const core = createDocumentCore()
        const revised = core.project(core.open(expected), 'revised').markdown
        const typed = app.binding.sourceAtBarrier()
        if (typed.type !== 'source') throw new Error('Expected source')
        expect(core.project(core.open(typed.source), 'revised').markdown).toBe(
          revised.replace(/\n$/u, 'x\n')
        )
        expect(caret(app)).toEqual({ path: [1, 'text'], anchor: 1, focus: 1 })
      } finally {
        app.dispose()
      }
    }
  )
})

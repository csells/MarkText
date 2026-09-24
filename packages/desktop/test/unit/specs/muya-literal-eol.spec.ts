// @vitest-environment jsdom
import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

type BoundMuya = ReturnType<typeof bootBoundMuya>

const placeCaret = (app: BoundMuya, offset: number): void => {
  const block = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
  if (block == null || !block.isContent()) throw new Error('Expected literal content leaf')
  block.setCursor(offset, offset, true)
}

const input = (app: BoundMuya, inputType: string, data: string | null = null): void => {
  const target = app.muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Expected live selection')
  target.dispatchEvent(
    new InputEvent('beforeinput', { data, inputType, bubbles: true, cancelable: true })
  )
}

const typeText = (app: BoundMuya, text: string): void => {
  for (const character of text) input(app, 'insertText', character)
}

for (const ending of ['\r', '\r\n', '\n']) {
  it(
    'creates a body line when typing immediately between empty code fences, ' +
      JSON.stringify(ending),
    async() => {
      const source = '~~~ts' + ending + '~~~' + ending
      const app = bootBoundMuya(source)
      try {
        placeCaret(app, 0)
        typeText(app, 'xy')
        await app.adapter.settled()
        expect(app.binding.sourceAtBarrier()).toMatchObject({
          source: '~~~ts' + ending + 'xy' + ending + '~~~' + ending
        })
        await app.adapter.history('undo', app.reconcile)
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
        expect(app.legacyChanges).toEqual([])
      } finally {
        app.dispose()
      }
    }
  )

  it.each(['$$', '```'])(
    'inserts into the empty body of %s before its retained newline, ' + JSON.stringify(ending),
    async(fence) => {
      const app = bootBoundMuya(fence + ending + ending + fence + ending)
      try {
        placeCaret(app, 0)
        typeText(app, 'x^2')
        await app.adapter.settled()
        expect(app.binding.sourceAtBarrier()).toMatchObject({
          source: fence + ending + 'x^2' + ending + fence + ending
        })
        expect(app.legacyChanges).toEqual([])
      } finally {
        app.dispose()
      }
    }
  )

  it(`maps literal ${JSON.stringify(ending)} and retains exact surrounding source while editing its newline`, async() => {
    const source = `\`\`\`${ending}a${ending}b${ending}\`\`\`${ending}`
    for (const [offset, expected] of [
      [1, `a!${ending}b`],
      [2, `a${ending}!b`]
    ] as const) {
      const app = bootBoundMuya(source)
      try {
        expect(app.view().bindings[0].text).toBe('a\nb')
        placeCaret(app, offset)
        typeText(app, '!')
        await app.adapter.settled()
        expect(app.binding.sourceAtBarrier()).toMatchObject({
          source: `\`\`\`${ending}${expected}${ending}\`\`\`${ending}`
        })
      } finally {
        app.dispose()
      }
    }
    const app = bootBoundMuya(source)
    try {
      placeCaret(app, 2)
      input(app, 'deleteContentBackward')
      await app.adapter.settled()
      expect(app.binding.sourceAtBarrier()).toMatchObject({
        source: `\`\`\`${ending}ab${ending}\`\`\`${ending}`
      })
      expect(app.legacyChanges).toEqual([])
    } finally {
      app.dispose()
    }
  })

  it(`preserves same-task literal ${JSON.stringify(ending)} edits and exact history through the model`, async() => {
    const source = `\`\`\`${ending}a${ending}b${ending}\`\`\`${ending}`
    const app = bootBoundMuya(source)
    try {
      placeCaret(app, 2)
      input(app, 'deleteContentBackward')
      // The second key runs in the same task, against the first key's model selection.
      typeText(app, '!')
      expect(app.binding.sourceAtBarrier()).toMatchObject({
        source: `\`\`\`${ending}a!b${ending}\`\`\`${ending}`
      })
      await app.adapter.settled()
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({
        source: `\`\`\`${ending}ab${ending}\`\`\`${ending}`
      })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.legacyChanges).toEqual([])
    } finally {
      app.dispose()
    }
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

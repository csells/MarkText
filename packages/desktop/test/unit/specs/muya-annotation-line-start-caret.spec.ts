// @vitest-environment jsdom
import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { createMuyaModelSelection } from '@/documentAuthority/muyaModelSelection'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

type BoundMuya = ReturnType<typeof bootBoundMuya>

const content = (app: BoundMuya, index = 0) => {
  const block = app.muya.editor.scrollPage?.queryBlock([index, 'text'])
  if (block == null || !block.isContent()) {
    const leaf = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (index === 0 && leaf != null) return leaf
    throw new Error('Expected content leaf')
  }
  return block
}

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

const type = async(app: BoundMuya, text: string) => {
  for (const data of text) dispatchInput(app, 'insertText', data)
  await app.adapter.settled()
}

const press = ({ muya }: BoundMuya, key: string) => {
  const target = muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Expected live selection')
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  muya.flush()
}

const source = (app: BoundMuya) => {
  const reply = app.binding.sourceAtBarrier()
  if (reply.type !== 'source') throw new Error('Expected source')
  return reply.source
}

/**
 * A browser Home, Cmd+Left or click at the line start collapses into the first
 * text node, or before a leading non-editable comment marker.
 */
const placeAtFirstText = (app: BoundMuya, index = 0) => {
  const root = content(app, index).domNode!
  if (
    root.firstElementChild?.getAttribute('contenteditable') === 'false' &&
    root.firstChild === root.firstElementChild
  ) {
    app.muya.editor.selection.setDOMSelection({ node: root, offset: 0 }, { node: root, offset: 0 })
    return
  }
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const node = walker.nextNode()
  if (node === null) throw new Error('Expected rendered text')
  app.muya.editor.selection.setDOMSelection({ node, offset: 0 }, { node, offset: 0 })
}

// Upstream MarkText treats CriticMarkup as literal text, so the visible start of
// such a line is before the annotation's opener, as End after a line-final
// annotation is after its closer.
const lines = [
  { source: '{++add++} tail\n', prefix: '' },
  { source: '{--del--} tail\n', prefix: '' },
  { source: '{==hi==} tail\n', prefix: '' },
  { source: '{~~old~>new~~} tail\n', prefix: '' },
  { source: '{>>note<<} tail\n', prefix: '' },
  { source: '{==hi==}{>>note<<} tail\n', prefix: '' },
  { source: '{++{==x==}++} tail\n', prefix: '' },
  { source: '- {++item++} tail\n', prefix: '- ' },
  { source: '1. {~~old~>new~~} tail\n', prefix: '1. ' },
  { source: '> {--quote--} tail\n', prefix: '> ' },
  { source: '> - {==deep==} tail\n', prefix: '> - ' },
  { source: '{++setext++} tail\n===\n', prefix: '' }
]

const typedAtStart = ({ source, prefix }: (typeof lines)[number], typed: string) =>
  prefix + typed + source.slice(prefix.length)

describe('visible line-start caret before a leading annotation', () => {
  it.each(lines)('types ``` before the opener of $source after setCursor(0)', async(line) => {
    const app = bootBoundMuya(line.source)
    try {
      content(app).setCursor(0, 0, true)
      await type(app, '```')
      expect(source(app)).toBe(typedAtStart(line, '```'))
    } finally {
      app.dispose()
    }
  })

  it.each(lines)('types x before the opener of $source after Home or a click', async(line) => {
    const app = bootBoundMuya(line.source)
    try {
      placeAtFirstText(app)
      await type(app, 'x')
      expect(source(app)).toBe(typedAtStart(line, 'x'))
      await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe(line.source)
    } finally {
      app.dispose()
    }
  })

  it.each(lines)(
    'types x before the opener of $source after ArrowRight from the previous line',
    async(line) => {
      const app = bootBoundMuya(`first\n\n${line.source}`)
      try {
        const first = content(app)
        first.setCursor(first.text.length, first.text.length, true)
        press(app, 'ArrowRight')
        await type(app, 'x')
        expect(source(app)).toBe(`first\n\n${typedAtStart(line, 'x')}`)
      } finally {
        app.dispose()
      }
    }
  )

  it.each([
    { source: 'lead {++add++} tail\n', offset: 5, expected: 'lead \n\nx{++add++} tail\n' },
    { source: 'lead {~~old~>new~~} tail\n', offset: 5, expected: 'lead \n\nx{~~old~>new~~} tail\n' }
  ])(
    'keeps the caret before the opener after Enter at $offset of $source',
    async({ source: initial, offset, expected }) => {
      const app = bootBoundMuya(initial)
      try {
        content(app).setCursor(offset, offset, true)
        dispatchInput(app, 'insertParagraph', null)
        await app.adapter.settled()
        await type(app, 'x')
        expect(source(app)).toBe(expected)
      } finally {
        app.dispose()
      }
    }
  )

  it.each([
    { source: '{++add++} tail\n', expected: '{++xadd++} tail\n' },
    { source: '{~~old~>new~~} tail\n', expected: '{~~xold~>new~~} tail\n' },
    { source: '- {==item==} tail\n', expected: '- {==xitem==} tail\n' },
    { source: '{++{==x==}++} tail\n', expected: '{++{==xx==}++} tail\n' }
  ])(
    'enters $source with one ArrowRight from the line start',
    async({ source: initial, expected }) => {
      const app = bootBoundMuya(initial)
      try {
        content(app).setCursor(0, 0, true)
        press(app, 'ArrowRight')
        await type(app, 'x')
        expect(source(app)).toBe(expected)
        const core = createDocumentCore()
        expect(core.open(expected).annotations[0]?.range.start).toBe(
          core.open(initial).annotations[0]?.range.start
        )
      } finally {
        app.dispose()
      }
    }
  )

  it('leaves the annotation again with ArrowLeft at its line start', async() => {
    const app = bootBoundMuya('{++add++} tail\n')
    try {
      content(app).setCursor(0, 0, true)
      press(app, 'ArrowRight')
      press(app, 'ArrowLeft')
      await type(app, 'x')
      expect(source(app)).toBe('x{++add++} tail\n')
    } finally {
      app.dispose()
    }
  })

  it('restores an interior line-start caret the model returns', async() => {
    const app = bootBoundMuya('{++xadd++} tail\n')
    try {
      content(app).setCursor(1, 1, true)
      dispatchInput(app, 'deleteContentBackward', null)
      await app.adapter.settled()
      expect(source(app)).toBe('{++add++} tail\n')
      await type(app, 'y')
      expect(source(app)).toBe('{++yadd++} tail\n')
    } finally {
      app.dispose()
    }
  })
})

// Upstream sees the closer's `}` before the caret; the model's exterior caret
// after a line-final annotation pairs from it in the same way.
describe('bound typing after a closing annotation delimiter', () => {
  it.each([
    { annotation: '{++x++}', typed: '*', inserted: '**', caret: 1 },
    { annotation: '{--x--}', typed: '_', inserted: '__', caret: 1 },
    { annotation: '{==x==}', typed: '$', inserted: '$$', caret: 1 },
    { annotation: '{~~o~>n~~}', typed: '~~~', inserted: '~~~~~~', caret: 3 },
    { annotation: '{>>c<<}', typed: "'", inserted: "''", caret: 1 }
  ])(
    'types $typed after $annotation as upstream',
    async({ annotation, typed, inserted, caret }) => {
      const initial = `word ${annotation}\n`
      const app = bootBoundMuya(initial)
      try {
        const point = createMuyaModelSelection(app.muya, app.view()).modelPointToDOM(
          initial.length - 1
        )
        if (point === undefined) throw new Error('Expected the exterior caret')
        app.muya.editor.selection.setDOMSelection(point, point)
        await type(app, typed)
        expect(source(app)).toBe(`word ${annotation}${inserted}\n`)
        await type(app, 'z')
        const next = `word ${annotation}${inserted.slice(0, caret)}z${inserted.slice(caret)}\n`
        expect(source(app)).toBe(next)
      } finally {
        app.dispose()
      }
    }
  )
})

// Bytes recorded from upstream MarkText for the same keys in plain paragraphs.
describe('bound Markdown typing that the parser recognizes early', () => {
  it.each([
    { source: '\n', typed: '~~~', expected: '~~~~~~\n' },
    { source: 'plain tail\n', typed: '~~~', expected: '~~~~~~plain tail\n' },
    { source: 'plain tail\n', typed: '> ', expected: '>  plain tail\n' },
    { source: '{++add++} tail\n', typed: '> ', expected: '>  {++add++} tail\n' }
  ])(
    'types $typed at the start of $source as upstream',
    async({ source: initial, typed, expected }) => {
      const app = bootBoundMuya(initial)
      try {
        content(app).setCursor(0, 0, true)
        await type(app, typed)
        expect(source(app)).toBe(expected)
        await app.adapter.history('undo', app.reconcile)
        expect(createDocumentCore().open(source(app)).source).toBe(source(app))
      } finally {
        app.dispose()
      }
    }
  )
})

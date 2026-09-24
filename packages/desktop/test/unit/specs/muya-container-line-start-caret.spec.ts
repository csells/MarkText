// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

type BoundMuya = ReturnType<typeof bootBoundMuya>

const content = (app: BoundMuya) => {
  const block = app.muya.editor.scrollPage?.firstContentInDescendant()
  if (block == null || !block.isContent()) throw new Error('Expected content leaf')
  return block
}

const dispatchInput = ({ muya }: BoundMuya, inputType: string, data: string | null): void => {
  const target = muya.editor.selection.getSelection()?.anchor.block.domNode
  if (!target?.isConnected) throw new Error('Expected live selection')
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

const lineStart = (app: BoundMuya) => content(app).text.indexOf('\n') + 1

const source = (app: BoundMuya) => {
  const reply = app.binding.sourceAtBarrier()
  if (reply.type !== 'source') throw new Error('Expected source')
  return reply.source
}

/**
 * A click, Home or Cmd+Left at a later line's visible start puts the browser
 * caret in the first rendered text of that line, or before its leading
 * non-editable comment marker.
 */
const placeAtLineStart = (app: BoundMuya, offset: number) => {
  const root = content(app).domNode!
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const start = app.muya.editor.selection.getTextPoint({ node, offset: 0 })
    if (start == null) continue
    const length = node.textContent?.length ?? 0
    if (start.offset + length < offset) continue
    // The line's first text node, rather than the end of the line break before it.
    if (start.offset + length === offset && node.textContent?.endsWith('\n') === true) continue
    const local = offset - start.offset
    const marker = node.previousSibling
    // Before a leading comment marker, as on a paragraph's first line.
    const point =
      local === 0 &&
      marker instanceof HTMLElement &&
      marker.getAttribute('contenteditable') === 'false'
        ? {
          node: node.parentNode!,
          offset: Array.prototype.indexOf.call(node.parentNode!.childNodes, marker)
        }
        : { node, offset: local }
    app.muya.editor.selection.setDOMSelection(point, point)
    return
  }
  throw new Error('Expected rendered text at the line start')
}

// Upstream (8d6c198c) bytes for `x` typed at the start of the second line.
const lines = [
  { source: '> first\n> second\n', expected: '> first\n> xsecond\n' },
  { source: '- first\n  second\n', expected: '- first\n  xsecond\n' },
  { source: '1. first\n   second\n', expected: '1. first\n   xsecond\n' },
  { source: '> - first\n>   second\n', expected: '> - first\n>   xsecond\n' },
  { source: '> > first\n> > second\n', expected: '> > first\n> > xsecond\n' },
  { source: '- > first\n  > second\n', expected: '- > first\n  > xsecond\n' },
  { source: '> first\r\n> second\r\n', expected: '> first\r\n> xsecond\r\n' },
  { source: '- first\r\n  second\r\n', expected: '- first\r\n  xsecond\r\n' },
  { source: '> first  \n> second\n', expected: '> first  \n> xsecond\n' },
  // Upstream sees the annotation as literal text, so the line's visible start
  // is before its leading opener.
  { source: '> first\n> {++second++}\n', expected: '> first\n> x{++second++}\n' },
  { source: '- first\n  {--second--} tail\n', expected: '- first\n  x{--second--} tail\n' },
  { source: '> first\n> {>>note<<}second\n', expected: '> first\n> x{>>note<<}second\n' },
  // An annotation continued from the previous line has its opener there.
  { source: '> {++first\n> second++}\n', expected: '> {++first\n> xsecond++}\n' }
]

describe('caret at a later line start inside a container', () => {
  it.each(lines)(
    'types x after setCursor at the start of line two of $source',
    async({ source: initial, expected }) => {
      const app = bootBoundMuya(initial)
      try {
        const line = lineStart(app)
        content(app).setCursor(line, line, true)
        await type(app, 'x')
        expect(source(app)).toBe(expected)
        await app.adapter.history('undo', app.reconcile)
        expect(source(app)).toBe(initial)
      } finally {
        app.dispose()
      }
    }
  )

  it.each(lines)(
    'types x after a click or Home at the start of line two of $source',
    async({ source: initial, expected }) => {
      const app = bootBoundMuya(initial)
      try {
        placeAtLineStart(app, lineStart(app))
        await type(app, 'x')
        expect(source(app)).toBe(expected)
      } finally {
        app.dispose()
      }
    }
  )

  it.each([
    { source: '> first\n> second\n', expected: '> first\n>\n> > second\n' },
    { source: '- first\n  second\n', expected: '- first\n\n  > second\n' },
    { source: '> first\r\n> second\r\n', expected: '> first\r\n>\r\n> > second\r\n' }
  ])(
    'converts the line with > typed at the start of line two of $source as upstream',
    async({ source: initial, expected }) => {
      const app = bootBoundMuya(initial)
      try {
        const line = lineStart(app)
        content(app).setCursor(line, line, true)
        await type(app, '>')
        expect(source(app)).toBe(expected)
      } finally {
        app.dispose()
      }
    }
  )

  // Upstream writes the container's continuation prefix for a soft line break.
  it.each([
    { source: '> first\n', expected: '> fi\n> xrst\n' },
    { source: '- first\n', expected: '- fi\n  xrst\n' },
    { source: '1. first\n', expected: '1. fi\n   xrst\n' },
    { source: '> - first\n', expected: '> - fi\n>   xrst\n' },
    { source: '> first\r\n', expected: '> fi\r\n> xrst\r\n' }
  ])('types x after Shift+Enter within $source', async({ source: initial, expected }) => {
    const app = bootBoundMuya(initial)
    try {
      content(app).setCursor(2, 2, true)
      dispatchInput(app, 'insertLineBreak', null)
      await app.adapter.settled()
      await type(app, 'x')
      expect(source(app)).toBe(expected)
    } finally {
      app.dispose()
    }
  })

  it.each([
    { source: '> first\n> {++second++}\n', expected: '> first\n> {++xsecond++}\n' },
    { source: '- first\n  {~~old~>new~~}\n', expected: '- first\n  {~~xold~>new~~}\n' }
  ])(
    'enters the leading annotation of line two of $source with one ArrowRight',
    async({ source: initial, expected }) => {
      const app = bootBoundMuya(initial)
      try {
        const line = lineStart(app)
        content(app).setCursor(line, line, true)
        press(app, 'ArrowRight')
        await type(app, 'x')
        expect(source(app)).toBe(expected)
      } finally {
        app.dispose()
      }
    }
  )

  it('leaves the leading annotation of line two again with ArrowLeft', async() => {
    const app = bootBoundMuya('> first\n> {++second++}\n')
    try {
      const line = lineStart(app)
      content(app).setCursor(line, line, true)
      press(app, 'ArrowRight')
      press(app, 'ArrowLeft')
      await type(app, 'x')
      expect(source(app)).toBe('> first\n> x{++second++}\n')
    } finally {
      app.dispose()
    }
  })
})

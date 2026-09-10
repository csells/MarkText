import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { createMuyaMarkupView, mappedMuyaSourceRange } from '@/documentAuthority/muyaMarkupView'

it('renders partially consumed tab indentation from the literal model and preserves its exact source edges', () => {
  const source = '  ```\n\tbody\n  ```\n'
  const core = createDocumentCore()
  const revision = core.open(source)
  const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations, source)
  expect(view.state).toEqual([
    { name: 'code-block', meta: { type: 'fenced', lang: '' }, text: '  body' }
  ])
  const binding = view.bindings[0]
  expect(binding.segments).toEqual([
    { text: { start: 0, end: 2 }, source: { start: 6, end: 7 }, syntax: { start: 6, end: 7 } },
    { text: { start: 2, end: 6 }, source: { start: 7, end: 11 }, syntax: { start: 7, end: 11 } }
  ])
  expect(mappedMuyaSourceRange(binding, { start: 0, end: 0 })).toEqual({ start: 6, end: 6 })
  expect(mappedMuyaSourceRange(binding, { start: 2, end: 2 })).toEqual({ start: 7, end: 7 })
  // A source tab has no interior UTF-16 position. Do not invent one for the
  // second visual space; shared editing needs an explicit semantic target.
  expect(mappedMuyaSourceRange(binding, { start: 1, end: 1 })).toBeUndefined()
  expect(revision.source).toBe(source)
})

for (const eol of ['\n', '\r\n', '\r']) {
  const body = '&amp; \\* {++literal++}'
  for (const [name, source] of [
    ['fenced', ['```js', body, 'next', '```', ''].join(eol)],
    ['indented', [`    ${body}`, '    next', ''].join(eol)],
    ['quoted fence', ['> ```js', `> ${body}`, '> next', '> ```', ''].join(eol)],
    ['added fence', ['{++```js', body, 'next', '```++}', ''].join(eol)]
  ]) {
    it(`maps literal payload and line endings for ${name} with ${JSON.stringify(eol)}`, () => {
      const core = createDocumentCore()
      const revision = core.open(source)
      const view = createMuyaMarkupView(
        core.project(revision, 'markup'),
        revision.annotations,
        source
      )
      const binding = view.bindings.find((item) => item.syntax.kind === 'code-block')!
      expect(binding.text).toBe(`${body}\nnext`)
      const at = source.indexOf(body)
      expect(mappedMuyaSourceRange(binding, { start: 0, end: body.length })).toEqual({
        start: at,
        end: at + body.length
      })
      expect(mappedMuyaSourceRange(binding, { start: body.length, end: body.length + 1 })).toEqual({
        start: at + body.length,
        end: at + body.length + eol.length
      })
      if (name === 'added fence') {
        expect(
          view.decorations.some(
            (decoration) =>
              decoration.mark.kind === 'addition' &&
              decoration.range.start === 0 &&
              decoration.range.end === binding.text.length
          )
        ).toBe(true)
      }
      expect(revision.source).toBe(source)
    })
  }

  it(`keeps the empty fenced-body insertion point with ${JSON.stringify(eol)}`, () => {
    const source = ['```', '```', ''].join(eol)
    const core = createDocumentCore()
    const revision = core.open(source)
    const view = createMuyaMarkupView(
      core.project(revision, 'markup'),
      revision.annotations,
      source
    )
    const binding = view.bindings[0]
    expect(binding.text).toBe('')
    expect(binding.emptyLiteralLineEnding).toBe(eol)
    expect(mappedMuyaSourceRange(binding, { start: 0, end: 0 })).toEqual({
      start: 3 + eol.length,
      end: 3 + eol.length
    })
  })
}

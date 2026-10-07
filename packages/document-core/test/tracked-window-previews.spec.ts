import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentSourceEdit } from '../src/index.js'
import { planFromDocumentParse } from '../src/internal/documentCoreInspection.js'

// Tracked keys whose window compile reads fewer candidates: a window whose
// fence the key is typed in leaves no block of context grows before
// compiling in it, a window core previews candidates by parsing its few
// blocks whole, a key in a literal block or in struck text skips the planners
// that cannot spell it there, and one candidate text is parsed once. Each key
// must plan as the document-parse compile plans it (sweep keys 13/7, 18/9 and
// 24/15).

const lines = (opener: string, body: readonly string[], closer: string): string => [opener, ...body, closer].join('\n')
const values = (count: number): string[] => Array.from({ length: count }, (_, index) => `const value${index} = ${index}`)
const terms = Array.from({ length: 5 }, (_, index) => `x_{${index}} + y`)
const math = lines('$$', terms, '$$')
const shortSubstitution = `{~~${lines('```js', values(2), '```')}\n~>${lines('```js', ['const value0 = 0', 'const {--d--}value1 = 1'], '```')}\n~~}`

const plannedAsTheDocument = (source: string, edit: DocumentSourceEdit): void => {
  const core = createDocumentCore()
  const planned = core.trackedEdit(core.open(source), edit)
  const control = createDocumentCore()
  planFromDocumentParse(control)
  expect(planned).toEqual(control.trackedEdit(control.open(source), edit))
  expect(planned).toBeDefined()
}

describe('tracked keys a window compile reads with fewer previews', () => {
  it('grows a window whose fence the key is typed in leaves no context after it', () => {
    const proposed = values(8).map(line => line === 'const value6 = 6' ? 'const value6 \n\n= 6' : line)
    const source = `\n\n${lines('```js', values(8), '```')}\n\n` +
      `{~~${lines('```js', values(8), '```')}\n~>${lines('```js', proposed, '```')}\n~~}\n` +
      Array.from({ length: 6 }, (_, index) => `    indented ${index}`).join('\n')
    const at = source.indexOf('const value6 = 6') + 'const value6 '.length
    plannedAsTheDocument(source, { start: at, end: at, insert: 'x' })
  })

  it('previews a space typed in a math block in its window whole', () => {
    const source = `\n\n${math}\n\n${shortSubstitution}\n\n{=={--gone--}==}{>>only deleted<<} tail.\n{++\n\n++}\n${shortSubstitution}`
    const at = source.indexOf('x_{1} ') + 'x_{1}'.length
    plannedAsTheDocument(source, { start: at, end: at, insert: ' ' })
  })

  it('splits struck math a paragraph break is typed in', () => {
    const source = `{~~${math}~>${math.replace('x_{4} + y', 'x_{4} + {--d--}y')}~~}\n`
    const at = source.indexOf('x_{3} ') + 'x_{3} '.length
    plannedAsTheDocument(source, { start: at, end: at, insert: '\n\n' })
  })

  it('splits deleted text a line break is typed in', () => {
    const source = 'Text {--gone words here--} after.\n\nMore {++x++}.\n'
    const at = source.indexOf('words')
    plannedAsTheDocument(source, { start: at, end: at, insert: '\n' })
  })

  it('suggests the whole fence words are typed in', () => {
    const source = `Intro.\n\n${lines('```js', values(8), '```')}\n\nTail {++t++}.\n`
    const at = source.indexOf('value3') + 'value3'.length
    plannedAsTheDocument(source, { start: at, end: at, insert: 'word' })
  })
})

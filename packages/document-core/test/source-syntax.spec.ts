import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

describe('canonical source syntax presentation', () => {
  it('uses the same Markdown and CriticMarkup ownership for source spans including isolated comments', () => {
    const core = createDocumentCore()
    const source = '{++**new**++} {--old--}\r\n{>>*note* $x_y$<<}\r\n'
    const revision = core.open(source)
    const spans = core.sourceSyntax(revision)
    const spellings = (kind: string) => spans.filter(span => span.kind === kind).map(span => source.slice(span.range.start, span.range.end))
    expect(spellings('addition')).toEqual(['{++**new**++}'])
    expect(spellings('strong')).toEqual(['**new**'])
    expect(spellings('deletion')).toEqual(['{--old--}'])
    expect(spellings('comment')).toEqual(['{>>*note* $x_y$<<}'])
    expect(spellings('emphasis')).toEqual(['*note*'])
    expect(spellings('inline-math')).toEqual(['$x_y$'])
  })

  it('does not recognize annotation or formatting spellings inside owned literal boundaries', () => {
    const core = createDocumentCore()
    const source = '`{++**code**++}`\n\n```js\n{--_literal_--}\n```\n\n$x_y$\n'
    const spans = core.sourceSyntax(core.open(source))
    expect(spans.filter(span => ['addition', 'deletion', 'strong', 'emphasis'].includes(span.kind))).toEqual([])
    expect(spans.filter(span => span.kind === 'inline-code').map(span => source.slice(span.range.start, span.range.end))).toEqual(['`{++**code**++}`'])
    expect(spans.some(span => span.kind === 'code-block')).toBe(true)
    expect(spans.filter(span => span.kind === 'inline-math').map(span => source.slice(span.range.start, span.range.end))).toEqual(['$x_y$'])
  })

  it('maps split Markdown syntax to disjoint exact source runs and never paints a hidden comment as outer emphasis', () => {
    const core = createDocumentCore()
    const source = '**a{>>note<<}b**'
    const spans = core.sourceSyntax(core.open(source))
    expect(spans.filter(span => span.kind === 'strong').map(span => source.slice(span.range.start, span.range.end))).toEqual(['**a', 'b**'])
    expect(spans.filter(span => span.kind === 'comment').map(span => source.slice(span.range.start, span.range.end))).toEqual(['{>>note<<}'])
  })

  it('retains syntax in both suggestion arms inside an isolated comment body', () => {
    const core = createDocumentCore()
    const source = '{>>{--**old**--}{++*new*++}<<}'
    const spans = core.sourceSyntax(core.open(source))
    expect(spans.filter(span => span.kind === 'strong').map(span => source.slice(span.range.start, span.range.end))).toEqual(['**old**'])
    expect(spans.filter(span => span.kind === 'emphasis').map(span => source.slice(span.range.start, span.range.end))).toEqual(['*new*'])
  })

  it('exposes exact canonical literal body boundaries for existing embedded-language highlighters', () => {
    const core = createDocumentCore()
    const source = '$x_y$\r\n\r\n```javascript\r\nconst x = 1;\r\n```\r\n'
    const literals = core.sourceSyntax(core.open(source)).flatMap(span => span.literal === undefined ? [] : [span.literal])
    expect(literals.map(literal => ({ language: literal.language, text: source.slice(literal.range.start, literal.range.end) }))).toEqual([
      { language: 'stex', text: 'x_y' },
      { language: 'javascript', text: 'const x = 1;\r\n' }
    ])
  })

  it('marks inline math spelled with a display opener and keeps each form\'s formula boundaries', () => {
    const core = createDocumentCore()
    const source = 'a $x_1$ b $$y_2$$ c \\(p_3\\) d \\[q_4\\] e \\\\(r_5\\\\) f \\\\[s_6\\\\] g $`t_7`$\n'
    const spans = core.sourceSyntax(core.open(source, {
      texMathGfm: true,
      texMathSingleBackslash: true,
      texMathDoubleBackslash: true
    })).filter(span => span.kind === 'inline-math')
    expect(spans.map(span => ({
      text: source.slice(span.range.start, span.range.end),
      formula: span.literal === undefined ? undefined : source.slice(span.literal.range.start, span.literal.range.end),
      display: span.displayMath === true
    }))).toEqual([
      { text: '$x_1$', formula: 'x_1', display: false },
      { text: '$$y_2$$', formula: 'y_2', display: true },
      { text: '\\(p_3\\)', formula: 'p_3', display: false },
      { text: '\\[q_4\\]', formula: 'q_4', display: true },
      { text: '\\\\(r_5\\\\)', formula: 'r_5', display: false },
      { text: '\\\\[s_6\\\\]', formula: 's_6', display: true },
      { text: '$`t_7`$', formula: 't_7', display: false }
    ])
  })

  it('binds spans to the requested revision and rejects foreign revisions', () => {
    const core = createDocumentCore()
    const before = core.open('**old**')
    const after = core.apply(before, [{ start: 0, end: 7, insert: '*new*' }]).revision
    expect(core.sourceSyntax(before).some(span => span.kind === 'strong')).toBe(true)
    expect(core.sourceSyntax(after).some(span => span.kind === 'strong')).toBe(false)
    expect(core.sourceSyntax(after).some(span => span.kind === 'emphasis')).toBe(true)
    expect(() => core.sourceSyntax(createDocumentCore().open('foreign'))).toThrow('another core')
  })
})

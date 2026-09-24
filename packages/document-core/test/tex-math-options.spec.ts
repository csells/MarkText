import { describe, expect, it } from 'vitest'
import { createDocumentCore, type MarkdownOptions } from '../src/index.js'

// Upstream's editor rules for pandoc's math extensions (#5446): the corpus
// mirrors packages/muya's texMathGfm / texMathSingleBackslash specs.
const spans = (source: string, options: Partial<MarkdownOptions> = {}) => {
  const core = createDocumentCore()
  const text = `${source}\n`
  const markup = core.project(core.open(text, options), 'markup')
  const found: string[] = []
  const visit = (node: { kind: string; range: { start: number; end: number }; children: readonly unknown[] }): void => {
    if (node.kind === 'inline-math') {
      found.push(text.slice(
        markup.syntax.coordinates.toSource(node.range.start, 'next'),
        markup.syntax.coordinates.toSource(node.range.end, 'previous')
      ))
    }
    for (const child of node.children) visit(child as typeof node)
  }
  visit(markup.syntax.ast.root)
  return found
}

describe('pandoc math extensions', () => {
  it('reads GitHub inline math only with texMathGfm', () => {
    expect(spans('a $`e=mc^2`$ b', { texMathGfm: true })).toEqual(['$`e=mc^2`$'])
    expect(spans('a $`e=mc^2`$ b')).toEqual(['$`e=mc^2`$'])
    expect(spans('a $`x` b', { texMathGfm: true })).toEqual([])
  })

  it('reads single-backslash delimiters only when enabled', () => {
    expect(spans('a \\(x+y\\) b \\[z\\]', { texMathSingleBackslash: true })).toEqual(['\\(x+y\\)', '\\[z\\]'])
    expect(spans('a \\(x+y\\) b')).toEqual([])
    expect(spans('\\(a\\\\b\\)', { texMathSingleBackslash: true })).toEqual(['\\(a\\\\b\\)'])
    expect(spans('\\\\(x\\\\)', { texMathSingleBackslash: true })).toEqual([])
  })

  it('reads double-backslash delimiters only when enabled', () => {
    expect(spans('a \\\\(x\\\\) b', { texMathDoubleBackslash: true })).toEqual(['\\\\(x\\\\)'])
    expect(spans('\\\\(a\\\\)b\\\\)', { texMathDoubleBackslash: true })).toEqual(['\\\\(a\\\\)'])
    expect(spans('a \\\\(x\\\\) b')).toEqual([])
  })

  it('stops reading dollar math when texMathDollars is off', () => {
    expect(spans('a $x$ b $$y$$', { texMathDollars: false })).toEqual([])
    expect(spans('a $x$ b $$y$$')).toEqual(['$x$', '$$y$$'])
  })
})

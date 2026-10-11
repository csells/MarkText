import { describe, expect, it } from 'vitest'

import { createDocumentCore, type MarkdownAstNode } from '../src/index.js'

// A view highlights a construct's syntax by the ranges Core records for its
// parts, so it never re-reads the source to find them.

const nodesOf = (node: MarkdownAstNode, kinds: readonly string[]): MarkdownAstNode[] => [
  ...(kinds.includes(node.kind) ? [node] : []),
  ...node.children.flatMap((child) => nodesOf(child, kinds))
]

const parse = (source: string, kinds: readonly string[]): MarkdownAstNode[] => {
  const core = createDocumentCore()
  return nodesOf(core.project(core.open(source), 'revised').ast.root, kinds)
}

const spell = (source: string, start: unknown, end: unknown): string => source.slice(Number(start), Number(end))

describe('syntax part ranges', () => {
  it('records a one-line reference definition and where its text ends', () => {
    const source = '[A  b\\\\]: <https://example.com> "T"  \n'
    const attributes = parse(source, ['definition'])[0]?.attributes ?? {}
    expect(attributes['oneLineForm']).toBe(true)
    expect(spell(source, attributes['labelStart'], attributes['labelTextEnd'])).toBe('A  b')
    expect(spell(source, attributes['labelTextEnd'], attributes['labelEnd'])).toBe('\\\\')
    expect(spell(source, attributes['destinationSyntaxStart'], attributes['destinationSyntaxEnd'])).toBe('<https://example.com>')
    expect(spell(source, attributes['titleStart'], attributes['titleEnd'])).toBe('T')
    expect(spell(source, attributes['trailingSpaceStart'], source.length - 1)).toBe('  ')
  })

  it('leaves a definition spread over lines or holding a parenthesized title outside the one-line form', () => {
    for (const source of ['[a]:\n/u\n', '[a]: /u (t)\n', '[a]: /u\n"t"\n', '[a\\]: /u\n']) {
      const definitions = parse(source, ['definition'])
      for (const definition of definitions) expect(definition.attributes['oneLineForm'], source).toBeUndefined()
    }
  })

  it('records the target between an inline link\'s parentheses and an autolink\'s address', () => {
    const source = '[](<a b> "t") ![x](/p.png) <https://h.test/x>\n'
    const [link, image, autolink] = parse(source, ['link', 'image', 'autolink']).map((node) => node.attributes)
    expect(spell(source, link?.['targetStart'], link?.['targetEnd'])).toBe('<a b> "t"')
    expect(spell(source, image?.['targetStart'], image?.['targetEnd'])).toBe('/p.png')
    expect(spell(source, autolink?.['addressStart'], autolink?.['addressEnd'])).toBe('https://h.test/x')
  })

  it('records a full reference link\'s label after its text', () => {
    const source = '[text][Ref] [c][] [s]\n\n[ref]: /u\n[c]: /c\n[s]: /s\n'
    const [full, collapsed, shortcut] = parse(source, ['link']).map((node) => node.attributes)
    expect(spell(source, full?.['referenceLabelStart'], full?.['referenceLabelEnd'])).toBe('Ref')
    expect(spell(source, full?.['labelEnd'], full?.['referenceLabelStart'])).toBe('][')
    expect(collapsed?.['referenceLabelStart']).toBeUndefined()
    expect(shortcut?.['referenceLabelStart']).toBeUndefined()
  })
})

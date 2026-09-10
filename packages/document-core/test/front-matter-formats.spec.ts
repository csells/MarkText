import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

const formats = [
  { open: '---', close: '---', lang: 'yaml', style: '-' },
  { open: '---', close: '...', lang: 'yaml', style: '-' },
  { open: '+++', close: '+++', lang: 'toml', style: '+' },
  { open: ';;;', close: ';;;', lang: 'json', style: ';' },
  { open: '{', close: '}', lang: 'json', style: '{' }
] as const

describe('intrinsic front matter formats', () => {
  it('retains substitution new-arm front matter at the shared document head', () => {
    const source = '{~~/front~>---\n\n---\n\n~~}\n\noutside{>>keep<<}\n'
    const core = createDocumentCore()
    const revision = core.open(source)
    expect(core.project(revision, 'revised').ast.root.children[0]?.kind).toBe('front-matter')
    expect(core.project(revision, 'markup').syntax.ast.root.children.map(node => node.kind)).toContain('front-matter')
    const offset = source.indexOf('---') + 4
    const inserted = core.apply(revision, [{ start: offset, end: offset, insert: 'x' }]).revision
    expect(core.project(inserted, 'markup').syntax.ast.root.children.find(node => node.kind === 'front-matter')?.attributes['content']).toBe('x\n')
    expect(inserted.annotations).toHaveLength(2)
  })
  for (const format of formats) {
    for (const eol of ['\n', '\r\n', '\r']) {
      it(`owns ${format.open}/${format.close} with ${JSON.stringify(eol)} through edits and reopen`, () => {
        const content = 'title: {++literal++}'
        const prefix = format.open + eol
        const literal = prefix + content + eol + format.close + eol
        const source = literal + eol + 'body {++added++}' + eol
        const core = createDocumentCore()
        const revision = core.open(source)
        const node = core.project(revision, 'markup').syntax.ast.root.children[0]
        expect(node).toMatchObject({
          kind: 'front-matter',
          range: { start: 0, end: literal.length },
          attributes: {
            lang: format.lang,
            style: format.style,
            opener: format.open,
            closer: format.close,
            content: content + '\n',
            contentStart: prefix.length,
            contentEnd: prefix.length + content.length + eol.length
          }
        })
        expect(revision.annotations).toHaveLength(1)
        expect(core.project(revision, 'original').markdown).toBe(literal + eol + 'body ' + eol)
        expect(core.project(revision, 'revised').markdown).toBe(literal + eol + 'body added' + eol)
        const changed = core.apply(revision, [{ start: prefix.length, end: prefix.length, insert: 'x' }]).revision
        const reopened = createDocumentCore()
        const expected = reopened.open(prefix + 'x' + source.slice(prefix.length))
        expect(changed.source).toBe(expected.source)
        expect(core.project(changed, 'markup').syntax.ast).toEqual(reopened.project(expected, 'markup').syntax.ast)
        expect(changed.annotations).toHaveLength(1)
      })
    }
    it(`keeps ${format.open} ordinary when disabled or away from document head`, () => {
      const source = format.open + '\nvalue\n' + format.close + '\n\nbody\n'
      for (const [text, options] of [[source, { frontMatter: false }], ['body\n\n' + source, {}]] as const) {
        const core = createDocumentCore()
        const revision = core.open(text, options)
        expect(core.project(revision, 'markup').syntax.ast.root.children.some(node => node.kind === 'front-matter')).toBe(false)
      }
    })
    it(`owns an empty ${format.open}/${format.close} body and a closer at EOF`, () => {
      const core = createDocumentCore()
      const source = format.open + '\n\n' + format.close
      const revision = core.open(source)
      expect(core.project(revision, 'markup').syntax.ast.root.children[0]).toMatchObject({
        kind: 'front-matter',
        range: { start: 0, end: source.length },
        attributes: { content: '\n', contentStart: format.open.length + 1, contentEnd: format.open.length + 2, closer: format.close }
      })
      const inserted = core.apply(revision, [{ start: format.open.length + 1, end: format.open.length + 1, insert: 'x' }]).revision
      const removed = core.apply(inserted, [{ start: format.open.length + 1, end: format.open.length + 2, insert: '' }]).revision
      expect(removed.source).toBe(source)
      expect(core.project(removed, 'markup').syntax.ast).toEqual(core.project(revision, 'markup').syntax.ast)
    })
    it(`retains empty ${format.open}/${format.close} ownership after deleting its last character before an annotated body`, () => {
      const source = format.open + '\n\n' + format.close + '\n\nbody{>>keep<<}\n'
      const core = createDocumentCore()
      const revision = core.open(source)
      const start = format.open.length + 1
      const inserted = core.apply(revision, [{ start, end: start, insert: 'x' }]).revision
      const removed = core.apply(inserted, [{ start, end: start + 1, insert: '' }]).revision
      expect(removed.source).toBe(source)
      expect(core.project(removed, 'markup').syntax.ast).toEqual(core.project(revision, 'markup').syntax.ast)
    })
    it(`does not admit a mismatched closer for ${format.open}/${format.close}`, () => {
      const closer = format.close === '+++' ? ';;;' : '+++'
      const source = format.open + '\nvalue\n' + closer + '\n'
      const core = createDocumentCore()
      const revision = core.open(source)
      expect(core.project(revision, 'markup').syntax.ast.root.children.some(node => node.kind === 'front-matter')).toBe(false)
    })
    it(`recognizes ${format.open}/${format.close} after completing its opener incrementally`, () => {
      const source = format.open + '\nvalue {++literal++}\n' + format.close + '\n'
      const core = createDocumentCore()
      const revision = core.open(source.slice(1))
      const inserted = core.apply(revision, [{ start: 0, end: 0, insert: source.slice(0, 1) }]).revision
      const reopened = createDocumentCore()
      const expected = reopened.open(source)
      expect(core.project(inserted, 'markup').syntax.ast).toEqual(reopened.project(expected, 'markup').syntax.ast)
      expect(inserted.annotations).toEqual([])
    })
  }
})

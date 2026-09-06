import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

describe('Markup replacement block arms', () => {
  for (const [old, replacement, kinds] of [
    ['plain', '# title', ['paragraph', 'heading']],
    ['# title', 'plain', ['heading', 'paragraph']],
    ['seed', '| a | b |\n| - | - |\n| 1 | 2 |', ['paragraph', 'table']],
    ['seed', '- item', ['paragraph', 'list']],
    ['seed', '> quote', ['paragraph', 'blockquote']]
  ] as const) {
    it(`retains independent ${kinds.join('/')} structure and both source arms`, () => {
      const source = `{~~${old}~>${replacement}~~}\n`
      const core = createDocumentCore()
      const revision = core.open(source)
      const markup = core.project(revision, 'markup')
      expect(markup.syntax.ast.root.children.map(node => node.kind)).toEqual(kinds)
      expect(markup.events.filter(event => event.kind === 'text').map(event => event.text).join(''))
        .toBe(old + replacement + '\n')
      expect(core.project(revision, 'original').markdown).toBe(old + '\n')
      expect(core.project(revision, 'revised').markdown).toBe(replacement + '\n')
      expect(revision.source).toBe(source)
    })
  }

  it('retains a shared heading and ordinary inline replacement without introducing blocks', () => {
    const core = createDocumentCore()
    for (const source of [
      '# {~~old~>new~~}\n', 'a{~~old~>new~~}z\n',
      '{~~old~>`new`~~}', '{~~old~><https://example.com>~~}', '{~~old~>$new$~~}'
    ]) {
      const revision = core.open(source)
      expect(core.project(revision, 'markup').syntax.ast.root.children).toHaveLength(1)
    }
  })
})

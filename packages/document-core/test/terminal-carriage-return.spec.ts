import { expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

it.each(['', '> '])('finalizes a terminal CR after a %sfenced closer', prefix => {
  const core = createDocumentCore()
  const source = `${prefix}\`\`\`\r${prefix}a\r${prefix}b\r${prefix}\`\`\`\r`
  const revision = core.open(source)
  const markup = core.project(revision, 'markup')
  const outer = markup.syntax.ast.root.children[0]
  const code = prefix === '' ? outer : outer?.children[0]
  expect(code?.attributes.content).toBe('a\nb\n')
  expect(revision.source).toBe(source)
  const changed = core.apply(revision, [{ start: source.length, end: source.length, insert: '\ntext' }]).revision
  expect(core.project(changed, 'markup').syntax.ast.root.children.at(-1)?.kind).toBe('paragraph')
  expect(changed.source).toBe(`${source}\ntext`)
})

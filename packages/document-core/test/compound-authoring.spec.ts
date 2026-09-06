import { expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

it('keeps tracked list padding outside a fenced literal while preserving existing annotations', () => {
  const source = '- {++first++}{>>keep<<}\n\n  ```js\n  let x = 1\n  ```\n- second\n'
  const core = createDocumentCore()
  const revision = core.open(source)
  const second = source.indexOf('- second')
  const edits = [
    { start: 0, end: 2, insert: '1. ' },
    ...['  ```js', '  let x', '  ```\n'].map(text => {
      const start = source.indexOf(text)
      return { start, end: start + 2, insert: '   ' }
    }),
    { start: second, end: second + 2, insert: '2. ' }
  ]
  const planned = core.trackedEdits(revision, edits)
  expect(planned).toBeDefined()
  if (!planned) throw new Error('Expected a safe tracked conversion')
  const result = core.apply(revision, planned).revision
  expect(core.project(result, 'revised').markdown).toBe('1. first\n\n   ```js\n   let x = 1\n   ```\n2. second\n')
  expect(core.project(result, 'original').markdown).toBe('- \n\n  ```js\n  let x = 1\n  ```\n- second\n')
  const pending = [...core.project(result, 'markup').syntax.ast.root.children]
  const content: unknown[] = []
  while (pending.length) {
    const node = pending.pop()!
    if (node.kind === 'code-block') content.push(node.attributes.content)
    pending.push(...node.children)
  }
  expect(content).toEqual(['let x = 1\n', 'let x = 1\n'])
})

it.each(['markup', 'tracked'] as const)('plans %s container prefixes atomically without copying annotation source into native text', lane => {
  const core = createDocumentCore()
  const source = '- {++first++}{>>keep note<<}\n- second\n- third\n'
  const revision = core.open(source)
  const edits = ['- second', '- third'].map(text => ({ start: source.indexOf(text), end: source.indexOf(text), insert: '  ' }))
  const planned = lane === 'markup' ? core.markupEdits(revision, edits) : core.trackedEdits(revision, edits)
  expect(planned).toBeDefined()
  if (planned === undefined) throw new Error('Expected a safe compound plan')
  expect(revision.source).toBe(source)
  const result = core.apply(revision, planned).revision
  expect(result.source).toBe(lane === 'markup'
    ? '- {++first++}{>>keep note<<}\n  - second\n  - third\n'
    : '- {++first++}{>>keep note<<}\n{++  ++}- second\n{++  ++}- third\n')
})

it.each(['markup', 'tracked'] as const)('refuses an unsafe %s batch without advancing the acknowledged lineage', lane => {
  const core = createDocumentCore()
  const source = '{++word++}\nnext\n'
  const revision = core.open(source)
  const edits = [{ start: 1, end: 2, insert: '' }, { start: source.length, end: source.length, insert: '!' }]
  expect(lane === 'markup' ? core.markupEdits(revision, edits) : core.trackedEdits(revision, edits)).toBeUndefined()
  expect(core.apply(revision, [{ start: source.length, end: source.length, insert: '?' }]).revision.source).toBe(source + '?')
})

it('accepts adjacent disjoint ranges in a compound ordinary edit', () => {
  const core = createDocumentCore()
  const revision = core.open('ab')
  const edits = core.markupEdits(revision, [{ start: 0, end: 1, insert: 'x' }, { start: 1, end: 2, insert: 'y' }])
  expect(edits).toBeDefined()
  if (edits === undefined) throw new Error('Expected adjacent edits to be admitted')
  expect(core.apply(revision, edits).revision.source).toBe('xy')
})

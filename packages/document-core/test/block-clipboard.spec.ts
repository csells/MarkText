import { expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

it.each((['before', 'after'] as const).flatMap(blockPlacement => [false, true].map(tracked => ({ blockPlacement, tracked }))))('inserts a dropped image $blockPlacement the owned outer block (tracked=$tracked)', ({ blockPlacement, tracked }) => {
  const core = createDocumentCore()
  const source = '> s{++a++}me{>>keep<<}\n\ntail\n'
  const revision = core.open(source)
  const image = '![shot.png](/tmp/shot.png)'
  const plan = core.planClipboard(revision, { kind: 'paste', selection: { ranges: [{ anchor: 2, focus: 2 }], primary: 0 }, tracked, markdown: image, blockPlacement })
  const committed = core.apply(revision, plan.edits)
  const expected = blockPlacement === 'before' ? image + '\n\n' + source : '> s{++a++}me{>>keep<<}\n\n' + image + '\n\ntail\n'
  if (!tracked) expect(committed.revision.source).toBe(expected)
  else expect(core.project(committed.revision, 'original').markdown).toBe('> sme\n\ntail\n')
  expect(core.project(committed.revision, 'revised').markdown).toBe(core.project(core.open(expected), 'revised').markdown)
  if (!('ranges' in plan.selection)) throw new Error('Expected new block selection')
  const at = plan.selection.ranges[0]!.anchor
  expect(committed.revision.source.slice(at, at + image.length)).toBe(image)
})

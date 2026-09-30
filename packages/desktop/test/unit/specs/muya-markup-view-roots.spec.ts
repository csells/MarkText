import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { applyMuyaMarkupChanges } from '@/documentAuthority/muyaMarkupChanges'
import {
  createMuyaMarkupView,
  type MuyaMarkupBinding,
  type MuyaMarkupView
} from '@/documentAuthority/muyaMarkupView'
import {
  muyaViewBindingPrecedes,
  muyaViewBindingsInRoots,
  muyaViewBindingsNear,
  muyaViewEditableCount,
  muyaViewFindNear,
  muyaViewFirstBinding,
  muyaViewItemAtPath,
  muyaViewItemsAtPath,
  muyaViewItemsAtRoot,
  muyaViewLastBinding,
  muyaViewPreviousBinding
} from '@/documentAuthority/muyaMarkupViewLookup'
import { muyaMarkupRootsFor } from '@/documentAuthority/muyaMarkupViewRoots'

// Plan 0012 G35: a view made by a regional change holds later roots unmoved
// until they are read. Its root queries answer as the whole lists of the
// view of the new revision do, and a key's patch and queries never list it.

const lcg = (seed: number) => (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

const blocks = [
  'Plain words here.',
  'Text with {++added++} inside.',
  'Text {--deleted--} and {~~old~>new~~} too.',
  'Note {==marked==}{>>comment<<} end.',
  '{++Whole paragraph addition.++}',
  'Line one\nline two of one paragraph.',
  '# Heading',
  '- item one\n- item two',
  '> quoted line',
  '| a | b |\n| --- | --- |\n| 1 | 2 |',
  '   ',
  ''
]
const insertions = ['x', ' ', '\n', '\n\n', '{++n++}', 'y']

/** Every source position a binding's root items hold, for search checks. */
const positionsOf = (view: MuyaMarkupView, binding: MuyaMarkupBinding): number[] => {
  const decorations = view.decorations.filter((item) => item.path[0] === binding.path[0])
  const comments = view.comments.filter((item) => item.path[0] === binding.path[0])
  return [
    binding.sourceRange.start,
    binding.sourceRange.end,
    ...binding.segments.flatMap((segment) => [segment.source.start, segment.source.end]),
    ...(binding.trailingLinePosition === undefined ? [] : [binding.trailingLinePosition]),
    ...(binding.leadingLinePosition === undefined ? [] : [binding.leadingLinePosition]),
    ...(binding.caretSnaps ?? []).flatMap((snap) => [snap.from, snap.at]),
    ...decorations.flatMap((item) => [
      item.mark.annotationRange.start,
      item.mark.annotationRange.end,
      ...(item.sourcePosition === undefined ? [] : [item.sourcePosition])
    ]),
    ...comments.flatMap((item) => [item.annotationRange.start, item.annotationRange.end])
  ]
}

/** Makes reading any whole list of `view` fail, as a per-key reader must not. */
const forbidLists = (view: MuyaMarkupView): void => {
  for (const kind of ['bindings', 'decorations', 'comments']) {
    Object.defineProperty(view, kind, {
      get() {
        throw new Error(`listed the view's ${kind}`)
      }
    })
  }
}

const expectSameQueries = (actual: MuyaMarkupView, expected: MuyaMarkupView, label: string) => {
  for (let root = 0; root < expected.state.length; root += 1) {
    for (const kind of ['bindings', 'decorations', 'comments'] as const) {
      expect(muyaViewItemsAtRoot(actual, kind, root), label).toEqual(
        expected[kind].filter((item) => item.path[0] === root)
      )
    }
  }
  expect(muyaViewBindingsInRoots(actual, 1, 3), label).toEqual(
    expected.bindings.filter((item) => Number(item.path[0]) >= 1 && Number(item.path[0]) < 3)
  )
  expect(muyaViewEditableCount(actual), label).toBe(
    expected.bindings.filter((binding) => binding.editable !== false).length
  )
  expect(muyaViewFirstBinding(actual), label).toEqual(expected.bindings[0])
  expect(muyaViewLastBinding(actual), label).toEqual(expected.bindings.at(-1))
  const bindings = expected.bindings
  for (const [index, binding] of bindings.entries()) {
    const found = muyaViewItemAtPath(actual, 'bindings', binding.path)
    expect(found, label).toEqual(binding)
    if (found === undefined) continue
    expect(muyaViewItemsAtPath(actual, 'decorations', binding.path), label).toEqual(
      expected.decorations.filter((item) => JSON.stringify(item.path) === JSON.stringify(binding.path))
    )
    expect(muyaViewPreviousBinding(actual, found), label).toEqual(bindings[index - 1])
    const next = bindings[index + 1]
    const after = next === undefined ? undefined : muyaViewItemAtPath(actual, 'bindings', next.path)
    if (after !== undefined) {
      expect(muyaViewBindingPrecedes(actual, found, after), label).toBe(true)
      expect(muyaViewBindingPrecedes(actual, after, found), label).toBe(false)
    }
    // A search near any position a root holds reaches that root's bindings,
    // in list order among the bindings it reaches.
    for (const position of positionsOf(expected, binding)) {
      const near = [...muyaViewBindingsNear(actual, position)]
      expect(near.map((item) => JSON.stringify(item.path)), label).toContain(
        JSON.stringify(binding.path)
      )
      const order = near.map((item) =>
        bindings.findIndex((other) => JSON.stringify(other.path) === JSON.stringify(item.path))
      )
      expect(order, label).toEqual([...order].sort((left, right) => left - right))
    }
  }
  for (const comment of expected.comments) {
    const start = comment.annotationRange.start
    expect(
      muyaViewFindNear(actual, 'comments', start, start, (item) => item.annotationRange.start === start),
      label
    ).toEqual(expected.comments.find((item) => item.annotationRange.start === start))
  }
}

describe('Root queries of a regionally patched Markup view', () => {
  it.each(Array.from({ length: 24 }, (_, index) => index + 1))('seed %i', (seed) => {
    const random = lcg(seed * 104729)
    for (let documentIndex = 0; documentIndex < 3; documentIndex += 1) {
      const count = 3 + Math.floor(random() * 7)
      const source =
        Array.from({ length: count }, () => blocks[Math.floor(random() * blocks.length)]).join(
          '\n\n'
        ) + '\n'
      const core = createDocumentCore()
      let revision = core.open(source)
      let view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations, revision.source)
      for (let edit = 0; edit < 6; edit += 1) {
        const text = revision.source
        const start = Math.floor(random() * (text.length + 1))
        const end = random() < 0.2 ? Math.min(text.length, start + 1) : start
        const insert = end > start && random() < 0.5 ? '' : insertions[Math.floor(random() * insertions.length)]
        const label = `${JSON.stringify(text)} [${start}, ${end}) ${JSON.stringify(insert)}`
        const commit = core.apply(revision, [{ start, end, insert }], { projections: ['markup'] })
        // The editor's views read their structure from the source.
        const expected = createMuyaMarkupView(
          core.project(commit.revision, 'markup'),
          commit.revision.annotations,
          commit.revision.source
        )
        const change = commit.change.projections[0]
        const patched =
          change?.name === 'markup' && change.scope === 'regions'
            ? applyMuyaMarkupChanges(view, structuredClone(change))
            : undefined
        if (patched !== undefined) expectSameQueries(patched, expected, label)
        view = patched ?? expected
        revision = commit.revision
      }
    }
  })

  it('patches and answers a key without listing either view', () => {
    const paragraph =
      'Review {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.'
    const source =
      ['Warm editing paragraph.', ...Array.from({ length: 200 }, () => paragraph)].join('\n\n') +
      '\n'
    const core = createDocumentCore()
    let revision = core.open(source)
    let view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
    const at = 'Warm editing'.length
    for (let key = 0; key < 3; key += 1) {
      const commit = core.apply(revision, [{ start: at + key, end: at + key, insert: 'x' }], {
        projections: ['markup']
      })
      const change = commit.change.projections[0]
      if (change?.name !== 'markup' || change.scope !== 'regions') {
        throw new Error('Expected a real regional Core reply')
      }
      // The first view is fully listed; each later one is a patch's own.
      if (key > 0) forbidLists(view)
      const next = applyMuyaMarkupChanges(view, change)
      if (next === undefined) throw new Error('Expected a patched view')
      forbidLists(next)
      const expected = createMuyaMarkupView(
        core.project(commit.revision, 'markup'),
        commit.revision.annotations
      )
      const caret = at + key + 1
      expect([...muyaViewBindingsNear(next, caret)]).toEqual(
        expected.bindings.filter((binding) => binding.path[0] === 0)
      )
      expect(muyaViewItemAtPath(next, 'bindings', [0, 'text'])).toEqual(expected.bindings[0])
      expect(muyaViewItemsAtPath(next, 'decorations', [150, 'text'])).toEqual(
        expected.decorations.filter((item) => item.path[0] === 150)
      )
      expect(muyaViewLastBinding(next)).toEqual(expected.bindings.at(-1))
      expect(muyaViewEditableCount(next)).toBe(
        expected.bindings.filter((binding) => binding.editable !== false).length
      )
      view = next
      revision = commit.revision
    }
  }, 30_000)

  it.each([
    ['before', true],
    ['after', false]
  ])('moves none of a long list\'s items for a key in the paragraph %s it', (_, before) => {
    const list = Array.from({ length: 300 }, (_, index) => `- item ${index}`).join('\n\n')
    const paragraph = 'Warm editing paragraph.'
    const source = (before ? [paragraph, list] : [list, paragraph]).join('\n\n') + '\n'
    const core = createDocumentCore()
    let revision = core.open(source)
    let view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations, revision.source)
    const listRoot = view.state.findIndex((state) => state.name === 'loose-list-item' || state.name === 'bullet-list')
    expect(listRoot).toBeGreaterThanOrEqual(0)
    // The view's own root index reads every binding once, as the editor's first key does.
    muyaMarkupRootsFor(view)
    // Moving a binding copies its segments. A key may read the list's first
    // item to find where the edited region ends, never the whole list.
    let moved = 0
    for (const binding of view.bindings.filter((item) => item.path[0] === listRoot)) {
      const segments = binding.segments
      Object.defineProperty(binding, 'segments', {
        enumerable: true,
        get() {
          moved += 1
          return segments
        }
      })
    }
    const at = source.indexOf('Warm editing paragraph.') + 'Warm editing'.length
    const keys = 3
    for (let key = 0; key < keys; key += 1) {
      const commit = core.apply(revision, [{ start: at + key, end: at + key, insert: 'x' }], {
        projections: ['markup']
      })
      const change = commit.change.projections[0]
      if (change?.name !== 'markup' || change.scope !== 'regions') {
        throw new Error('Expected a real regional Core reply')
      }
      const next = applyMuyaMarkupChanges(view, change)
      if (next === undefined) throw new Error('Expected a patched view')
      view = next
      revision = commit.revision
    }
    expect(moved).toBeLessThanOrEqual(2 * keys)
    expectSameQueries(
      view,
      createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations, revision.source),
      'after three keys'
    )
  }, 30_000)
})

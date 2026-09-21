import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'

it('maps structural line starts once per view rather than once per list paragraph', () => {
  const source =
    Array.from({ length: 32 }, (_, index) => `- item ${index}\n  continued ${index}\n`).join('') +
    '\n'
  const core = createDocumentCore()
  const revision = core.open(source)
  const projection = core.project(revision, 'markup')
  let mappedPoints = 0
  const measured = {
    ...projection,
    syntax: {
      ...projection.syntax,
      coordinates: {
        ...projection.syntax.coordinates,
        toProjected: (...args: Parameters<typeof projection.syntax.coordinates.toProjected>) => {
          mappedPoints++
          return projection.syntax.coordinates.toProjected(...args)
        }
      }
    }
  }
  const view = createMuyaMarkupView(measured, revision.annotations, source)
  const paragraphs = view.bindings[0].sourceStructure?.nodes.filter(
    (node) => node.kind === 'paragraph'
  )
  expect(paragraphs).toHaveLength(32)
  expect(paragraphs?.[0].lineStarts).toEqual([9])
  expect(view.bindings[0].text).toBe('item 0\ncontinued 0')
  expect(view.bindings[0].sourceStructure?.source).toBe(source.trimEnd())
  // Rendering also maps each source character. Beyond that work, structural
  // coordinates must grow with the 65 source lines, not lines times leaves.
  expect(mappedPoints).toBeLessThanOrEqual(source.length + 4 * 65)
})

it('preserves canonical CRLF line starts, strict leaf bounds and CriticMarkup in nested structures', () => {
  const source =
    '- one{++new++}\r\n  continued\r\n  - nested\r\n    tail\r\n\r\n> quote{--old--}\r\n> next\r\n\r\n| h |\r\n| --- |\r\n| a |\r\n'
  const core = createDocumentCore()
  const revision = core.open(source)
  const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations, source)
  const structures = view.bindings.flatMap((binding) =>
    binding.sourceStructure ? [binding.sourceStructure] : []
  )
  expect(structures.map((structure) => structure.source)).toEqual([
    '- one{++new++}\r\n  continued\r\n  - nested\r\n    tail',
    '> quote{--old--}\r\n> next',
    '| h |\r\n| --- |\r\n| a |'
  ])
  expect(
    structures.map((structure) =>
      structure.nodes
        .filter((node) => node.lineStarts !== undefined)
        .map((node) => ({
          kind: node.kind,
          lineStarts: node.lineStarts
        }))
    )
  ).toEqual([
    [
      { kind: 'paragraph', lineStarts: [16] },
      { kind: 'paragraph', lineStarts: [41] }
    ],
    [{ kind: 'paragraph', lineStarts: [71] }],
    []
  ])
  expect(view.state.map((state) => state.name)).toEqual(['bullet-list', 'block-quote', 'table'])
  expect(new Set(view.decorations.map((decoration) => decoration.mark.kind))).toEqual(
    new Set(['addition', 'deletion'])
  )
  expect(revision.source).toBe(source)
})

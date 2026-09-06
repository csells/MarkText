import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'
import { searchProjectedDocument } from '@/documentConsumers/documentProjectionConsumers'
import { createProjectedSearchPresentation, type ProjectedSearchPresentationBlock } from '@/documentConsumers/projectedSearchPresentation'

describe('Revised search presented in editable Markup', () => {
  it.each([
    { source: 'a{--old--}b', query: 'ab', highlighted: ['a', 'b'] },
    { source: '{~~legacy~>cat~~}', query: 'cat', highlighted: ['cat'] },
    { source: '- {--old--}{++cat++}\n', query: 'cat', highlighted: ['cat'] }
  ])('paints canonical match pieces for $source', ({ source, query, highlighted }) => {
    const actor = createCoreActor()
    actor.handle({ type: 'open', session: 1, sequence: 1, source })
    const reply = actor.handle({ type: 'consumer-projection-at-barrier', session: 1, sequence: 2, baseRevision: 1 })
    if (reply.type !== 'consumer-projection') throw new Error('Missing consumer projection')
    const core = createDocumentCore()
    const revision = core.open(source)
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
    const index = createMuyaMarkupPresentationIndex(view)
    const hosts = view.bindings.map(() => document.createElement('div'))
    const blocks = new Map<number, ProjectedSearchPresentationBlock>()
    const presentation = createProjectedSearchPresentation({
      bindings: () => view.bindings,
      blockAtPath: path => {
        const blockIndex = view.bindings.findIndex(binding => JSON.stringify(binding.path) === JSON.stringify(path))
        if (blockIndex < 0) return undefined
        const retained = blocks.get(blockIndex)
        if (retained !== undefined) return retained
        const binding = view.bindings[blockIndex]
        const block: ProjectedSearchPresentationBlock = {
          update: (_cursor, highlights) => {
            hosts[blockIndex].innerHTML = index.render(path, binding.text, { renderImage: () => undefined, highlights }) ?? ''
          },
          focusHandler: () => {},
          blurHandler: () => {}
        }
        blocks.set(blockIndex, block)
        return block
      }
    })
    const result = searchProjectedDocument(structuredClone(reply.projection), query)
    expect(result.matches).toHaveLength(1)
    expect(presentation.present(result)).toBe(true)
    expect(hosts.flatMap(host => [...host.querySelectorAll('.mu-highlight')].map(node => node.textContent))).toEqual(highlighted)
    expect(hosts.map(host => host.textContent)).toEqual(view.bindings.map(binding => binding.text))
    presentation.clear()
    expect(hosts.flatMap(host => [...host.querySelectorAll('.mu-highlight')])).toEqual([])
    expect(presentation.present({ ...result, matches: result.matches.map(match => ({ ...match, sourceRanges: undefined })) })).toBe(false)
  })
})

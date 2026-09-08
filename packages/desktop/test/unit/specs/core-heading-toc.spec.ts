import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { MarkdownToHtml } from '@muyajs/core'
import {
  renderMarkdownProjectionToSafeHtml,
  presentMarkdownProjectionHtml
} from '@/documentConsumers/markdownProjectionHtml'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import { createCoreHeadingToc } from '@/documentAuthority/coreHeadingToc'

describe('Core heading navigation identity', () => {
  it('keeps chained heading collisions unique across native export, Core readers and navigation', async() => {
    const source = '# heading\n\n## heading\n\n## heading-1\n'
    const expected = ['heading', 'heading-1', 'heading-1-1']
    const ids = (html: string): string[] => {
      const host = document.createElement('div')
      host.innerHTML = html
      return [...host.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((node) => node.id)
    }
    expect(ids(await new MarkdownToHtml(source).renderHtml())).toEqual(expected)
    const core = createDocumentCore()
    const revision = core.open(source)
    for (const mode of ['original', 'revised'] as const) {
      const projection = core.project(revision, mode)
      expect(
        ids(await presentMarkdownProjectionHtml(renderMarkdownProjectionToSafeHtml(projection)))
      ).toEqual(expected)
      expect(createCoreHeadingToc(projection).map((entry) => entry.githubSlug)).toEqual(expected)
    }
    expect(revision.source).toBe(source)
  })

  it('joins native headings by source ownership while retaining Revised labels and export anchors', () => {
    const core = createDocumentCore()
    const revision = core.open('{--# Removed--}\n\n# {~~Old~>Current~~}\n\n# Current\n')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
    const projection = core.project(revision, 'revised')
    const toc = createCoreHeadingToc(
      { ...projection, sourceSegments: projection.coordinates.sourceSegments },
      view
    )
    expect(toc).toEqual([
      {
        lvl: 1,
        content: 'Current',
        githubSlug: 'current',
        slug: 'core-heading-17',
        nativePath: [1],
        sourceOffset: 17
      },
      {
        lvl: 1,
        content: 'Current',
        githubSlug: 'current-1',
        slug: 'core-heading-39',
        nativePath: [2],
        sourceOffset: 39
      }
    ])
    expect(
      createCoreHeadingToc({
        ...projection,
        sourceSegments: projection.coordinates.sourceSegments
      }).map((entry) => entry.slug)
    ).toEqual(toc.map((entry) => entry.slug))
  })
})

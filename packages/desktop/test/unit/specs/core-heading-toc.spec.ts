import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import { createCoreHeadingToc } from '@/documentAuthority/coreHeadingToc'

describe('Core heading navigation identity', () => {
  it('joins native headings by source ownership while retaining Revised labels and export anchors', () => {
    const core = createDocumentCore()
    const revision = core.open('{--# Removed--}\n\n# {~~Old~>Current~~}\n\n# Current\n')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
    const projection = core.project(revision, 'revised')
    const toc = createCoreHeadingToc({ ...projection, sourceSegments: projection.coordinates.sourceSegments }, view)
    expect(toc).toEqual([
      { lvl: 1, content: 'Current', githubSlug: 'current', slug: 'core-heading-17', nativePath: [1], sourceOffset: 17 },
      { lvl: 1, content: 'Current', githubSlug: 'current-1', slug: 'core-heading-39', nativePath: [2], sourceOffset: 39 }
    ])
    expect(createCoreHeadingToc({ ...projection, sourceSegments: projection.coordinates.sourceSegments })
      .map(entry => entry.slug)).toEqual(toc.map(entry => entry.slug))
  })
})

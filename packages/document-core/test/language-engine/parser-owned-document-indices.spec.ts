import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createLanguageEngine,
  createSourceSnapshot,
  groupRenderBlocks,
  markdownHeadingAnchors,
  materializeProjectedText,
  renderMarkdownHtml,
  renderMarkupPlan,
  resolveMarkdownDocumentLinkTarget,
  type CompleteDocumentRevision,
  type MarkupRenderNode,
  type ParseConfiguration
} from '@marktext/document-core'

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: {
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: true,
    subscriptAndSuperscript: true
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

function revisionFor(source: string): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete document revision')
  }
  return revision
}

function renderedNodeText(node: MarkupRenderNode): string {
  return [
    ...node.text.map(run => run.text),
    ...node.children.map(renderedNodeText)
  ].join('')
}

describe('parser-owned Markdown document indices', () => {
  it('publishes immutable reference and heading facts with graph identity', () => {
    const revision = revisionFor(
      '# One [link] [^note]\n\n' +
      '# One [link]\n\n' +
      '[link]: /destination "title"\n\n' +
      '[^note]: Footnote *body*.\n'
    )
    const document = revision.projection('revised').markdown
    const references = document.references
    const headings = document.headings

    expect(Object.isFrozen(references)).toBe(true)
    expect(Object.isFrozen(headings)).toBe(true)
    expect(references.definitionCount).toBe(1)
    expect(references.linkCount).toBe(2)
    expect(references.footnoteDefinitionCount).toBe(1)
    expect(references.footnoteReferenceCount).toBe(1)
    expect(headings.count).toBe(2)

    const definition = references.definitionAt(0)
    const firstLink = references.linkAt(0)
    const footnoteDefinition = references.footnoteDefinitionAt(0)
    const footnoteReference = references.footnoteReferenceAt(0)
    const firstHeading = headings.at(0)

    expect(references.definitionForLabel('link')).toBe(definition)
    expect(references.linkForNode(firstLink.node.nodeId)).toBe(firstLink)
    expect(firstLink.definition).toBe(definition)
    expect(firstLink.destination).toBe('/destination')
    expect(firstLink.title).toBe('title')
    expect(footnoteReference.definition).toBe(footnoteDefinition)
    expect(firstHeading.node.nodeId).toBe(firstHeading.nodeId)
    expect(firstHeading.level).toBe(1)

    const referenceEdges = Array.from(
      { length: revision.syntax.edgeCount },
      (_, ordinal) => revision.syntax.edgeAt(ordinal)
    ).filter((edge) => edge.kind === 'reference')
    expect(referenceEdges).toContainEqual({
      kind: 'reference',
      from: firstLink.node.nodeId,
      to: definition.node.nodeId
    })
    expect(referenceEdges).toContainEqual({
      kind: 'reference',
      from: footnoteReference.node.nodeId,
      to: footnoteDefinition.node.nodeId
    })

    const anchors = markdownHeadingAnchors(document)
    expect(anchors.map((anchor) => ({
      nodeId: anchor.nodeId,
      text: anchor.text,
      slug: anchor.slug
    }))).toEqual([
      {
        nodeId: headings.at(0).nodeId,
        text: 'One link [1]',
        slug: 'one-link-1'
      },
      {
        nodeId: headings.at(1).nodeId,
        text: 'One link',
        slug: 'one-link'
      }
    ])
  })

  it('keeps view-dependent definitions and all consumers on the same facts', () => {
    const revision = revisionFor(
      '[link]\n\n{++[link]: /destination++}\n'
    )
    const original = revision.projection('original').markdown
    const revised = revision.projection('revised').markdown

    expect(original.references.definitionCount).toBe(0)
    expect(original.references.linkCount).toBe(0)
    expect(revised.references.definitionCount).toBe(1)
    expect(revised.references.linkCount).toBe(1)

    const target = revised.references.linkAt(0)
    expect(resolveMarkdownDocumentLinkTarget(
      revised,
      target.node.nodeId
    )).toEqual({
      kind: 'document-link-target',
      targetNodeId: target.node.nodeId,
      destination: '/destination'
    })
    expect(renderMarkdownHtml(original)).toBe('<p>[link]</p>\n')
    expect(renderMarkdownHtml(revised)).toBe(
      '<p><a href="/destination">link</a></p>\n'
    )
  })

  it('authenticates a reference definition owned by a container', () => {
    const revision = revisionFor('[foo]\n\n> [foo]: /url\n')
    const document = revision.projection('revised').markdown
    const link = document.references.linkAt(0)
    const definition = document.references.definitionAt(0)

    expect(link.definition).toBe(definition)
    expect(link.destination).toBe('/url')
    const referenceEdges = Array.from(
      { length: revision.syntax.edgeCount },
      (_, ordinal) => revision.syntax.edgeAt(ordinal)
    ).filter((edge) => edge.kind === 'reference')
    expect(referenceEdges).toContainEqual({
      kind: 'reference',
      from: link.node.nodeId,
      to: definition.node.nodeId
    })
  })

  it('keeps hostile reference and heading cases graph-authenticated per view', () => {
    const revision = revisionFor(
      '{--# Old--}\n\n' +
      '# Shared ![image][asset] [missing]\n\n' +
      '{++# New++}\n\n' +
      '[asset]: /first.png\n' +
      '[asset]: /ignored.png\n\n' +
      'note[^note] unresolved[^missing]\n\n' +
      '[^note]: First.\n' +
      '[^note]: Ignored.\n\n' +
      '<h1>HTML impostor</h1>\n\n' +
      '```\n# code impostor\n```\n'
    )
    const original = revision.projection('original').markdown
    const revised = revision.projection('revised').markdown

    expect(original.headings.count).toBe(2)
    expect(revised.headings.count).toBe(2)
    expect(original.headings.at(0).node.range.start).toBeLessThan(
      original.headings.at(1).node.range.start
    )
    expect(revised.headings.at(0).node.range.start).toBeLessThan(
      revised.headings.at(1).node.range.start
    )
    expect(original.headings.at(0).nodeId).not.toBe(
      revised.headings.at(1).nodeId
    )

    for (const document of [original, revised]) {
      expect(document.references.definitionCount).toBe(2)
      expect(document.references.definitionForLabel('asset')?.destination)
        .toBe('/first.png')
      expect(document.references.linkCount).toBe(1)
      const image = document.references.linkAt(0)
      expect(image.node.kind).toBe('image')
      expect(image.destination).toBe('/first.png')

      expect(document.references.footnoteDefinitionCount).toBe(1)
      expect(document.references.footnoteReferenceCount).toBe(2)
      const definition =
        document.references.footnoteDefinitionForLabel('note')
      const resolved = document.references.footnoteReferenceAt(0)
      const unresolved = document.references.footnoteReferenceAt(1)
      expect(resolved.definition).toBe(definition)
      expect(unresolved.definition).toBeUndefined()

      const referenceEdges = Array.from(
        { length: revision.syntax.edgeCount },
        (_, ordinal) => revision.syntax.edgeAt(ordinal)
      ).filter((edge) => edge.kind === 'reference')
      expect(referenceEdges).toContainEqual({
        kind: 'reference',
        from: image.node.nodeId,
        to: image.definition?.node.nodeId
      })
      expect(referenceEdges).toContainEqual({
        kind: 'reference',
        from: resolved.node.nodeId,
        to: definition?.node.nodeId
      })
      expect(referenceEdges.some(
        (edge) => edge.from === unresolved.node.nodeId
      )).toBe(false)
    }
  })

  it('authenticates projection-specific footnote targets independently', () => {
    const revision = revisionFor(
      'note[^note]\n\n' +
      '{~~[^note]: Old.\n~>[^note]: New.\n~~}'
    )
    const original = revision.projection('original').markdown.references
    const revised = revision.projection('revised').markdown.references
    const originalDefinition = original.footnoteDefinitionAt(0)
    const revisedDefinition = revised.footnoteDefinitionAt(0)
    const originalReference = original.footnoteReferenceAt(0)
    const revisedReference = revised.footnoteReferenceAt(0)

    expect(originalDefinition.node.nodeId).not.toBe(
      revisedDefinition.node.nodeId
    )
    expect(originalReference.definition).toBe(originalDefinition)
    expect(revisedReference.definition).toBe(revisedDefinition)
    const referenceEdges = Array.from(
      { length: revision.syntax.edgeCount },
      (_, ordinal) => revision.syntax.edgeAt(ordinal)
    ).filter((edge) => edge.kind === 'reference')
    expect(referenceEdges).toContainEqual({
      kind: 'reference',
      from: originalReference.node.nodeId,
      to: originalDefinition.node.nodeId
    })
    expect(referenceEdges).toContainEqual({
      kind: 'reference',
      from: revisedReference.node.nodeId,
      to: revisedDefinition.node.nodeId
    })
  })

  it('keeps boundary-protected missing-target variants unresolved', async() => {
    const fixtures = [
      {
        canonical: '{{--z--}++x++}\n\np{--\n\n--}[r]: /{++y++}',
        original: {
          source: '{z++x++}\n\np\n\n[r]: /{++y++}',
          html: '<p>{z++x++}</p>\n<p>p</p>\n'
        },
        revised: {
          source: '\\{++x++}\n\np[r]: /\\{++y++\\}',
          html: '<p>{++x++}</p>\n<p>p[r]: /{++y++}</p>\n'
        },
        editing: {
          source: '{z++x++}\n\np\n\n[r]: /{++y++}',
          html: '<p>{z++x++}</p>\n<p>p</p>\n'
        }
      },
      {
        canonical: 'p{--\n\n--}[r]: /{++y++}',
        original: {
          source: 'p\n\n[r]: /{++y++}',
          html: '<p>p</p>\n'
        },
        revised: {
          source: 'p[r]: /\\{++y++\\}',
          html: '<p>p[r]: /{++y++}</p>\n'
        },
        editing: {
          source: 'p\n\n[r]: /{++y++}',
          html: '<p>p</p>\n'
        }
      },
      {
        canonical: '{~~old~>[x~~}]({++literal++})',
        original: {
          source: 'old]()',
          html: '<p>old]()</p>\n'
        },
        revised: {
          source: '\\[x](literal)',
          html: '<p>[x](literal)</p>\n'
        },
        editing: {
          source: 'old\\[x](literal)',
          html: '<p>old[x](literal)</p>\n'
        }
      },
      {
        canonical: '{~~old~>![x~~}]({++literal++})',
        original: {
          source: 'old]()',
          html: '<p>old]()</p>\n'
        },
        revised: {
          source: '!\\[x](literal)',
          html: '<p>![x](literal)</p>\n'
        },
        editing: {
          source: 'old!\\[x](literal)',
          html: '<p>old![x](literal)</p>\n'
        }
      }
    ] as const
    for (const fixture of fixtures) {
      const revision = revisionFor(fixture.canonical)
      for (const view of ['original', 'revised', 'editing'] as const) {
        const projection = revision.projection(view)
        expect(projection.source, `${view}: ${fixture.canonical}`).toBe(
          fixture[view].source
        )
        expect(
          renderMarkdownHtml(projection.markdown),
          `${view}: ${fixture.canonical}`
        ).toBe(fixture[view].html)
        expect(
          projection.markdown.references.linkCount,
          `${view}: ${fixture.canonical}`
        ).toBe(0)
      }
    }

    const boundarySource = 'p{--\n\n--}[r]: /{++y++}'
    const revision = revisionFor(boundarySource)
    const revised = revision.projection('revised')
    const unresolvedNode = Array.from(
      { length: revised.markdown.root.childCount },
      (_, ordinal) => revised.markdown.root.childAt(ordinal)
    ).flatMap((block) => Array.from(
      { length: block.childCount },
      (_, ordinal) => block.childAt(ordinal)
    )).find((node) => node.kind === 'link')
    expect(unresolvedNode?.attributes['referenceLabel']).toBe('r')
    expect(
      revised.markdown.references.linkForNode(unresolvedNode!.nodeId)
    ).toBeUndefined()
    expect(materializeProjectedText(revision, 'revised').text).toBe(
      'p[r]: /{++y++}'
    )
    expect(renderMarkdownHtml(revised.markdown)).toBe(
      '<p>p[r]: /{++y++}</p>\n'
    )
    const session = await createDocumentSession({
      source: createSourceSnapshot(boundarySource),
      parseConfiguration: TEST_CONFIGURATION
    })
    await session.dispatch({
      kind: 'set-projection',
      projection: 'revised'
    }).completion
    const snapshot = session.snapshot()
    if (snapshot.kind !== 'complete') {
      throw new Error('Expected a complete session snapshot')
    }
    expect(groupRenderBlocks(
      snapshot.displayDocument,
      renderMarkupPlan(snapshot.displayPlan)
    ).map(block => renderedNodeText(block.tree)).join('')).toBe(
      'p[r]: /{++y++}'
    )
  })
})

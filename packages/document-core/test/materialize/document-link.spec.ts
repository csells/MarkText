import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  resolveDocumentLinkTarget,
  type CompleteDocumentRevision,
  type MarkdownNode,
  type NodeId,
  type ParseConfiguration
} from '@marktext/document-core'

const CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: {
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

function complete(source: string): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete revision')
  }
  return revision
}

function descendants(node: MarkdownNode): readonly MarkdownNode[] {
  const result: MarkdownNode[] = [node]
  for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
    result.push(...descendants(node.childAt(ordinal)))
  }
  return result
}

function linkIds(revision: CompleteDocumentRevision): readonly NodeId[] {
  return descendants(revision.projection('editing').markdown.root)
    .filter(node => node.kind === 'link' || node.kind === 'autolink')
    .map(node => node.nodeId)
}

describe('parser-authenticated document link target query', () => {
  it('resolves exact inline and reference destinations from parser nodes', () => {
    const revision = complete([
      '[inline](docs/a\\(b\\).md)',
      '[entity](docs/a&amp;b.md)',
      '[reference][dest]',
      '',
      '[dest]: <docs/Reference File.md>'
    ].join('\n'))
    const ids = linkIds(revision)

    expect(ids).toHaveLength(3)
    expect(ids.map(targetNodeId =>
      resolveDocumentLinkTarget(revision, targetNodeId)
    )).toEqual([
      {
        kind: 'document-link-target',
        targetNodeId: ids[0],
        destination: 'docs/a(b).md'
      },
      {
        kind: 'document-link-target',
        targetNodeId: ids[1],
        destination: 'docs/a&b.md'
      },
      {
        kind: 'document-link-target',
        targetNodeId: ids[2],
        destination: 'docs/Reference File.md'
      }
    ])
  })

  it('resolves URI, email, and GFM extended autolinks exactly', () => {
    const revision = complete([
      '<https://example.test/a?q=1>',
      '<person@example.test>',
      'www.example.test/path'
    ].join('\n\n'))
    const ids = linkIds(revision)

    expect(ids).toHaveLength(3)
    expect(ids.map(targetNodeId =>
      resolveDocumentLinkTarget(revision, targetNodeId).destination
    )).toEqual([
      'https://example.test/a?q=1',
      'mailto:person@example.test',
      'http://www.example.test/path'
    ])
  })

  it('rejects non-link and foreign parser identities', () => {
    const revision = complete('# Heading\n\n[link](target.md)\n')
    const heading = revision.projection('editing').markdown.root.childAt(0)
    const foreign = linkIds(complete('[other](forged.md)\n'))[0]
    if (foreign === undefined) {
      throw new Error('Expected a foreign link identity')
    }

    expect(() =>
      resolveDocumentLinkTarget(revision, heading.nodeId)
    ).toThrow(/not a link/)
    expect(() =>
      resolveDocumentLinkTarget(revision, foreign)
    ).toThrow(/not a link/)
  })
})

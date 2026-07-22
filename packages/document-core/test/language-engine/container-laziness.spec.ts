import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type DocumentRevision,
  type MarkdownNode,
  type ParseConfiguration
} from '@marktext/document-core'

type CompleteRevision = Extract<DocumentRevision, { readonly kind: 'complete' }>

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

function open(source: string): CompleteRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete document revision')
  }
  return revision
}

function childKinds(node: MarkdownNode): readonly string[] {
  return Array.from(
    { length: node.childCount },
    (_, ordinal) => node.childAt(ordinal).kind
  )
}

function onlyChild(node: MarkdownNode, kind: string): MarkdownNode {
  expect(childKinds(node)).toEqual([kind])
  return node.childAt(0)
}

describe('Profile 1 CommonMark lazy container continuation', () => {
  it('retains a blockquote around paragraph continuation text without a marker', () => {
    const root = open('> bar\nbaz').projection('revised').markdown.root
    const quote = onlyChild(root, 'blockquote')
    const paragraph = onlyChild(quote, 'paragraph')

    expect(childKinds(paragraph)).toEqual(['text', 'soft-break', 'text'])
    expect(quote.range).toEqual({ start: 0, end: 9 })
  })

  it('retains a list item around paragraph continuation text without indentation', () => {
    const root = open('  1.  A paragraph\nwith two lines.')
      .projection('revised').markdown.root
    const list = onlyChild(root, 'list')
    const item = onlyChild(list, 'list-item')
    const paragraph = onlyChild(item, 'paragraph')

    expect(list.attributes).toMatchObject({ ordered: true, start: 1 })
    expect(childKinds(paragraph)).toEqual(['text', 'soft-break', 'text'])
    expect(list.range).toEqual({ start: 2, end: 33 })
  })

  it('forks nested lazy continuation state independently across CM arms', () => {
    const revision = open(
      '{~~> 1. > Blockquote\ncontinued here.~>- item\nlazy continuation~~}'
    )

    const originalQuote = onlyChild(
      revision.projection('original').markdown.root,
      'blockquote'
    )
    const originalList = onlyChild(originalQuote, 'list')
    const originalItem = onlyChild(originalList, 'list-item')
    const innerQuote = onlyChild(originalItem, 'blockquote')
    const originalParagraph = onlyChild(innerQuote, 'paragraph')
    expect(childKinds(originalParagraph)).toEqual([
      'text',
      'soft-break',
      'text'
    ])

    const revisedList = onlyChild(
      revision.projection('revised').markdown.root,
      'list'
    )
    const revisedItem = onlyChild(revisedList, 'list-item')
    const revisedParagraph = onlyChild(revisedItem, 'paragraph')
    expect(childKinds(revisedParagraph)).toEqual([
      'text',
      'soft-break',
      'text'
    ])
  })

  it.each([
    ['> foo\n---', ['blockquote', 'thematic-break']],
    ['> foo\n# bar', ['blockquote', 'heading']],
    ['> foo\n- bar', ['blockquote', 'list']]
  ] as const)(
    'does not make an interrupting block lazy in %j',
    (source, expectedKinds) => {
      expect(childKinds(open(source).projection('revised').markdown.root))
        .toEqual(expectedKinds)
    }
  )

  it('keeps a noninterrupting ordered marker as lazy paragraph text', () => {
    const root = open('> foo\n2. bar').projection('revised').markdown.root
    const quote = onlyChild(root, 'blockquote')
    const paragraph = onlyChild(quote, 'paragraph')
    expect(childKinds(paragraph)).toEqual(['text', 'soft-break', 'text'])
  })

  it('does not promote a setext underline under a preceding lazy line', () => {
    const root = open('> foo\nbar\n===').projection('revised').markdown.root
    const quote = onlyChild(root, 'blockquote')
    const paragraph = onlyChild(quote, 'paragraph')
    expect(childKinds(paragraph)).toEqual([
      'text',
      'soft-break',
      'text',
      'soft-break',
      'text'
    ])
  })
})

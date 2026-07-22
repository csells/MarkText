import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type MarkdownNode,
  type ParseConfiguration
} from '@marktext/document-core'

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

function childKinds(node: MarkdownNode): readonly string[] {
  return Array.from(
    { length: node.childCount },
    (_, ordinal) => node.childAt(ordinal).kind
  )
}

interface CommonMarkEmphasisExample {
  readonly number: number
  readonly markdown: string
  readonly signature: string
}

const COMMONMARK_EMPHASIS = JSON.parse(readFileSync(
  new URL('../fixtures/commonmark-0.31.2-emphasis.json', import.meta.url),
  'utf8'
)) as Readonly<{
  version: string
  examples: readonly CommonMarkEmphasisExample[]
}>

const GFM_STRIKETHROUGH = JSON.parse(readFileSync(
  new URL('../fixtures/gfm-0.29-strikethrough.json', import.meta.url),
  'utf8'
)) as Readonly<{
  version: string
  examples: readonly CommonMarkEmphasisExample[]
}>

function emphasisSignature(node: MarkdownNode): string {
  let children = ''
  for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
    children += emphasisSignature(node.childAt(ordinal))
  }
  return node.kind === 'emphasis'
    ? `<em>${children}</em>`
    : node.kind === 'strong'
      ? `<strong>${children}</strong>`
      : children
}

function strikethroughSignature(node: MarkdownNode): string {
  let children = ''
  for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
    children += strikethroughSignature(node.childAt(ordinal))
  }
  return node.kind === 'strikethrough'
    ? `<del>${children}</del>`
    : children
}

describe('Profile 1 inline delimiter runs', () => {
  it('pins the complete CommonMark 0.31.2 emphasis example set', () => {
    expect(COMMONMARK_EMPHASIS.version).toBe('0.31.2')
    expect(COMMONMARK_EMPHASIS.examples).toHaveLength(132)
  })

  it.each(COMMONMARK_EMPHASIS.examples)(
    'matches CommonMark 0.31.2 emphasis signature for example $number',
    ({ markdown, signature }) => {
      const revision = createLanguageEngine().open(
        createSourceSnapshot(markdown),
        TEST_CONFIGURATION
      )
      if (revision.kind !== 'complete') {
        throw new Error('Expected a complete document revision')
      }
      expect(
        emphasisSignature(revision.projection('revised').markdown.root)
      ).toBe(signature)
    }
  )

  it('pins the complete GFM 0.29 strikethrough example set', () => {
    expect(GFM_STRIKETHROUGH.version).toBe('0.29-gfm')
    expect(GFM_STRIKETHROUGH.examples).toHaveLength(3)
  })

  it.each(GFM_STRIKETHROUGH.examples)(
    'matches GFM 0.29 strikethrough signature for example $number',
    ({ markdown, signature }) => {
      const revision = createLanguageEngine().open(
        createSourceSnapshot(markdown),
        TEST_CONFIGURATION
      )
      if (revision.kind !== 'complete') {
        throw new Error('Expected a complete document revision')
      }
      expect(
        strikethroughSignature(revision.projection('revised').markdown.root)
      ).toBe(signature)
    }
  )

  it('forks opener flanking independently across Substitution arms', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('a *{~~old~> old~~}foo*'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const originalParagraph = revision.projection('original').markdown.root.childAt(0)
    expect(childKinds(originalParagraph)).toEqual(['text', 'emphasis'])

    const revisedParagraph = revision.projection('revised').markdown.root.childAt(0)
    expect(childKinds(revisedParagraph)).toEqual(['text'])
  })

  it('processes one maximal delimiter run assembled across a CM boundary', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{++*++}**foo***'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const originalParagraph = revision.projection('original').markdown.root.childAt(0)
    expect(childKinds(originalParagraph)).toEqual(['strong', 'text'])
    expect(originalParagraph.childAt(0)).toMatchObject({
      kind: 'strong',
      range: { start: 0, end: 7 }
    })
    expect(originalParagraph.childAt(1)).toMatchObject({
      kind: 'text',
      range: { start: 7, end: 8 }
    })

    const revisedParagraph = revision.projection('revised').markdown.root.childAt(0)
    expect(childKinds(revisedParagraph)).toEqual(['emphasis'])
    expect(childKinds(revisedParagraph.childAt(0))).toEqual(['strong'])
    expect(revisedParagraph.childAt(0)).toMatchObject({
      kind: 'emphasis',
      range: { start: 0, end: 9 }
    })
    expect(revisedParagraph.childAt(0).childAt(0)).toMatchObject({
      kind: 'strong',
      range: { start: 1, end: 8 }
    })
    expect(revisedParagraph.childAt(0).childAt(0).childAt(0)).toMatchObject({
      kind: 'text',
      range: { start: 3, end: 6 }
    })
  })

  it('supports underscore emphasis and strong in independent Substitution arms', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{~~_old_~>__new__~~}'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(childKinds(
      revision.projection('original').markdown.root.childAt(0)
    )).toEqual(['emphasis'])
    expect(childKinds(
      revision.projection('revised').markdown.root.childAt(0)
    )).toEqual(['strong'])
  })

  it('recomputes opener selection after a CM-carried delimiter run', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('**foo {++**++}bar baz**'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(childKinds(
      revision.projection('original').markdown.root.childAt(0)
    )).toEqual(['strong'])
    expect(childKinds(
      revision.projection('revised').markdown.root.childAt(0)
    )).toEqual(['text', 'strong'])
  })

  it('does not close emphasis on a marker owned by inline code', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('*a {++`*`*++}'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const revisedParagraph = revision.projection('revised').markdown.root.childAt(0)
    expect(childKinds(revisedParagraph)).toEqual(['emphasis'])
    expect(childKinds(revisedParagraph.childAt(0))).toEqual([
      'text',
      'inline-code'
    ])
  })

  it('does not match an outer opener to a delimiter inside a link label', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('*[bar{++*++}](/url)'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const revisedParagraph = revision.projection('revised').markdown.root.childAt(0)
    expect(childKinds(revisedParagraph)).toEqual(['text', 'link'])
    expect(childKinds(revisedParagraph.childAt(1))).toEqual(['text'])
  })

  it('carries delimiter state across continuation lines in one list item', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{++- *foo\n  bar*++}'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const markdown = revision.projection('revised').markdown
    const paragraph = markdown.root.childAt(0).childAt(0).childAt(0)
    expect(paragraph.kind).toBe('paragraph')
    expect(childKinds(paragraph)).toEqual(['emphasis'])
    expect(childKinds(paragraph.childAt(0))).toEqual([
      'text',
      'soft-break',
      'text'
    ])
  })

  it('supports GFM single-tilde strikethrough across a CM boundary', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('~foo{++ bar++}~'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(childKinds(
      revision.projection('original').markdown.root.childAt(0)
    )).toEqual(['strikethrough'])
    expect(childKinds(
      revision.projection('revised').markdown.root.childAt(0)
    )).toEqual(['strikethrough'])
  })

  it('does not split triple-tilde runs into strikethrough delimiters', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{++This will ~~~not~~~ strike.++}'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(childKinds(
      revision.projection('revised').markdown.root.childAt(0)
    )).toEqual(['text'])
  })
})

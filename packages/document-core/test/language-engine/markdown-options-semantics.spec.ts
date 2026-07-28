import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type MarkdownNode,
  type MarkdownOptionsV1,
  type ParseConfiguration
} from '@marktext/document-core'

const DEFAULT_OPTIONS: MarkdownOptionsV1 = {
  schema: 'markdown-options-1',
  gfm: true,
  frontMatter: true,
  math: true,
  gitLabMath: false,
  footnotes: false,
  subscriptAndSuperscript: false
}

function open(source: string, options: Partial<MarkdownOptionsV1>): MarkdownNode {
  const configuration: ParseConfiguration = {
    criticMarkupProfile: 'marktext-profile-1',
    markdownProfile: 'markdown-profile-1',
    markdownOptions: { ...DEFAULT_OPTIONS, ...options },
    liveHtmlSafetyProfile: 'live-html-sanitized-v1',
    executionBudget: {
      limitsProfile: 'desktop-v1',
      accountingSchema: 'syntax-accounting-1'
    }
  }
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    configuration
  )
  expect(revision.kind).toBe('complete')
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete option-semantics revision')
  }
  return revision.projection('revised').markdown.root
}

function childKinds(node: MarkdownNode): readonly string[] {
  return Array.from(
    { length: node.childCount },
    (_, ordinal) => node.childAt(ordinal).kind
  )
}

describe('MarkdownOptionsV1 public semantics', () => {
  it('math gates dollar inline and block syntax', () => {
    const source = '$x$ and tail\n\n$$\ny\n$$\n'
    const enabled = open(source, { math: true })
    expect(childKinds(enabled)).toEqual(['paragraph', 'math-block'])
    expect(childKinds(enabled.childAt(0))).toEqual(['inline-math', 'text'])
    expect(enabled.childAt(0).childAt(0).attributes).toEqual({
      content: 'x',
      delimiterLength: 1,
      contentStart: 1,
      contentEnd: 2
    })
    expect(enabled.childAt(1).attributes).toEqual({
      content: 'y\n',
      contentStart: 17,
      contentEnd: 19,
      syntax: 'dollar'
    })

    const disabled = open(source, { math: false })
    expect(childKinds(disabled)).toEqual(['paragraph', 'paragraph'])
    expect(childKinds(disabled.childAt(0))).toEqual(['text'])
  })

  it('gitLabMath alone controls math-fence promotion', () => {
    const source = '```math\nx+y\n```\n'
    expect(childKinds(open(source, {
      math: true,
      gitLabMath: false
    }))).toEqual(['code-block'])
    const enabled = open(source, {
      math: true,
      gitLabMath: true
    })
    expect(childKinds(enabled)).toEqual(['math-block'])
    expect(enabled.childAt(0).attributes).toEqual({
      content: 'x+y\n',
      contentStart: 8,
      contentEnd: 12,
      syntax: 'fenced'
    })
    expect(childKinds(open(source, {
      math: false,
      gitLabMath: true
    }))).toEqual(['code-block'])
  })

  it('footnotes gates reference and definition syntax', () => {
    const source = 'note[^n]\n\n[^n]: body\n'
    const disabled = open(source, { footnotes: false })
    expect(childKinds(disabled)).toEqual(['paragraph', 'paragraph'])
    expect(childKinds(disabled.childAt(0))).toEqual(['text'])

    const enabled = open(source, { footnotes: true })
    expect(childKinds(enabled)).toEqual(['paragraph', 'footnote-definition'])
    expect(childKinds(enabled.childAt(0))).toEqual([
      'text',
      'footnote-reference'
    ])
    const definition = enabled.childAt(1)
    expect(definition.attributes).toEqual({
      label: 'n',
      labelStart: 12,
      labelEnd: 13,
      bodyStart: 16,
      bodyEnd: 20,
      content: 'body'
    })
    expect(childKinds(definition)).toEqual(['paragraph'])
    expect(childKinds(definition.childAt(0))).toEqual(['text'])
    expect(definition.childAt(0).childAt(0).range).toEqual({
      start: 16,
      end: 20
    })
  })

  it('subscriptAndSuperscript gates both paired inline forms', () => {
    const source = 'H~2~O and 2^n^\n'
    const disabled = open(source, { subscriptAndSuperscript: false })
    expect(childKinds(disabled.childAt(0))).toEqual([
      'text',
      'strikethrough',
      'text'
    ])

    const enabled = open(source, { subscriptAndSuperscript: true })
    expect(childKinds(enabled.childAt(0))).toEqual([
      'text',
      'subscript',
      'text',
      'superscript'
    ])
  })

  it('gfm alone emits tagfilter applicability on disallowed HTML atoms', () => {
    const source = 'a <title> b\n'
    const enabled = open(source, { gfm: true }).childAt(0).childAt(1)
    expect(enabled).toMatchObject({
      kind: 'inline-html',
      attributes: {
        content: '<title>',
        contentStart: 2,
        contentEnd: 9,
        gfmTagFilter: true
      }
    })
    const disabled = open(source, { gfm: false }).childAt(0).childAt(1)
    expect(disabled.kind).toBe('inline-html')
    expect(disabled.attributes['gfmTagFilter']).toBeUndefined()
  })

  it('resolves single and double tilde forms from both grammar switches', () => {
    const source = '~one~ and ~~two~~\n'

    expect(childKinds(open(source, {
      gfm: false,
      subscriptAndSuperscript: false
    }).childAt(0))).toEqual(['text'])

    expect(childKinds(open(source, {
      gfm: true,
      subscriptAndSuperscript: false
    }).childAt(0))).toEqual([
      'strikethrough',
      'text',
      'strikethrough'
    ])

    expect(childKinds(open(source, {
      gfm: false,
      subscriptAndSuperscript: true
    }).childAt(0))).toEqual([
      'subscript',
      'text'
    ])

    expect(childKinds(open(source, {
      gfm: true,
      subscriptAndSuperscript: true
    }).childAt(0))).toEqual([
      'subscript',
      'text',
      'strikethrough'
    ])
  })
})

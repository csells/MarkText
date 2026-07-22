import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
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

describe('LanguageEngine.open Markdown literals', () => {
  it('does not recognize CriticMarkup inside an inline code span', () => {
    const sourceText = '`{++literal++}`'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toEqual([])
    expect(revision.projection('original').source).toBe(sourceText)
    expect(revision.projection('revised').source).toBe(sourceText)
  })

  it('does not let a containing-arm literal erase its enclosing closer', () => {
    const sourceText = '{++`x ++} y` z++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      {
        kind: 'addition',
        range: { start: 0, end: 9 },
        markers: {
          open: { start: 0, end: 3 },
          close: { start: 6, end: 9 }
        },
        arms: [{ range: { start: 3, end: 6 }, children: [] }]
      }
    ])
    expect(revision.diagnostics.count).toBe(1)
    expect(revision.diagnostics.at(0)).toMatchObject({
      code: 'CM_UNMATCHED_CLOSER',
      range: { start: 14, end: 17 }
    })
    expect(revision.projection('original').source).toBe(' y` z++}')
    expect(revision.projection('revised').source).toBe('`x  y` z++}')
  })

  it('does not recognize CriticMarkup inside a fenced code block', () => {
    const sourceText = '```\n{--literal--}\n```'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toEqual([])
    expect(revision.projection('original').source).toBe(sourceText)
    expect(revision.projection('revised').source).toBe(sourceText)
  })

  it('recognizes tilde fences without depending on inline-code delimiters', () => {
    const sourceText = '~~~text\n{==literal==}\n~~~'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toEqual([])
    expect(revision.projection('original').source).toBe(sourceText)
    expect(revision.projection('revised').source).toBe(sourceText)
  })

  it('treats one leading U+FEFF as virtual trivia before a fence', () => {
    const sourceText = '\uFEFF~~~\n{++literal++}\n~~~\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toEqual([])
    expect(revision.projection('original').source).toBe(sourceText)
    expect(revision.projection('revised').source).toBe(sourceText)
  })

  it('authenticates a tilde fence inside a block quote container', () => {
    const sourceText = '> ~~~\n> {++literal++}\n> ~~~\n\n{++visible++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 29, end: 42 } }
    ])
    expect(revision.projection('original').source).toBe(
      '> ~~~\n> {++literal++}\n> ~~~\n\n'
    )
    expect(revision.projection('revised').source).toBe(
      '> ~~~\n> {++literal++}\n> ~~~\n\nvisible'
    )
  })

  it('ends a quoted fence when its block quote container ends', () => {
    const sourceText = '> ```\n> code\n{++active++}\n```\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 13, end: 25 } }
    ])
    expect(revision.ownership.ownerAt(15)).toMatchObject({
      owner: { kind: 'critic-marker', form: 'addition', role: 'open' }
    })
    expect(revision.projection('original').source).toBe('> ```\n> code\n\n```\n')
    expect(revision.projection('revised').source).toBe('> ```\n> code\nactive\n```\n')
  })

  it('authenticates a tilde fence inside a list container', () => {
    const sourceText = '- ~~~\n  {++literal++}\n  ~~~\n\n{++visible++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 29, end: 42 } }
    ])
  })

  it('carries nested-list container state through a fenced code block', () => {
    const sourceText = '- - ~~~\n    {++literal++}\n    ~~~\n\n{++visible++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 35, end: 48 } }
    ])
  })

  it('matches an inherited list item inside its enclosing block quote', () => {
    const sourceText =
      '> - ~~~\n' +
      '>   {++literal++}\n' +
      '>   ~~~\n' +
      '\n' +
      '{--visible--}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'deletion', range: { start: 35, end: 48 } }
    ])
    expect(revision.ownership.ownerAt(12).owner).toEqual({
      kind: 'markdown-literal',
      provider: 'fenced-code',
      ownerRange: { start: 4, end: 34 }
    })
  })

  it('does not let an ordered list starting at two interrupt a paragraph', () => {
    const sourceText =
      'paragraph\n2. ```\n{++active++}\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 17, end: 29 } }
    ])
    expect(revision.ownership.ownerAt(13).owner).toEqual({ kind: 'markdown-text' })
    expect(revision.projection('original').source).toBe(
      'paragraph\n2. ```\n\n'
    )
    expect(revision.projection('revised').source).toBe(
      'paragraph\n2. ```\nactive\n'
    )
  })

  it('does not recognize CriticMarkup inside an indented code block', () => {
    const sourceText = '    {==literal==}\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toEqual([])
    expect(revision.projection('original').source).toBe(sourceText)
    expect(revision.projection('revised').source).toBe(sourceText)
  })

  it('allows indented code immediately after a closed heading block', () => {
    const sourceText = '# h\n    {++literal++}\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toEqual([])
    expect(revision.ownership.ownerAt(8)).toMatchObject({
      owner: {
        kind: 'markdown-literal',
        provider: 'indented-code',
        ownerRange: { start: 4, end: 22 }
      }
    })
    expect(revision.projection('original').source).toBe(sourceText)
    expect(revision.projection('revised').source).toBe(sourceText)
  })

  it('recognizes four-space indented code at a CM arm virtual BOL', () => {
    const sourceText = '{++    {--literal--}++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', arms: [{ children: [] }] }
    ])
    expect(revision.projection('original').source).toBe('')
    expect(revision.projection('revised').source).toBe('    {--literal--}')
  })

  it('does not recognize CriticMarkup inside a raw HTML block', () => {
    const sourceText = '<script>\n{++literal++}\n</script>'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toEqual([])
    expect(revision.projection('original').source).toBe(sourceText)
    expect(revision.projection('revised').source).toBe(sourceText)
  })

  it('accepts end-of-line after a type-1 HTML block opener', () => {
    const sourceText = '<script\n{++literal++}\n</script>'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toEqual([])
    expect(revision.projection('original').source).toBe(sourceText)
    expect(revision.projection('revised').source).toBe(sourceText)
  })

  it('ends a type-1 HTML block at any type-1 raw end tag', () => {
    const sourceText =
      '<script>\n{++literal++}\n</style>\nout {++active++}\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 36, end: 48 } }
    ])
    expect(revision.projection('original').source).toBe(
      '<script>\n{++literal++}\n</style>\nout \n'
    )
    expect(revision.projection('revised').source).toBe(
      '<script>\n{++literal++}\n</style>\nout active\n'
    )
  })

  it('requires the case-sensitive CDATA HTML block opener', () => {
    const sourceText = '<![cdata[\n{++active++}\n]]>'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 10, end: 22 } }
    ])
    expect(revision.projection('original').source).toBe('<![cdata[\n\n]]>')
    expect(revision.projection('revised').source).toBe('<![cdata[\nactive\n]]>')
  })

  it('accepts any ASCII letter after a type-4 HTML declaration opener', () => {
    const sourceText = '<!abc\n{++literal++}\n>'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toEqual([])
    expect(revision.ownership.ownerAt(6)).toMatchObject({
      owner: {
        kind: 'markdown-literal',
        provider: 'html-block',
        ownerRange: { start: 0, end: 21 }
      }
    })
    expect(revision.projection('original').source).toBe(sourceText)
    expect(revision.projection('revised').source).toBe(sourceText)
  })

  it('ends an unclosed HTML block when its block quote container ends', () => {
    const sourceText = '> <!--\n> {++literal++}\noutside {++active++}\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 31, end: 43 } }
    ])
    expect(revision.ownership.ownerAt(10)).toMatchObject({
      owner: {
        kind: 'markdown-literal',
        provider: 'html-block',
        ownerRange: { start: 0, end: 23 }
      }
    })
    expect(revision.projection('original').source).toBe(
      '> <!--\n> {++literal++}\noutside \n'
    )
    expect(revision.projection('revised').source).toBe(
      '> <!--\n> {++literal++}\noutside active\n'
    )
  })

  it('authenticates a CommonMark type-7 custom HTML block through its blank line', () => {
    const sourceText = '<custom>\n{++literal++}\n</custom>\n\n{++visible++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 34, end: 47 } }
    ])
    expect(revision.projection('original').source).toBe(
      '<custom>\n{++literal++}\n</custom>\n\n'
    )
    expect(revision.projection('revised').source).toBe(
      '<custom>\n{++literal++}\n</custom>\n\nvisible'
    )
  })

  it('allows a type-7 HTML block after a closed heading without a blank line', () => {
    const sourceText = '# h\n<custom>\n{++literal++}\n\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toEqual([])
    expect(revision.ownership.ownerAt(15)).toMatchObject({
      owner: {
        kind: 'markdown-literal',
        provider: 'html-block',
        ownerRange: { start: 4, end: 27 }
      }
    })
    expect(revision.projection('original').source).toBe(sourceText)
    expect(revision.projection('revised').source).toBe(sourceText)
  })

  it('does not accept a bare slash after a type-6 HTML block tag name', () => {
    const sourceText = '<div/x\n{++active++}\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      {
        kind: 'addition',
        range: { start: 7, end: 19 },
        markers: {
          open: { start: 7, end: 10 },
          close: { start: 16, end: 19 }
        }
      }
    ])
    expect(revision.projection('original').source).toBe('<div/x\n\n')
    expect(revision.projection('revised').source).toBe('<div/x\nactive\n')
  })

  it('does not let HTML-looking code content swallow text after its fence', () => {
    const sourceText = '```\n<div>\n```\n{++visible++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 14, end: 27 } }
    ])
    expect(revision.projection('original').source).toBe('```\n<div>\n```\n')
    expect(revision.projection('revised').source).toBe('```\n<div>\n```\nvisible')
  })

  it('keeps inline HTML tag and attribute source literal while leaving visible prose active', () => {
    const sourceText = '<span title="{--literal--}">ok</span> {++visible++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(
      revision.criticMarkup.roots.map((node) => ({ kind: node.kind, range: node.range }))
    ).toEqual([{ kind: 'addition', range: { start: 38, end: 51 } }])
    expect(revision.projection('original').source).toBe(
      '<span title="{--literal--}">ok</span> '
    )
    expect(revision.projection('revised').source).toBe(
      '<span title="{--literal--}">ok</span> visible'
    )
  })

  it('does not authenticate an escaped inline HTML opener', () => {
    const sourceText = String.raw`\<span title="{++active++}">`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 14, end: 26 } }
    ])
    expect(revision.projection('original').source).toBe(String.raw`\<span title="">`)
    expect(revision.projection('revised').source).toBe(
      String.raw`\<span title="active">`
    )
  })

  it('does not authenticate an inline HTML tag with invalid attribute syntax', () => {
    const sourceText = '<x @="{++active++}">'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 6, end: 18 } }
    ])
    expect(revision.projection('original').source).toBe('<x @="">')
    expect(revision.projection('revised').source).toBe('<x @="active">')
  })

  it('does not recognize CriticMarkup inside an autolink target', () => {
    const sourceText = '<https://example.test/{++literal++}>'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toEqual([])
    expect(revision.projection('original').source).toBe(sourceText)
    expect(revision.projection('revised').source).toBe(sourceText)
  })

  it('keeps link destinations and titles literal but recognizes CM in visible labels', () => {
    const sourceText = '[label {++visible++}](https://e.test/{--literal--} "{>>title<<}")'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(
      revision.criticMarkup.roots.map((node) => ({ kind: node.kind, range: node.range }))
    ).toEqual([{ kind: 'addition', range: { start: 7, end: 20 } }])
    expect(revision.projection('original').source).toBe(
      '[label ](https://e.test/{--literal--} "{>>title<<}")'
    )
    expect(revision.projection('revised').source).toBe(
      '[label visible](https://e.test/{--literal--} "{>>title<<}")'
    )
  })

  it('keeps an outer link opener active after resolving a nested image', () => {
    const sourceText = '[outer ![inner](in)](out/{++literal++})'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toEqual([])
    expect(revision.ownership.ownerAt(25)).toEqual({
      range: { start: 20, end: 39 },
      owner: {
        kind: 'markdown-literal',
        provider: 'link-destination',
        ownerRange: { start: 20, end: 39 }
      }
    })
    expect(revision.projection('original').source).toBe(sourceText)
    expect(revision.projection('revised').source).toBe(sourceText)
  })

  it('deactivates an outer inline-link opener after resolving a nested reference link', () => {
    const sourceText =
      '[outer [inner][ref]](out/{++active++})\n\n' +
      '[ref]: /in'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      {
        kind: 'addition',
        range: { start: 25, end: 37 },
        markers: {
          open: { start: 25, end: 28 },
          close: { start: 34, end: 37 }
        }
      }
    ])
    expect(revision.projection('original').source).toBe(
      '[outer [inner][ref]](out/)\n\n[ref]: /in'
    )
    expect(revision.projection('revised').source).toBe(
      '[outer [inner][ref]](out/active)\n\n[ref]: /in'
    )
    const revised = revision.projection('revised')
    expect(
      revised.markdown
        .nodeAt(revised.source.indexOf('inner'), 'next')
        .map((node) => node.kind)
    ).toEqual(['document', 'paragraph', 'link', 'text'])
  })

  it('coalesces CRLF across a zero-width accepted CM carrier', () => {
    const sourceText = '[x\r{++++}\n](url/{++literal++})'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 3, end: 9 } }
    ])
    expect(revision.ownership.ownerAt(16)).toEqual({
      range: { start: 11, end: 30 },
      owner: {
        kind: 'markdown-literal',
        provider: 'link-destination',
        ownerRange: { start: 11, end: 30 }
      }
    })
    expect(revision.projection('original').source).toBe('[x\r\n](url/{++literal++})')
    expect(revision.projection('revised').source).toBe('[x\r\n](url/{++literal++})')
  })

  it('does not authenticate a link destination whose label syntax is inline code', () => {
    const sourceText = '`[x](` {++visible++})'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 7, end: 20 } }
    ])
    expect(revision.projection('original').source).toBe('`[x](` )')
    expect(revision.projection('revised').source).toBe('`[x](` visible)')
  })

  it('does not authenticate a destination/title shape that is not a valid link', () => {
    const sourceText = '[x](dest "{++active++}" junk)'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 10, end: 22 } }
    ])
    expect(revision.projection('original').source).toBe('[x](dest "" junk)')
    expect(revision.projection('revised').source).toBe('[x](dest "active" junk)')
  })

  it('requires an inline-link destination to begin immediately after its label', () => {
    const sourceText = '[x] ({++active++})'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 5, end: 17 } }
    ])
    expect(revision.projection('original').source).toBe('[x] ()')
    expect(revision.projection('revised').source).toBe('[x] (active)')
  })

  it('keeps reference and footnote definitions literal', () => {
    const sourceText =
      '[ref]: https://e.test/{++literal++} "{--title--}"\n[^note]: {==footnote==}\n{++visible++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(
      revision.criticMarkup.roots.map((node) => ({ kind: node.kind, range: node.range }))
    ).toEqual([{ kind: 'addition', range: { start: 74, end: 87 } }])
    expect(revision.projection('original').source).toBe(sourceText.slice(0, 74))
    expect(revision.projection('revised').source).toBe(`${sourceText.slice(0, 74)}visible`)
  })

  it('keeps a multiline reference destination and title in one definition owner', () => {
    const sourceText = '[ref]:\n  /url\n  "title {++literal++}"\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toEqual([])
    expect(revision.ownership.ownerAt(23)).toEqual({
      range: { start: 14, end: 37 },
      owner: {
        kind: 'markdown-literal',
        provider: 'definition',
        ownerRange: { start: 0, end: 38 }
      }
    })
    expect(revision.projection('original').source).toBe(sourceText)
    expect(revision.projection('revised').source).toBe(sourceText)
  })

  it('does not authenticate a reference definition with an empty label', () => {
    const sourceText = '[]: {++active++}\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 4, end: 16 } }
    ])
    expect(revision.projection('original').source).toBe('[]: \n')
    expect(revision.projection('revised').source).toBe('[]: active\n')
  })

  it('does not authenticate a reference definition with an invalid destination tail', () => {
    const sourceText = '[ref]: a b {++active++}\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 11, end: 23 } }
    ])
    expect(revision.projection('original').source).toBe('[ref]: a b \n')
    expect(revision.projection('revised').source).toBe('[ref]: a b active\n')
  })

  it('authenticates YAML front matter only as a root literal block', () => {
    const sourceText = '---\ntitle: {++literal++}\n---\n{++visible++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(
      revision.criticMarkup.roots.map((node) => ({ kind: node.kind, range: node.range }))
    ).toEqual([{ kind: 'addition', range: { start: 29, end: 42 } }])
    expect(revision.projection('original').source).toBe(sourceText.slice(0, 29))
    expect(revision.projection('revised').source).toBe(`${sourceText.slice(0, 29)}visible`)
  })

  it('does not recognize CriticMarkup inside inline math', () => {
    const sourceText = 'before $x {++literal++}$ after {++visible++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(
      revision.criticMarkup.roots.map((node) => ({ kind: node.kind, range: node.range }))
    ).toEqual([{ kind: 'addition', range: { start: 31, end: 44 } }])
    expect(revision.projection('original').source).toBe(sourceText.slice(0, 31))
    expect(revision.projection('revised').source).toBe(`${sourceText.slice(0, 31)}visible`)
  })

  it('does not pair math delimiters across independently accepted CM carriers', () => {
    const sourceText = '{++$++}x{++$++}\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      { kind: 'addition', range: { start: 0, end: 7 } },
      { kind: 'addition', range: { start: 8, end: 15 } }
    ])
    expect(revision.projection('original').source).toBe('x\n')
    expect(revision.projection('revised').source).toBe('$x$\n')
  })

  it('keeps three sibling CM carriers independent when their payloads form math', () => {
    const sourceText = '{++$++}{++x++}{++$++}\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(
      revision.criticMarkup.roots.map((node) => ({ kind: node.kind, range: node.range }))
    ).toEqual([
      { kind: 'addition', range: { start: 0, end: 7 } },
      { kind: 'addition', range: { start: 7, end: 14 } },
      { kind: 'addition', range: { start: 14, end: 21 } }
    ])
    expect(revision.projection('original').source).toBe('\n')
    expect(revision.projection('revised').source).toBe('$x$\n')
  })

  it('treats a Comment payload as an independent literal-aware subdocument', () => {
    const sourceText = '{>>note `{++literal++}`<<}\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      {
        kind: 'comment',
        range: { start: 0, end: 26 },
        arms: [{ range: { start: 3, end: 23 }, children: [] }]
      }
    ])
    expect(revision.projection('original').source).toBe('\n')
    expect(revision.projection('revised').source).toBe('\n')
  })

  it('gives a root CM arm its own BOF lane for front matter', () => {
    const sourceText = '{++---\ntitle: {--literal--}\n---++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toHaveLength(1)
    expect(revision.criticMarkup.roots[0]).toMatchObject({
      kind: 'addition',
      range: { start: 0, end: 34 },
      arms: [{ range: { start: 3, end: 31 }, children: [] }]
    })
    expect(revision.projection('original').source).toBe('')
    expect(revision.projection('revised').source).toBe('---\ntitle: {--literal--}\n---')
  })

  it('parses both root Substitution arms as independent BOF lanes', () => {
    const sourceText = '{~~---\na: {++oldlit++}\n---~>---\nb: {--newlit--}\n---~~}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toHaveLength(1)
    expect(revision.criticMarkup.roots[0]).toMatchObject({
      kind: 'substitution',
      range: { start: 0, end: 54 },
      markers: {
        separator: { start: 26, end: 28 }
      },
      arms: [
        { name: 'old', range: { start: 3, end: 26 }, children: [] },
        { name: 'new', range: { start: 28, end: 51 }, children: [] }
      ]
    })
    expect(revision.projection('original').source).toBe('---\na: {++oldlit++}\n---')
    expect(revision.projection('revised').source).toBe('---\nb: {--newlit--}\n---')
  })

  it('uses an exact fence closer before a Substitution boundary in each arm lane', () => {
    const oldArm = '~~~\n{++oldlit++}\n~~~'
    const newArm = '~~~\n{--newlit--}\n~~~'
    const sourceText = `{~~${oldArm}~>${newArm}~~}`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      {
        kind: 'substitution',
        arms: [
          { name: 'old', children: [] },
          { name: 'new', children: [] }
        ]
      }
    ])
    expect(revision.projection('original').source).toBe(oldArm)
    expect(revision.projection('revised').source).toBe(newArm)
  })

  it('ends a raw HTML owner before an eligible Substitution arm boundary', () => {
    const oldArm = '<!--\n{++literal++}\n-->'
    const sourceText = `{~~${oldArm}~>new~~}`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      {
        kind: 'substitution',
        arms: [{ name: 'old', children: [] }, { name: 'new', children: [] }]
      }
    ])
    expect(revision.projection('original').source).toBe(oldArm)
    expect(revision.projection('revised').source).toBe('new')
  })

  it('treats an arm boundary at BOL as EOF for a type-7 HTML block', () => {
    const oldArm = '<custom>\n{++literal++}\n'
    const sourceText = `{~~${oldArm}~>new~~}`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots).toMatchObject([
      {
        kind: 'substitution',
        arms: [{ name: 'old', children: [] }, { name: 'new', children: [] }]
      }
    ])
    expect(revision.projection('original').source).toBe(oldArm)
    expect(revision.projection('revised').source).toBe('new')
  })

  it('keeps a same-line separator literal inside a type-7 HTML body', () => {
    const oldArm = '<custom>\ntext ~> literal\n'
    const sourceText = `{~~${oldArm}~>new~~}`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.criticMarkup.roots[0]).toMatchObject({
      kind: 'substitution',
      arms: [
        { name: 'old', range: { start: 3, end: 28 }, children: [] },
        { name: 'new', children: [] }
      ]
    })
    expect(revision.projection('original').source).toBe(oldArm)
    expect(revision.projection('revised').source).toBe('new')
  })
})

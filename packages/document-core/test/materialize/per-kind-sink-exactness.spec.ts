import { describe, expect, it } from 'vitest'
import { createDocumentSession } from '../../src/documentSession.js'
import { createLanguageEngine } from '../../src/languageEngine.js'
import { consumeTrustedHtml } from '../../src/materialize/trustedHtml.js'
import {
  materializeClipboardConsumer,
  materializeStaticConsumer,
  viewLength,
  PROFILE1_KIND_SINK_EXACTNESS,
  type KindSinkExactness
} from '../../src/materialize/consumerPolicy.js'
import {
  materializeCount,
  materializeSearchText
} from '../../src/materialize/textMaterializers.js'
import type {
  CompleteDocumentRevision,
  ParseConfiguration,
  Profile1SyntaxNodeKind
} from '../../src/revision.js'
import { createSourceSnapshot } from '../../src/sourceSnapshot.js'

function configuration(footnotes: boolean): ParseConfiguration {
  return {
    criticMarkupProfile: 'marktext-profile-1',
    markdownProfile: 'markdown-profile-1',
    markdownOptions: {
      schema: 'markdown-options-1',
      gfm: true,
      frontMatter: true,
      math: true,
      gitLabMath: false,
      footnotes,
      subscriptAndSuperscript: true
    },
    liveHtmlSafetyProfile: 'live-html-sanitized-v1',
    executionBudget: {
      limitsProfile: 'desktop-v1',
      accountingSchema: 'syntax-accounting-1'
    }
  }
}

const STATIC_STRUCTURE = Object.freeze({
  headingAnchors: 'github-slug-v1' as const,
  tableOfContents: Object.freeze({ title: '', includeTopHeading: true })
})

// G16 / A41: the per-kind proof behind the section 8 exactness claim. Each
// construct row of PROFILE1_KIND_SINK_EXACTNESS is driven through all six
// sinks against its canonical snippet; the assertions below implement the
// claim vocabulary the table declares.
interface ConstructCase {
  readonly kind: Profile1SyntaxNodeKind
  readonly source: string
  /** Decoded payload text a projected-payload sink must carry. */
  readonly payloads?: readonly string[]
  /** Syntax spellings a projected-payload sink must never leak. */
  readonly syntax?: readonly string[]
  readonly htmlMustContain: readonly string[]
  readonly htmlMustNotContain?: readonly string[]
  readonly footnotes?: boolean
}

const CONSTRUCT_CORPUS: readonly ConstructCase[] = Object.freeze([
  {
    kind: 'paragraph',
    source: 'Just a paragraph.\n',
    htmlMustContain: ['<p>Just a paragraph.</p>']
  },
  {
    kind: 'heading',
    source: '## Heading text\n',
    htmlMustContain: ['<h2 id="heading-text">Heading text</h2>']
  },
  {
    kind: 'blockquote',
    source: '> quoted line\n',
    htmlMustContain: ['<blockquote>', '<p>quoted line</p>']
  },
  {
    kind: 'list',
    source: '- item one\n- item two\n',
    htmlMustContain: ['<ul>', '<li>item one</li>', '<li>item two</li>']
  },
  {
    kind: 'thematic-break',
    source: '***\n',
    htmlMustContain: ['<hr />']
  },
  {
    kind: 'soft-break',
    source: 'line one\nline two\n',
    htmlMustContain: ['<p>line one\nline two</p>']
  },
  {
    kind: 'hard-break',
    source: 'line one  \nline two\n',
    htmlMustContain: ['<p>line one<br />\nline two</p>']
  },
  {
    kind: 'emphasis',
    source: 'an *em* word\n',
    htmlMustContain: ['<em>em</em>']
  },
  {
    kind: 'strong',
    source: 'a **strong** word\n',
    htmlMustContain: ['<strong>strong</strong>']
  },
  {
    kind: 'strikethrough',
    source: 'a ~~gone~~ word\n',
    htmlMustContain: ['<del>gone</del>']
  },
  {
    kind: 'subscript',
    source: 'H~2~O\n',
    htmlMustContain: ['<sub>2</sub>']
  },
  {
    kind: 'superscript',
    source: 'x^2^\n',
    htmlMustContain: ['<sup>2</sup>']
  },
  {
    kind: 'link',
    source: '[label](https://example.com)\n',
    htmlMustContain: ['<a href="https://example.com">label</a>']
  },
  {
    kind: 'image',
    source: '![alt text](image.png)\n',
    htmlMustContain: ['<img src="image.png" alt="alt text" />']
  },
  {
    kind: 'inline-code',
    source: 'a `code` span\n',
    htmlMustContain: ['<code>code</code>']
  },
  {
    kind: 'code-block',
    source: '```js\nconst x = 1\n```\n',
    htmlMustContain: ['<pre><code class="language-js">const x = 1']
  },
  {
    // Raw HTML is transcribed exactly by canonical sinks and escaped, never
    // interpreted, by the sanitized HTML family.
    kind: 'inline-html',
    source: 'a <em>markup</em> b\n',
    htmlMustContain: ['&lt;em&gt;markup&lt;/em&gt;'],
    htmlMustNotContain: ['<em>markup</em>']
  },
  {
    kind: 'html-block',
    source: '<div>\nblock\n</div>\n',
    htmlMustContain: ['&lt;div&gt;', '&lt;/div&gt;'],
    htmlMustNotContain: ['<div>']
  },
  {
    kind: 'autolink',
    source: '<https://example.com>\n',
    htmlMustContain: [
      '<a href="https://example.com">https://example.com</a>'
    ]
  },
  {
    // The definition itself renders nothing; its destination is represented
    // through the reference that resolves against it.
    kind: 'definition',
    source: '[ref]: https://example.com\n\n[ref]\n',
    htmlMustContain: ['<a href="https://example.com">ref</a>']
  },
  {
    kind: 'front-matter',
    source: '---\ntitle: T\n---\n\nbody\n',
    htmlMustContain: ['<pre class="front-matter">', '<p>body</p>']
  },
  {
    kind: 'inline-math',
    source: 'a $x^2$ b\n',
    htmlMustContain: ['<span class="math-inline">x^2</span>']
  },
  {
    kind: 'math-block',
    source: '$$\nx^2\n$$\n',
    htmlMustContain: ['<pre class="math-block">']
  },
  {
    kind: 'diagram',
    source: '```mermaid\ngraph TD\n```\n',
    htmlMustContain: ['<pre class="diagram" data-language="mermaid">']
  },
  {
    kind: 'table',
    source: '| a | b |\n| - | - |\n| 1 | 2 |\n',
    htmlMustContain: ['<table>', '<th>a</th>', '<td>1</td>']
  },
  {
    kind: 'footnote-reference',
    source: 'a[^1]\n\n[^1]: note text\n',
    footnotes: true,
    htmlMustContain: ['<sup class="footnote-ref">']
  },
  {
    kind: 'footnote-definition',
    source: 'a[^1]\n\n[^1]: note text\n',
    footnotes: true,
    htmlMustContain: ['<li id="fn-1">', 'note text']
  },
  {
    kind: 'addition',
    source: 'a {++added++} z\n',
    payloads: ['added'],
    syntax: ['{++', '++}'],
    htmlMustContain: ['<ins>added</ins>'],
    htmlMustNotContain: ['{++', '++}']
  },
  {
    kind: 'deletion',
    source: 'a {--removed--} z\n',
    payloads: ['removed'],
    syntax: ['{--', '--}'],
    htmlMustContain: ['<del>removed</del>'],
    htmlMustNotContain: ['{--', '--}']
  },
  {
    kind: 'substitution',
    source: 'a {~~old~>new~~} z\n',
    payloads: ['old', 'new'],
    syntax: ['{~~', '~>', '~~}'],
    htmlMustContain: ['<del>old</del><ins>new</ins>'],
    htmlMustNotContain: ['{~~', '~>', '~~}']
  },
  {
    kind: 'comment',
    source: 'a {>>note<<} z\n',
    payloads: ['note'],
    syntax: ['{>>', '<<}'],
    htmlMustContain: [
      'role="doc-noteref"',
      '<aside role="note"',
      '<p>note</p>'
    ],
    htmlMustNotContain: ['{>>', '<<}']
  },
  {
    kind: 'highlight',
    source: 'a {==marked==} z\n',
    payloads: ['marked'],
    syntax: ['{==', '==}'],
    htmlMustContain: ['<mark>marked</mark>'],
    htmlMustNotContain: ['{==', '==}']
  }
])

interface HostileCase {
  readonly name: string
  readonly source: string
  readonly htmlMustContain: readonly string[]
  readonly htmlMustNotContain: readonly string[]
}

const HOSTILE_CORPUS: readonly HostileCase[] = Object.freeze([
  {
    name: 'script through inline HTML',
    source: 'a <script>alert(1)</script> b\n',
    htmlMustContain: ['&lt;script&gt;alert(1)&lt;/script&gt;'],
    htmlMustNotContain: ['<script']
  },
  {
    name: 'javascript link destination',
    source: '[x](javascript:alert(1))\n',
    htmlMustContain: ['<a href="">x</a>'],
    htmlMustNotContain: ['javascript:']
  },
  {
    name: 'event handler through an HTML block',
    source: '<img src=x onerror=alert(1)>\n',
    htmlMustContain: ['&lt;img src=x onerror=alert(1)&gt;'],
    htmlMustNotContain: ['<img']
  },
  {
    name: 'script through a Comment payload',
    source: 'a {>><script>bad()</script><<} z\n',
    htmlMustContain: ['&lt;script&gt;bad()&lt;/script&gt;'],
    htmlMustNotContain: ['<script']
  }
])

const HTML_SINKS = [
  { consumer: 'static-html', sink: 'static' },
  { consumer: 'styled-html', sink: 'styled' },
  { consumer: 'pdf', sink: 'pdf' },
  { consumer: 'print', sink: 'print' }
] as const

function completeParse(
  source: string,
  footnotes = false
): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    configuration(footnotes)
  )
  if (revision.kind !== 'complete') {
    throw new Error(`Expected a complete revision, got ${revision.kind}`)
  }
  return revision
}

function syntaxKinds(
  revision: CompleteDocumentRevision
): ReadonlySet<string> {
  const kinds = new Set<string>()
  for (let ordinal = 0; ordinal < revision.syntax.nodeCount; ordinal += 1) {
    kinds.add(revision.syntax.nodeAt(ordinal).kind)
  }
  return kinds
}

async function liveText(source: string, footnotes = false): Promise<string> {
  const session = await createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: configuration(footnotes)
  })
  const snapshot = session.snapshot()
  if (snapshot.kind !== 'complete') {
    throw new Error(`Expected a complete live snapshot, got ${snapshot.kind}`)
  }
  return snapshot.livePlan.runs.map((run) => run.text).join('')
}

function htmlOutputs(
  revision: CompleteDocumentRevision
): readonly Readonly<{ consumer: string; output: string }>[] {
  return HTML_SINKS.map((route) => ({
    consumer: route.consumer,
    output: consumeTrustedHtml(
      materializeStaticConsumer(revision, {
        view: 'markup',
        consumer: route.consumer,
        structure: STATIC_STRUCTURE
      }).html,
      route.sink
    )
  }))
}

function assertCanonicalSinks(
  revision: CompleteDocumentRevision,
  source: string,
  label: string,
  failures: string[]
): void {
  const searched = materializeSearchText(revision, 'markup').text
  if (searched !== source) {
    failures.push(`${label}: markup search text is not canonical`)
  }
  const counted = materializeCount(revision, 'markup')
  if (counted.codeUnits !== source.length) {
    failures.push(`${label}: count does not read canonical code units`)
  }
  const copied = materializeClipboardConsumer(revision, {
    view: 'markup',
    consumer: 'normal-copy',
    selection: { start: 0, end: viewLength(revision, 'markup') }
  })
  if (copied.kind !== 'clipboard-bundle') {
    failures.push(`${label}: normal copy did not produce a bundle`)
    return
  }
  if (copied.plainText !== source) {
    failures.push(`${label}: clipboard text/plain is not the canonical slice`)
  }
  if (copied.privateSource?.text !== source) {
    failures.push(`${label}: private source flavor is not the canonical slice`)
  }
}

describe('per-kind sink exactness matrix', () => {
  it('declares every Profile 1 syntax kind exactly once across construct, constituent, and root coverage', () => {
    const corpusKinds = new Set(CONSTRUCT_CORPUS.map((row) => row.kind))
    expect(corpusKinds.size).toBe(CONSTRUCT_CORPUS.length)
    const constructKinds = new Set<string>()
    for (const [kind, row] of Object.entries(PROFILE1_KIND_SINK_EXACTNESS)) {
      if (row.coverage === 'construct') {
        constructKinds.add(kind)
        continue
      }
      if (row.coverage === 'root') {
        expect(kind).toBe('document')
        continue
      }
      const owner = PROFILE1_KIND_SINK_EXACTNESS[row.of]
      expect(
        owner.coverage,
        `${kind} must be a constituent of a construct row`
      ).toBe('construct')
    }
    expect([...constructKinds].sort()).toEqual([...corpusKinds].sort())
  })

  it('proves every declared construct kind exact in all six sinks', async() => {
    const failures: string[] = []
    for (const row of CONSTRUCT_CORPUS) {
      const declared = PROFILE1_KIND_SINK_EXACTNESS[row.kind]
      if (declared.coverage !== 'construct') {
        failures.push(`${row.kind}: no construct row in the table`)
        continue
      }
      const claims: KindSinkExactness = declared.sinks
      const revision = completeParse(row.source, row.footnotes === true)
      if (revision.source.text !== row.source) {
        failures.push(`${row.kind}: source drift`)
        continue
      }
      if (!syntaxKinds(revision).has(row.kind)) {
        failures.push(`${row.kind}: snippet does not produce the kind`)
        continue
      }

      // text and clipboard: every construct row declares exact-canonical.
      if (claims.text !== 'exact-canonical' ||
        claims.clipboard !== 'exact-canonical') {
        failures.push(`${row.kind}: undeclared canonical text or clipboard`)
      }
      assertCanonicalSinks(revision, row.source, row.kind, failures)

      // live: the claim decides which shape the editable text must take.
      const live = await liveText(row.source, row.footnotes === true)
      if (claims.live === 'exact-canonical') {
        if (live !== row.source) {
          failures.push(`${row.kind}: live text is not canonical`)
        }
      } else {
        for (const payload of row.payloads ?? []) {
          const present = live.includes(payload)
          if (claims.live === 'projected-payload' && !present) {
            failures.push(`${row.kind}: live text lost payload ${payload}`)
          }
          if (claims.live === 'suppressed' && present) {
            failures.push(`${row.kind}: suppressed payload ${payload} leaked`)
          }
        }
        for (const spelling of row.syntax ?? []) {
          if (live.includes(spelling)) {
            failures.push(`${row.kind}: live text leaked ${spelling}`)
          }
        }
      }

      // HTML family: html, pdf, and print all declare semantic-html.
      if (claims.html !== 'semantic-html' ||
        claims.pdf !== 'semantic-html' ||
        claims.print !== 'semantic-html') {
        failures.push(`${row.kind}: undeclared semantic HTML family`)
      }
      for (const { consumer, output } of htmlOutputs(revision)) {
        for (const expected of row.htmlMustContain) {
          if (!output.includes(expected)) {
            failures.push(`${row.kind}/${consumer}: missing ${expected}`)
          }
        }
        for (const rejected of row.htmlMustNotContain ?? []) {
          if (output.includes(rejected)) {
            failures.push(`${row.kind}/${consumer}: leaked ${rejected}`)
          }
        }
      }
    }
    expect(failures).toEqual([])
  }, 60_000)

  it('proves every constituent kind through its owning construct row', () => {
    const failures: string[] = []
    for (const [kind, row] of Object.entries(PROFILE1_KIND_SINK_EXACTNESS)) {
      if (row.coverage !== 'constituent') {
        continue
      }
      const owner = CONSTRUCT_CORPUS.find((entry) => entry.kind === row.of)
      if (owner === undefined) {
        failures.push(`${kind}: owning construct ${row.of} has no snippet`)
        continue
      }
      const revision = completeParse(owner.source, owner.footnotes === true)
      if (!syntaxKinds(revision).has(kind)) {
        failures.push(`${kind}: not produced by the ${row.of} snippet`)
      }
    }
    expect(failures).toEqual([])
  })

  it('keeps hostile input inert in every HTML sink while canonical sinks stay byte-exact', () => {
    const failures: string[] = []
    for (const row of HOSTILE_CORPUS) {
      const revision = completeParse(row.source)
      assertCanonicalSinks(revision, row.source, row.name, failures)
      for (const { consumer, output } of htmlOutputs(revision)) {
        for (const expected of row.htmlMustContain) {
          if (!output.includes(expected)) {
            failures.push(`${row.name}/${consumer}: missing ${expected}`)
          }
        }
        for (const rejected of row.htmlMustNotContain) {
          if (output.includes(rejected)) {
            failures.push(`${row.name}/${consumer}: leaked ${rejected}`)
          }
        }
      }
    }
    expect(failures).toEqual([])
  })
})

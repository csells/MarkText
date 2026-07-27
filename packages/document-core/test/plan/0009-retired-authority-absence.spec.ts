import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  renderMarkdownHtml,
  type CompleteDocumentRevision,
  type ParseConfiguration
} from '@marktext/document-core'

interface RetiredAuthorityRow {
  readonly id: string
  readonly path: string
  readonly symbol: string
  readonly status: string
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const MANIFEST = resolve(REPO_ROOT, 'specs/migration/criticmarkup-retired-authority-deletion.tsv')
const HOSTILE_CONFIGURATION: ParseConfiguration = {
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

function completeHostileRevision(source: string): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    HOSTILE_CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('P9 hostile parser fact fixture must be complete')
  }
  return revision
}

function rows(): readonly RetiredAuthorityRow[] {
  const [headerLine, ...lines] = readFileSync(MANIFEST, 'utf8').trim().split(/\r?\n/)
  const header = headerLine?.split('\t') ?? []
  return Object.freeze(
    lines.map((line) => {
      const fields = line.split('\t')
      return Object.freeze(
        Object.fromEntries(header.map((name, index) => [name, fields[index] ?? '']))
      ) as unknown as RetiredAuthorityRow
    })
  )
}

function productionSources(): readonly string[] {
  const output = execFileSync(
    'rg',
    [
      '--files',
      'packages',
      '-g',
      '*.{ts,tsx,vue,js,mjs,cjs,css}',
      '-g',
      '!**/test/**',
      '-g',
      '!**/__tests__/**'
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  )
  return Object.freeze(output.trim().split('\n').filter(Boolean))
}

describe('plan 0009 retired authority deletion', () => {
  it('proves every retired authority seed absent and document-core solely authoritative', () => {
    const manifest = rows()
    expect(manifest).toHaveLength(8)
    for (const row of manifest) {
      expect(row.status, row.id).toBe('absent')
      expect(existsSync(resolve(REPO_ROOT, row.path)), row.path).toBe(false)
    }

    const forbidden = [
      'rebindCriticMarkupStateBindings',
      'weaveCriticSourceTrivia',
      'StateMutationCapture',
      'normalizeDeletedCommentAnchors',
      'CriticMarkupDocumentService',
      'parseCriticMarkupDocument',
      'nativeCriticMarkup',
      'getRecommendTitleFromMarkdownString',
      'mt::format-link-click',
      'FORMAT_LINK_CLICK',
      'FormatLinkPayload',
      'forkPlanOf',
      'DEFINITION_LIKE',
      ['json', 'change'].join('-')
    ]
    const survivingReferences = productionSources().flatMap((path) => {
      const source = readFileSync(resolve(REPO_ROOT, path), 'utf8')
      return forbidden
        .filter((symbol) => source.includes(symbol))
        .map((symbol) => `${path}:${symbol}`)
    })
    expect(survivingReferences).toEqual([])

    const parserFactConsumers = new Map([
      [
        'packages/document-core/src/view/markupRender.ts',
        'document.references'
      ],
      [
        'packages/document-core/src/materialize/htmlRender.ts',
        'document.references'
      ],
      [
        'packages/document-core/src/materialize/documentLink.ts',
        'document.references'
      ],
      [
        'packages/document-core/src/materialize/textMaterializers.ts',
        'document.references'
      ],
      [
        'packages/document-core/src/materialize/headingOutline.ts',
        'document.headings'
      ],
      [
        'packages/document-core/src/materialize/documentFacts.ts',
        'revised.markdown.headings'
      ],
      [
        'packages/document-core/src/materialize/consumerPolicy.ts',
        'parserHeadingAnchors'
      ],
      [
        'packages/document-core/src/materialize/trustedHtml.ts',
        'parserHeadingAnchors'
      ]
    ])
    for (const [path, authority] of parserFactConsumers) {
      const source = readFileSync(resolve(REPO_ROOT, path), 'utf8')
      expect(source, `${path} must consume ${authority}`)
        .toContain(authority)
      expect(
        source,
        `${path} must not guess reference definitions from source text`
      ).not.toMatch(
        /\/[^/\r\n]*(?:\\\]|\])(?:\\s\*?|\[(?: |\\t)+\]\*?):/
      )
      expect(
        source,
        `${path} must not construct a hidden definition recognizer`
      ).not.toMatch(
        /new\s+RegExp\s*\([^)\r\n]*(?:\\\]|\])[^)\r\n]*:/
      )
    }

    const hostile = completeHostileRevision(
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
    const hostileEdges = Array.from(
      { length: hostile.syntax.edgeCount },
      (_, ordinal) => hostile.syntax.edgeAt(ordinal)
    ).filter((edge) => edge.kind === 'reference')
    const headingSources: string[][] = []
    for (const view of ['original', 'revised'] as const) {
      const projected = hostile.projection(view)
      const references = projected.markdown.references
      const headings = projected.markdown.headings
      expect(references.definitionCount).toBe(2)
      expect(references.definitionForLabel('asset')?.destination)
        .toBe('/first.png')
      expect(references.linkCount).toBe(1)
      const image = references.linkAt(0)
      expect(image.node.kind).toBe('image')
      expect(hostileEdges).toContainEqual({
        kind: 'reference',
        from: image.node.nodeId,
        to: image.definition?.node.nodeId
      })
      expect(references.footnoteDefinitionCount).toBe(1)
      expect(references.footnoteReferenceCount).toBe(2)
      const resolvedFootnote = references.footnoteReferenceAt(0)
      const unresolvedFootnote = references.footnoteReferenceAt(1)
      expect(resolvedFootnote.definition).toBe(
        references.footnoteDefinitionForLabel('note')
      )
      expect(unresolvedFootnote.definition).toBeUndefined()
      expect(hostileEdges).toContainEqual({
        kind: 'reference',
        from: resolvedFootnote.node.nodeId,
        to: resolvedFootnote.definition?.node.nodeId
      })
      expect(hostileEdges.some(
        (edge) => edge.from === unresolvedFootnote.node.nodeId
      )).toBe(false)
      expect(headings.count).toBe(2)
      headingSources.push(Array.from(
        { length: headings.count },
        (_, ordinal) => {
          const node = headings.at(ordinal).node
          return projected.source.slice(node.range.start, node.range.end)
        }
      ))
    }
    expect(headingSources).toEqual([
      ['# Old', '# Shared ![image][asset] [missing]'],
      ['# Shared ![image][asset] [missing]', '# New']
    ])

    const projectedFootnotes = completeHostileRevision(
      'note[^note]\n\n' +
      '{~~[^note]: Old.\n~>[^note]: New.\n~~}'
    )
    const originalFootnote =
      projectedFootnotes.projection('original').markdown.references
    const revisedFootnote =
      projectedFootnotes.projection('revised').markdown.references
    expect(originalFootnote.footnoteReferenceAt(0).definition).toBe(
      originalFootnote.footnoteDefinitionAt(0)
    )
    expect(revisedFootnote.footnoteReferenceAt(0).definition).toBe(
      revisedFootnote.footnoteDefinitionAt(0)
    )
    expect(originalFootnote.footnoteDefinitionAt(0).node.nodeId).not.toBe(
      revisedFootnote.footnoteDefinitionAt(0).node.nodeId
    )

    const missingTargetRangeVariants = [
      [
        '{{--z--}++x++}\n\np{--\n\n--}[r]: /{++y++}',
        [
          ['original', '{z++x++}\n\np\n\n[r]: /{++y++}',
            '<p>{z++x++}</p>\n<p>p</p>\n'],
          ['revised', '\\{++x++}\n\np[r]: /\\{++y++\\}',
            '<p>{++x++}</p>\n<p>p[r]: /{++y++}</p>\n'],
          ['editing', '{z++x++}\n\np\n\n[r]: /{++y++}',
            '<p>{z++x++}</p>\n<p>p</p>\n']
        ]
      ],
      [
        'p{--\n\n--}[r]: /{++y++}',
        [
          ['original', 'p\n\n[r]: /{++y++}', '<p>p</p>\n'],
          ['revised', 'p[r]: /\\{++y++\\}',
            '<p>p[r]: /{++y++}</p>\n'],
          ['editing', 'p\n\n[r]: /{++y++}', '<p>p</p>\n']
        ]
      ],
      [
        '{~~old~>[x~~}]({++literal++})',
        [
          ['original', 'old]()', '<p>old]()</p>\n'],
          ['revised', '\\[x](literal)', '<p>[x](literal)</p>\n'],
          ['editing', 'old\\[x](literal)', '<p>old[x](literal)</p>\n']
        ]
      ],
      [
        '{~~old~>![x~~}]({++literal++})',
        [
          ['original', 'old]()', '<p>old]()</p>\n'],
          ['revised', '!\\[x](literal)', '<p>![x](literal)</p>\n'],
          ['editing', 'old!\\[x](literal)', '<p>old![x](literal)</p>\n']
        ]
      ]
    ] as const
    for (const [canonical, projections] of missingTargetRangeVariants) {
      const revision = completeHostileRevision(canonical)
      for (const [view, source, html] of projections) {
        const projection = revision.projection(view)
        expect(projection.source, `${view}: ${canonical}`).toBe(source)
        expect(
          renderMarkdownHtml(projection.markdown),
          `${view}: ${canonical}`
        ).toBe(html)
        expect(
          projection.markdown.references.linkCount,
          `${view}: ${canonical}`
        ).toBe(0)
      }
    }

    expect(
      existsSync(resolve(REPO_ROOT, 'packages/marked/package.json')),
      'the retired vendored Marked package must not remain in the workspace'
    ).toBe(false)
    expect(
      existsSync(resolve(REPO_ROOT, 'packages/muya')),
      'the old editor source package must be physically deleted'
    ).toBe(false)
    expect(
      existsSync(resolve(REPO_ROOT, 'packages/muyajs')),
      'the old compiled editor package must be physically deleted'
    ).toBe(false)
    expect(
      existsSync(resolve(REPO_ROOT, 'spikes/parser-hosts')),
      'the executable competing-parser spike must not remain'
    ).toBe(false)

    const historicalRecords = [
      'specs/architecture/parser-core-verified-facts.md',
      'specs/research/0006-profile1-on-existing-engines-gap-analysis.md',
      'specs/research/0007-host-engine-spike-results.md'
    ]
    const executableSpikeCitations = historicalRecords.filter((path) => {
      const source = readFileSync(resolve(REPO_ROOT, path), 'utf8')
      return source.includes('spikes/parser-hosts')
    })
    expect(executableSpikeCitations).toEqual([])
    const activeRootControls = ['.gitattributes', '.prettierignore', 'package.json']
    const stalePackageControls = activeRootControls.flatMap((path) => {
      const absolute = resolve(REPO_ROOT, path)
      if (!existsSync(absolute)) return []
      const source = readFileSync(absolute, 'utf8')
      return /packages\/(?:marked|muya|muyajs)(?:\/|\b)|@muyajs\//.test(source) ? [path] : []
    })
    expect(stalePackageControls).toEqual([])

    const viewPackagePath = resolve(REPO_ROOT, 'packages/document-view/package.json')
    expect(existsSync(viewPackagePath), 'the target-owned view package must exist').toBe(true)
    const viewPackage = JSON.parse(readFileSync(viewPackagePath, 'utf8')) as {
      readonly name?: unknown
    }
    expect(viewPackage.name).toBe('@marktext/document-view')

    const survivingOldIdentity = productionSources().flatMap((path) => {
      const source = readFileSync(resolve(REPO_ROOT, path), 'utf8')
      const findings: string[] = []
      if (/@muyajs\/|@marktext\/muyajs/.test(source)) {
        findings.push(`${path}:old-package-identity`)
      }
      if (/\bmu-[a-z0-9-]+|--mu-[a-z0-9-]+/i.test(source)) {
        findings.push(`${path}:old-dom-identity`)
      }
      return findings
    })
    expect(survivingOldIdentity).toEqual([])

    const genericHostPath = resolve(
      REPO_ROOT,
      'packages/desktop/src/renderer/src/components/editorWithTabs/documentEngineHost.ts'
    )
    expect(existsSync(genericHostPath)).toBe(false)

    const host = readFileSync(
      resolve(
        REPO_ROOT,
        'packages/desktop/src/renderer/src/components/editorWithTabs/' +
          'documentCoreDesktopEditor.ts'
      ),
      'utf8'
    )
    expect(host).not.toContain('MARKTEXT_DOCUMENT_CORE_ENGINE')
    expect(host).not.toMatch(/\b(?:on|off)\s*:\s*\(/)
    expect(host).not.toContain('[key: string]')
  })
})

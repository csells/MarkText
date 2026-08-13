import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { createDocumentCore } from '../src/index.js'
import { renderPublicMarkdownProjectionToHtml } from './support/publicMarkdownHtmlConsumer.js'
import { normalizePinnedGfmVisibleTabs } from './support/standardsSemanticOracle.js'

interface DocumentCoreFixtureRow {
  readonly example: number
  readonly section: string
  readonly markdown: string
  readonly html?: string
}

interface MuyaGfmFixtureRow {
  readonly number: number
  readonly section: string
  readonly markdown: string
  readonly html: string
}

type StandardName = 'CommonMark' | 'GFM'

interface SemanticCase {
  readonly standard: StandardName
  readonly example: number
}

interface SemanticLedgerRow extends SemanticCase {
  readonly status: 'green' | 'red'
  readonly reason?:
    | 'public-html-consumer-not-covered'
    | 'public-decoded-text-unavailable'
}

const targetedAstCases: readonly SemanticCase[] = Object.freeze([
  { standard: 'CommonMark', example: 12 },
  { standard: 'CommonMark', example: 25 },
  { standard: 'CommonMark', example: 26 },
  { standard: 'CommonMark', example: 27 },
  { standard: 'CommonMark', example: 28 },
  { standard: 'CommonMark', example: 29 },
  { standard: 'CommonMark', example: 30 },
  { standard: 'CommonMark', example: 32 },
  { standard: 'CommonMark', example: 33 },
  { standard: 'CommonMark', example: 34 },
  { standard: 'CommonMark', example: 43 },
  { standard: 'CommonMark', example: 62 },
  { standard: 'CommonMark', example: 107 },
  { standard: 'CommonMark', example: 119 },
  { standard: 'CommonMark', example: 142 },
  { standard: 'CommonMark', example: 150 },
  { standard: 'CommonMark', example: 192 },
  { standard: 'CommonMark', example: 219 },
  { standard: 'CommonMark', example: 228 },
  { standard: 'CommonMark', example: 278 },
  { standard: 'CommonMark', example: 292 },
  { standard: 'CommonMark', example: 293 },
  { standard: 'CommonMark', example: 298 },
  { standard: 'CommonMark', example: 299 },
  { standard: 'CommonMark', example: 300 },
  { standard: 'CommonMark', example: 301 },
  { standard: 'CommonMark', example: 302 },
  { standard: 'CommonMark', example: 303 },
  { standard: 'CommonMark', example: 304 },
  { standard: 'CommonMark', example: 305 },
  { standard: 'CommonMark', example: 306 },
  { standard: 'CommonMark', example: 307 },
  { standard: 'CommonMark', example: 308 },
  { standard: 'CommonMark', example: 309 },
  { standard: 'CommonMark', example: 310 },
  { standard: 'CommonMark', example: 311 },
  { standard: 'CommonMark', example: 312 },
  { standard: 'CommonMark', example: 313 },
  { standard: 'CommonMark', example: 314 },
  { standard: 'CommonMark', example: 315 },
  { standard: 'CommonMark', example: 316 },
  { standard: 'CommonMark', example: 317 },
  { standard: 'CommonMark', example: 319 },
  { standard: 'CommonMark', example: 322 },
  { standard: 'CommonMark', example: 323 },
  { standard: 'CommonMark', example: 324 },
  { standard: 'CommonMark', example: 325 },
  { standard: 'CommonMark', example: 326 },
  { standard: 'CommonMark', example: 328 },
  { standard: 'CommonMark', example: 350 },
  { standard: 'CommonMark', example: 367 },
  { standard: 'CommonMark', example: 393 },
  { standard: 'CommonMark', example: 482 },
  { standard: 'CommonMark', example: 489 },
  { standard: 'CommonMark', example: 495 },
  { standard: 'CommonMark', example: 498 },
  { standard: 'CommonMark', example: 500 },
  { standard: 'CommonMark', example: 502 },
  { standard: 'CommonMark', example: 503 },
  { standard: 'CommonMark', example: 504 },
  { standard: 'CommonMark', example: 506 },
  { standard: 'CommonMark', example: 507 },
  { standard: 'CommonMark', example: 526 },
  { standard: 'CommonMark', example: 538 },
  { standard: 'CommonMark', example: 552 },
  { standard: 'CommonMark', example: 556 },
  { standard: 'CommonMark', example: 572 },
  { standard: 'CommonMark', example: 594 },
  { standard: 'CommonMark', example: 604 },
  { standard: 'CommonMark', example: 613 },
  { standard: 'CommonMark', example: 633 },
  { standard: 'CommonMark', example: 648 },
  { standard: 'CommonMark', example: 650 },
  { standard: 'GFM', example: 1 },
  { standard: 'GFM', example: 2 },
  { standard: 'GFM', example: 3 },
  { standard: 'GFM', example: 4 },
  { standard: 'GFM', example: 5 },
  { standard: 'GFM', example: 6 },
  { standard: 'GFM', example: 7 },
  { standard: 'GFM', example: 8 },
  { standard: 'GFM', example: 9 },
  { standard: 'GFM', example: 10 },
  { standard: 'GFM', example: 11 },
  { standard: 'GFM', example: 13 },
  { standard: 'GFM', example: 32 },
  { standard: 'GFM', example: 77 },
  { standard: 'GFM', example: 89 },
  { standard: 'GFM', example: 112 },
  { standard: 'GFM', example: 120 },
  { standard: 'GFM', example: 140 },
  { standard: 'GFM', example: 141 },
  { standard: 'GFM', example: 142 },
  { standard: 'GFM', example: 145 },
  { standard: 'GFM', example: 147 },
  { standard: 'GFM', example: 161 },
  { standard: 'GFM', example: 189 },
  { standard: 'GFM', example: 198 },
  { standard: 'GFM', example: 199 },
  { standard: 'GFM', example: 200 },
  { standard: 'GFM', example: 206 },
  { standard: 'GFM', example: 256 },
  { standard: 'GFM', example: 270 },
  { standard: 'GFM', example: 271 },
  { standard: 'GFM', example: 276 },
  { standard: 'GFM', example: 277 },
  { standard: 'GFM', example: 278 },
  { standard: 'GFM', example: 279 },
  { standard: 'GFM', example: 281 },
  { standard: 'GFM', example: 282 },
  { standard: 'GFM', example: 283 },
  { standard: 'GFM', example: 284 },
  { standard: 'GFM', example: 285 },
  { standard: 'GFM', example: 286 },
  { standard: 'GFM', example: 287 },
  { standard: 'GFM', example: 288 },
  { standard: 'GFM', example: 289 },
  { standard: 'GFM', example: 290 },
  { standard: 'GFM', example: 291 },
  { standard: 'GFM', example: 292 },
  { standard: 'GFM', example: 293 },
  { standard: 'GFM', example: 294 },
  { standard: 'GFM', example: 295 },
  { standard: 'GFM', example: 296 },
  { standard: 'GFM', example: 297 },
  { standard: 'GFM', example: 299 },
  { standard: 'GFM', example: 302 },
  { standard: 'GFM', example: 303 },
  { standard: 'GFM', example: 304 },
  { standard: 'GFM', example: 305 },
  { standard: 'GFM', example: 306 },
  { standard: 'GFM', example: 308 },
  { standard: 'GFM', example: 321 },
  { standard: 'GFM', example: 324 },
  { standard: 'GFM', example: 330 },
  { standard: 'GFM', example: 336 },
  { standard: 'GFM', example: 338 },
  { standard: 'GFM', example: 360 },
  { standard: 'GFM', example: 376 },
  { standard: 'GFM', example: 398 },
  { standard: 'GFM', example: 402 },
  { standard: 'GFM', example: 426 },
  { standard: 'GFM', example: 434 },
  { standard: 'GFM', example: 435 },
  { standard: 'GFM', example: 436 },
  { standard: 'GFM', example: 473 },
  { standard: 'GFM', example: 474 },
  { standard: 'GFM', example: 475 },
  { standard: 'GFM', example: 477 },
  { standard: 'GFM', example: 491 },
  { standard: 'GFM', example: 493 },
  { standard: 'GFM', example: 498 },
  { standard: 'GFM', example: 504 },
  { standard: 'GFM', example: 506 },
  { standard: 'GFM', example: 508 },
  { standard: 'GFM', example: 510 },
  { standard: 'GFM', example: 511 },
  { standard: 'GFM', example: 512 },
  { standard: 'GFM', example: 514 },
  { standard: 'GFM', example: 515 },
  { standard: 'GFM', example: 534 },
  { standard: 'GFM', example: 546 },
  { standard: 'GFM', example: 560 },
  { standard: 'GFM', example: 564 },
  { standard: 'GFM', example: 580 },
  { standard: 'GFM', example: 602 },
  { standard: 'GFM', example: 611 },
  { standard: 'GFM', example: 612 },
  { standard: 'GFM', example: 614 },
  { standard: 'GFM', example: 616 },
  { standard: 'GFM', example: 619 },
  { standard: 'GFM', example: 620 },
  { standard: 'GFM', example: 621 },
  { standard: 'GFM', example: 632 },
  { standard: 'GFM', example: 652 },
  { standard: 'GFM', example: 653 },
  { standard: 'GFM', example: 668 },
  { standard: 'GFM', example: 670 }
])

const decodedTextGapCases: readonly SemanticCase[] = Object.freeze([])

const fixture = async <T>(url: URL): Promise<T> =>
  JSON.parse(await readFile(url, 'utf8')) as T

const keyOf = (row: SemanticCase): string =>
  `${row.standard}:${String(row.example)}`

describe('document-core public standards semantic consumer', () => {
  it('matches independent HTML for every row and records a zero-red ledger', async() => {
    const commonMark = await fixture<readonly DocumentCoreFixtureRow[]>(
      new URL('fixtures/commonmark-0.31.2-spec.json', import.meta.url)
    )
    const gfm = await fixture<{
      readonly examples: readonly DocumentCoreFixtureRow[]
    }>(new URL('fixtures/gfm-0.29-spec.json', import.meta.url))
    const gfmOracle = await fixture<readonly MuyaGfmFixtureRow[]>(new URL(
      '../../muya/test/spec/fixtures/gfm-spec-0.29-gfm.json',
      import.meta.url
    ))
    const gfmHtml = new Map(gfmOracle.map(row => [
      row.number,
      normalizePinnedGfmVisibleTabs(row.html)
    ]))
    const standards = [
      ...commonMark.map(row => ({ standard: 'CommonMark' as const, row })),
      ...gfm.examples.map(row => ({ standard: 'GFM' as const, row }))
    ]
    const semanticCases = standards.map(({ standard, row }) => ({
      standard,
      example: row.example
    }))
    const covered = new Set(semanticCases.map(keyOf))
    const ledger: SemanticLedgerRow[] = standards.map(({ standard, row }) => {
      const semanticCase = { standard, example: row.example }
      const decodedTextBlocked = decodedTextGapCases.some(
        blocked => keyOf(blocked) === keyOf(semanticCase)
      )
      return covered.has(keyOf(semanticCase))
        ? { ...semanticCase, status: 'green' }
        : {
          ...semanticCase,
          status: 'red',
          reason: decodedTextBlocked
            ? 'public-decoded-text-unavailable'
            : 'public-html-consumer-not-covered'
        }
    })

    expect(ledger).toHaveLength(1_324)
    expect(ledger.filter(row => row.status === 'green').map(keyOf)).toEqual(
      semanticCases.map(keyOf)
    )
    expect(ledger.filter(row => row.status === 'red')).toHaveLength(0)
    expect(ledger.filter(row => row.status === 'red').every(
      row => row.reason === 'public-html-consumer-not-covered' ||
        row.reason === 'public-decoded-text-unavailable'
    )).toBe(true)
    expect(ledger.filter(
      row => row.reason === 'public-decoded-text-unavailable'
    ).map(keyOf)).toEqual(decodedTextGapCases.map(keyOf))
    expect(targetedAstCases.every(row => covered.has(keyOf(row)))).toBe(true)

    for (const semanticCase of semanticCases) {
      const fixtureRow = semanticCase.standard === 'CommonMark'
        ? commonMark.find(row => row.example === semanticCase.example)
        : gfm.examples.find(row => row.example === semanticCase.example)
      expect(fixtureRow, keyOf(semanticCase)).toBeDefined()
      if (fixtureRow === undefined) continue

      const officialHtml = semanticCase.standard === 'CommonMark'
        ? fixtureRow.html
        : gfmHtml.get(semanticCase.example)
      expect(typeof officialHtml, keyOf(semanticCase)).toBe('string')

      const core = createDocumentCore()
      const revision = core.open(fixtureRow.markdown, {
        gfm: semanticCase.standard === 'GFM',
        gfmAutolinks: semanticCase.standard === 'GFM' &&
          fixtureRow.section === 'Autolinks (extension)',
        gfmTagFilter: semanticCase.standard === 'GFM' &&
          fixtureRow.section === 'Disallowed Raw HTML (extension)',
        frontMatter: false,
        math: false,
        gitLabMath: false,
        footnotes: false,
        subscriptAndSuperscript: false
      })
      const projection = core.project(revision, 'original')
      expect(revision.source, keyOf(semanticCase)).toBe(fixtureRow.markdown)
      expect(structuredClone(projection.ast), keyOf(semanticCase)).toEqual(projection.ast)
      if (keyOf(semanticCase) === 'CommonMark:12') {
        const text = projection.ast.root.children[0]?.children[0]
        expect(projection.ast.root.range).toEqual({ start: 0, end: 65 })
        expect(text?.range).toEqual({ start: 0, end: 64 })
        expect(text?.attributes['semanticText']).toBe(
          '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'
        )
      }
      if (keyOf(semanticCase) === 'CommonMark:28') {
        const overlongReference = projection.ast.root.children[0]?.children[2]
        expect(overlongReference?.range).toEqual({ start: 19, end: 30 })
        expect(fixtureRow.markdown.slice(19, 30)).toBe('&#87654321;')
        expect(overlongReference?.attributes).toEqual({
          semanticText: '&#87654321;'
        })
      }
      if (keyOf(semanticCase) === 'CommonMark:34') {
        expect(projection.ast.root.children[0]).toMatchObject({
          kind: 'code-block',
          range: { start: 0, end: 26 },
          attributes: {
            infoStart: 3,
            infoEnd: 17,
            info: 'f&ouml;&ouml;',
            semanticInfo: 'föö'
          }
        })
      }
      if (keyOf(semanticCase) === 'GFM:200') {
        const inlineCode = projection.ast.root.children[0]?.children[1]?.children[0]
          ?.children.find(child => child.kind === 'inline-code')
        expect(inlineCode?.range).toEqual({ start: 26, end: 30 })
        expect(inlineCode?.attributes).toMatchObject({
          content: '\\|',
          semanticContent: '|'
        })
      }
      if (keyOf(semanticCase) === 'GFM:1') {
        expect(projection.ast.root.children[0]).toMatchObject({
          kind: 'code-block',
          range: { start: 0, end: 14 },
          attributes: {
            contentStart: 1,
            contentEnd: 14,
            content: 'foo\tbaz\t\tbim\n'
          }
        })
      }
      if (keyOf(semanticCase) === 'GFM:4') {
        expect(projection.ast.root.children[0]).toMatchObject({
          kind: 'list',
          range: { start: 2, end: 13 },
          attributes: { ordered: false, tight: false }
        })
        expect(projection.ast.root.children[0]?.children[0]?.children[1])
          .toMatchObject({
            kind: 'paragraph',
            range: { start: 10, end: 13 }
          })
      }
      if (keyOf(semanticCase) === 'GFM:140') {
        expect(projection.ast.root.children[0]).toMatchObject({
          kind: 'html-block',
          range: { start: 0, end: 130 },
          attributes: {
            contentStart: 0,
            contentEnd: 130
          }
        })
        expect(projection.ast.root.children[0]?.attributes['gfmTagFilter'])
          .toBeUndefined()
      }
      if (keyOf(semanticCase) === 'GFM:652') {
        expect(projection.ast.root.children[0]?.children[2]
          ?.attributes['gfmTagFilter'])
          .toBe(true)
        expect(projection.ast.root.children[1]?.attributes['gfmTagFilter'])
          .toBe(true)
      }
      if (keyOf(semanticCase) === 'CommonMark:489') {
        const link = projection.ast.root.children[0]?.children[0]
        expect(link?.range).toEqual({ start: 0, end: 17 })
        expect(link?.attributes).toMatchObject({
          rawDestination: '/my uri',
          semanticDestination: '/my%20uri'
        })
      }
      if (keyOf(semanticCase) === 'CommonMark:552') {
        const indentedText = projection.ast.root.children[0]?.children[2]
        expect(indentedText?.range).toEqual({ start: 2, end: 4 })
        expect(fixtureRow.markdown.slice(2, 4)).toBe(' ]')
        expect(indentedText?.attributes).toEqual({ semanticText: ']' })
      }
      if (keyOf(semanticCase) === 'CommonMark:556') {
        const trailingText = projection.ast.root.children[0]?.children[1]
        expect(trailingText?.range).toEqual({ start: 5, end: 6 })
        expect(fixtureRow.markdown.slice(5, 6)).toBe(' ')
        expect(trailingText?.attributes).toEqual({ semanticText: '' })
      }
      if (keyOf(semanticCase) === 'CommonMark:278') {
        const list = projection.ast.root.children[0]
        expect(list?.attributes).toMatchObject({ tight: true })
        expect(list?.children[1]?.children[0]).toMatchObject({
          kind: 'code-block',
          range: { start: 12, end: 28 }
        })
      }
      if (keyOf(semanticCase) === 'CommonMark:292') {
        const nestedParagraph = projection.ast.root.children[0]?.children[0]
          ?.children[0]?.children[0]?.children[0]
        expect(nestedParagraph).toMatchObject({
          kind: 'paragraph',
          range: { start: 7, end: 33 }
        })
      }
      if (keyOf(semanticCase) === 'GFM:398') {
        const strong = projection.ast.root.children[0]?.children[0]
        expect(strong?.kind).toBe('strong')
        expect(strong?.range).toEqual({ start: 0, end: 21 })
        expect(strong?.attributes['semanticFlattenStrongChildren']).toBe(true)
        expect(strong?.children.map(child => ({
          kind: child.kind,
          range: child.range
        }))).toEqual([
          { kind: 'text', range: { start: 2, end: 7 } },
          { kind: 'strong', range: { start: 7, end: 14 } },
          { kind: 'text', range: { start: 14, end: 19 } }
        ])

        const commonMarkRow = commonMark.find(row => row.example === 389)
        expect(commonMarkRow?.markdown).toBe(fixtureRow.markdown)
        const commonMarkCore = createDocumentCore()
        const commonMarkRevision = commonMarkCore.open(fixtureRow.markdown, {
          gfm: false,
          gfmTagFilter: false,
          frontMatter: false,
          math: false,
          gitLabMath: false,
          footnotes: false,
          subscriptAndSuperscript: false
        })
        expect(renderPublicMarkdownProjectionToHtml(
          commonMarkCore.project(commonMarkRevision, 'original')
        )).toBe(commonMarkRow?.html)
      }
      if (keyOf(semanticCase) === 'GFM:611') {
        const autolink = projection.ast.root.children[0]?.children[0]
        expect(autolink?.range).toEqual({ start: 0, end: 24 })
        expect(autolink?.attributes).toMatchObject({
          rawDestination: 'http://example.com/\\[\\',
          semanticDestination: 'http://example.com/%5C%5B%5C'
        })
      }
      if (keyOf(semanticCase) === 'GFM:614') {
        expect(projection.ast.root.children[0]?.children).toEqual([
          expect.objectContaining({
            kind: 'text',
            range: { start: 0, end: 23 },
            attributes: { semanticText: '<foo+@bar.example.com>' }
          })
        ])
      }
      if (keyOf(semanticCase) === 'GFM:616') {
        expect(projection.ast.root.children[0]?.children).toEqual([
          expect.objectContaining({
            kind: 'text',
            range: { start: 0, end: 18 },
            attributes: { semanticText: '< http://foo.bar >' }
          })
        ])
      }
      if (keyOf(semanticCase) === 'GFM:619') {
        expect(projection.ast.root.children[0]?.children).toEqual([
          expect.objectContaining({
            kind: 'text',
            range: { start: 0, end: 18 },
            attributes: { semanticText: 'http://example.com' }
          })
        ])
      }
      if (keyOf(semanticCase) === 'GFM:620') {
        expect(projection.ast.root.children[0]?.children).toEqual([
          expect.objectContaining({
            kind: 'text',
            range: { start: 0, end: 19 },
            attributes: { semanticText: 'foo@bar.example.com' }
          })
        ])
      }
      expect(
        renderPublicMarkdownProjectionToHtml(projection),
        keyOf(semanticCase)
      ).toBe(officialHtml)
    }
  })
})
